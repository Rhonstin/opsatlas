import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import db from '../db';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { fetchWithTimeout } from '../lib/http';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'routes/auth' });

// OAuth exchanges block the login flow — keep the timeout short
const OAUTH_TIMEOUT_MS = 15_000;

const router = Router();
const SALT_ROUNDS = 12;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' },
  skip: () => process.env.NODE_ENV === 'test',
});

/** GET /auth/config — public endpoint, returns server feature flags */
router.get('/config', async (_req: Request, res: Response) => {
  const rows = await db('app_settings')
    .whereIn('key', ['allow_registrations', 'preferred_currency'])
    .select('key', 'value')
    .catch(() => [] as { key: string; value: string }[]);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const allowRegistrations = map['allow_registrations'] !== 'false';
  const preferredCurrency = map['preferred_currency'] ?? 'USD';
  res.json({ allowRegistrations, preferredCurrency });
});

/** PUT /auth/config — update server config. Requires admin. */
router.put('/config', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { allowRegistrations, preferredCurrency } = req.body as { allowRegistrations?: boolean; preferredCurrency?: string };
  if (typeof allowRegistrations === 'boolean') {
    await db('app_settings')
      .insert({ key: 'allow_registrations', value: String(allowRegistrations) })
      .onConflict('key').merge(['value']);
  }
  if (typeof preferredCurrency === 'string' && /^[A-Z]{3}$/.test(preferredCurrency)) {
    await db('app_settings')
      .insert({ key: 'preferred_currency', value: preferredCurrency })
      .onConflict('key').merge(['value']);
  }
  res.json({ ok: true });
});

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  // Check if registrations are disabled
  const configRow = await db('app_settings').where({ key: 'allow_registrations' }).first().catch(() => null);
  if (configRow && configRow.value === 'false') {
    res.status(403).json({ error: 'New registrations are disabled' });
    return;
  }

  const existing = await db('users').where({ email }).first();
  if (existing) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const [user] = await db('users').insert({ email, password_hash, role: 'admin' }).returning(['id', 'email', 'role']);

  const token = issueToken(user.id, 'admin');
  res.status(201);
  setSessionCookie(res, token, { id: user.id, email: user.email, role: 'admin' });
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = await db('users').where({ email }).first();
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (!user.password_hash) {
    res.status(401).json({ error: 'This account uses SSO — sign in with your provider' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // If MFA is enabled, issue a short-lived MFA challenge token instead of a session token
  if (user.mfa_enabled) {
    const mfaToken = issueMfaToken(user.id);
    res.json({ mfa_required: true, mfa_token: mfaToken });
    return;
  }

  const token = issueToken(user.id, user.role ?? 'admin');
  setSessionCookie(res, token, { id: user.id, email: user.email, role: user.role ?? 'admin' });
});

// ── MFA routes ────────────────────────────────────────────────────────────────

/**
 * POST /auth/mfa/confirm
 * Exchange a short-lived MFA token + TOTP code for a full session token.
 * Body: { mfa_token: string, code: string }
 */
router.post('/mfa/confirm', authLimiter, async (req: Request, res: Response) => {
  const { mfa_token, code } = req.body as { mfa_token?: string; code?: string };
  if (!mfa_token || !code) {
    res.status(400).json({ error: 'mfa_token and code are required' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) { res.status(500).json({ error: 'Server misconfigured' }); return; }

  let payload: { userId: string; mfa: true };
  try {
    payload = jwt.verify(mfa_token, secret) as { userId: string; mfa: true };
  } catch {
    res.status(401).json({ error: 'Invalid or expired MFA token' });
    return;
  }

  if (!payload.mfa) {
    res.status(401).json({ error: 'Invalid MFA token' });
    return;
  }

  const user = await db('users').where({ id: payload.userId }).first();
  if (!user || !user.mfa_secret || !user.mfa_enabled) {
    res.status(401).json({ error: 'MFA not configured' });
    return;
  }

  const valid = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: code, window: 1 });
  if (!valid) {
    res.status(401).json({ error: 'Invalid authenticator code' });
    return;
  }

  const token = issueToken(user.id, user.role ?? 'admin');
  setSessionCookie(res, token, { id: user.id, email: user.email, role: user.role ?? 'admin' });
});

/**
 * GET /auth/mfa/setup
 * Generate a new TOTP secret and return the otpauth URI + QR code data URL.
 * Requires auth. Does NOT enable MFA yet — call /mfa/verify-setup to confirm.
 */
router.get('/mfa/setup', authenticateToken, async (req: AuthRequest, res: Response) => {
  const user = await db('users').where({ id: req.userId }).first();
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const generated = speakeasy.generateSecret({ name: `OpsAtlas (${user.email})`, length: 20 });
  const secretBase32 = generated.base32;

  // Store the pending secret (not yet enabled)
  await db('users').where({ id: req.userId }).update({ mfa_secret: secretBase32, mfa_enabled: false });

  const otpauthUrl = generated.otpauth_url ?? speakeasy.otpauthURL({ secret: secretBase32, label: user.email, issuer: 'OpsAtlas', encoding: 'base32' });
  const qrDataUrl = await qrcode.toDataURL(otpauthUrl);
  res.json({ secret: secretBase32, otpauth_url: otpauthUrl, qr_data_url: qrDataUrl });
});

/**
 * POST /auth/mfa/verify-setup
 * Verify the TOTP code from the authenticator app and enable MFA.
 * Requires auth. Body: { code: string }
 */
router.post('/mfa/verify-setup', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ error: 'code is required' }); return; }

  const user = await db('users').where({ id: req.userId }).first();
  if (!user || !user.mfa_secret) {
    res.status(400).json({ error: 'Call /mfa/setup first' });
    return;
  }
  if (user.mfa_enabled) {
    res.status(400).json({ error: 'MFA is already enabled' });
    return;
  }

  const valid = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: code, window: 1 });
  if (!valid) {
    res.status(400).json({ error: 'Invalid authenticator code' });
    return;
  }

  await db('users').where({ id: req.userId }).update({ mfa_enabled: true });
  res.json({ ok: true });
});

/**
 * POST /auth/mfa/disable
 * Disable MFA. Requires auth + current TOTP code (or password for SSO accounts).
 * Body: { code: string }
 */
router.post('/mfa/disable', authenticateToken, async (req: AuthRequest, res: Response) => {
  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ error: 'code is required' }); return; }

  const user = await db('users').where({ id: req.userId }).first();
  if (!user || !user.mfa_enabled || !user.mfa_secret) {
    res.status(400).json({ error: 'MFA is not enabled' });
    return;
  }

  const valid = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: code, window: 1 });
  if (!valid) {
    res.status(400).json({ error: 'Invalid authenticator code' });
    return;
  }

  await db('users').where({ id: req.userId }).update({ mfa_enabled: false, mfa_secret: null });
  res.json({ ok: true });
});

/**
 * GET /auth/mfa/status
 * Returns whether MFA is enabled for the current user.
 */
router.get('/mfa/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  const user = await db('users').where({ id: req.userId }).first();
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ mfa_enabled: !!user.mfa_enabled });
});

// ── SSO ───────────────────────────────────────────────────────────────────────

interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  allowedDomain: string | null;
}

async function getGoogleConfig(): Promise<GoogleConfig | null> {
  const rows = await db('app_settings')
    .whereIn('key', ['google_client_id', 'google_client_secret', 'google_allowed_domain'])
    .select('key', 'value')
    .catch(() => [] as { key: string; value: string }[]);

  const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  if (map.google_client_id && map.google_client_secret) {
    return {
      clientId: map.google_client_id,
      clientSecret: map.google_client_secret,
      allowedDomain: map.google_allowed_domain || null,
    };
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_DOMAIN } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    return {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      allowedDomain: GOOGLE_ALLOWED_DOMAIN || null,
    };
  }

  return null;
}

/** GET /auth/google-config — returns current Google OAuth config (secret masked). Requires admin. */
router.get('/google-config', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const rows = await db('app_settings')
    .whereIn('key', ['google_client_id', 'google_client_secret', 'google_allowed_domain'])
    .select('key', 'value')
    .catch(() => [] as { key: string; value: string }[]);

  const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  res.json({
    clientId: map.google_client_id || '',
    hasSecret: !!map.google_client_secret,
    allowedDomain: map.google_allowed_domain || '',
  });
});

/** PUT /auth/google-config — save Google OAuth config. Requires admin. */
router.put('/google-config', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { clientId, clientSecret, allowedDomain } = req.body as {
    clientId?: string;
    clientSecret?: string;
    allowedDomain?: string;
  };

  const updates: Array<{ key: string; value: string }> = [];
  if (clientId !== undefined) updates.push({ key: 'google_client_id', value: clientId });
  if (clientSecret) updates.push({ key: 'google_client_secret', value: clientSecret });
  if (allowedDomain !== undefined) updates.push({ key: 'google_allowed_domain', value: allowedDomain });

  for (const { key, value } of updates) {
    await db('app_settings').insert({ key, value }).onConflict('key').merge();
  }

  res.json({ ok: true });
});

/**
 * POST /auth/google/callback
 * Exchange a Google authorization code for a JWT.
 * Google users always get `viewer` role.
 * Body: { code: string, redirectUri: string }
 */
router.post('/google/callback', async (req: Request, res: Response) => {
  const { code, redirectUri } = req.body as { code?: string; redirectUri?: string };

  if (!code || !redirectUri) {
    res.status(400).json({ error: 'code and redirectUri are required' });
    return;
  }

  const config = await getGoogleConfig();
  if (!config) {
    res.status(503).json({ error: 'Google OAuth is not configured on this server' });
    return;
  }

  try {
    // 1. Exchange authorization code for tokens
    const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    }, OAUTH_TIMEOUT_MS);

    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({})) as { error_description?: string };
      res.status(400).json({ error: body.error_description || 'Token exchange failed' });
      return;
    }

    const tokens = await tokenRes.json() as { access_token: string };

    // 2. Fetch user info
    const userInfoRes = await fetchWithTimeout('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }, OAUTH_TIMEOUT_MS);

    if (!userInfoRes.ok) {
      res.status(400).json({ error: 'Failed to fetch user info from Google' });
      return;
    }

    const userInfo = await userInfoRes.json() as { sub: string; email: string; hd?: string };

    if (!userInfo.email || !userInfo.sub) {
      res.status(400).json({ error: 'Google did not return an email address' });
      return;
    }

    // 3. Enforce allowed domain (Google Workspace) if configured
    if (config.allowedDomain) {
      const domain = userInfo.email.split('@')[1];
      if (domain !== config.allowedDomain && userInfo.hd !== config.allowedDomain) {
        res.status(403).json({ error: `Only @${config.allowedDomain} accounts are allowed` });
        return;
      }
    }

    // 4. Find or create local user — Google users always get viewer role
    let user = await db('users')
      .where({ sso_provider: 'google', sso_id: userInfo.sub })
      .first();

    if (!user) {
      const existing = await db('users').where({ email: userInfo.email }).first();
      if (existing) {
        await db('users')
          .where({ id: existing.id })
          .update({ sso_provider: 'google', sso_id: userInfo.sub });
        user = { ...existing, sso_provider: 'google', sso_id: userInfo.sub };
      } else {
        const [created] = await db('users')
          .insert({
            email: userInfo.email,
            sso_provider: 'google',
            sso_id: userInfo.sub,
            role: 'viewer',
          })
          .returning(['id', 'email', 'role']);
        user = created;
      }
    }

    const jwtToken = issueToken(user.id, user.role ?? 'viewer');
    setSessionCookie(res, jwtToken, { id: user.id, email: user.email, role: user.role ?? 'viewer' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'SSO error';
    log.error({ err: msg }, 'google callback failed');
    res.status(500).json({ error: 'Authentication failed' });
  }
});

interface AuthentikConfig {
  url: string;
  clientId: string;
  clientSecret: string;
}

/** Read Authentik config from DB first, falling back to env vars. */
async function getAuthentikConfig(): Promise<AuthentikConfig | null> {
  const rows = await db('app_settings')
    .whereIn('key', ['authentik_url', 'authentik_client_id', 'authentik_client_secret'])
    .select('key', 'value')
    .catch(() => [] as { key: string; value: string }[]);

  const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  if (map.authentik_url && map.authentik_client_id && map.authentik_client_secret) {
    return {
      url: map.authentik_url,
      clientId: map.authentik_client_id,
      clientSecret: map.authentik_client_secret,
    };
  }

  // Fall back to environment variables
  const { AUTHENTIK_URL, AUTHENTIK_CLIENT_ID, AUTHENTIK_CLIENT_SECRET } = process.env;
  if (AUTHENTIK_URL && AUTHENTIK_CLIENT_ID && AUTHENTIK_CLIENT_SECRET) {
    return { url: AUTHENTIK_URL, clientId: AUTHENTIK_CLIENT_ID, clientSecret: AUTHENTIK_CLIENT_SECRET };
  }

  return null;
}

/** Returns which SSO providers are configured. */
router.get('/providers', async (_req: Request, res: Response) => {
  const [authentikCfg, googleCfg] = await Promise.all([
    getAuthentikConfig(),
    getGoogleConfig(),
  ]);
  res.json({
    authentik: authentikCfg
      ? { enabled: true, url: authentikCfg.url, clientId: authentikCfg.clientId }
      : { enabled: false },
    google: googleCfg
      ? { enabled: true, clientId: googleCfg.clientId, allowedDomain: googleCfg.allowedDomain }
      : { enabled: false },
  });
});

/** GET /auth/me — returns current user info including role. */
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  const user = await db('users').where({ id: req.userId }).select('id', 'email', 'role').first();
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ id: user.id, email: user.email, role: user.role ?? 'admin' });
});

/** POST /auth/logout — clear the session cookie. */
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('opsatlas_token', { path: '/' });
  res.json({ ok: true });
});

/** GET /auth/sso-config — returns current DB config (secret masked). Requires admin. */
router.get('/sso-config', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const rows = await db('app_settings')
    .whereIn('key', ['authentik_url', 'authentik_client_id', 'authentik_client_secret'])
    .select('key', 'value')
    .catch(() => [] as { key: string; value: string }[]);

  const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  res.json({
    authentik: {
      url: map.authentik_url || '',
      clientId: map.authentik_client_id || '',
      hasSecret: !!map.authentik_client_secret,
    },
  });
});

/** PUT /auth/sso-config — save Authentik config to DB. Requires admin. */
router.put('/sso-config', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { url, clientId, clientSecret } = req.body as {
    url?: string;
    clientId?: string;
    clientSecret?: string;
  };

  const updates: Array<{ key: string; value: string }> = [];
  if (url !== undefined) updates.push({ key: 'authentik_url', value: url });
  if (clientId !== undefined) updates.push({ key: 'authentik_client_id', value: clientId });
  // Only update secret if a non-empty value was provided
  if (clientSecret) updates.push({ key: 'authentik_client_secret', value: clientSecret });

  for (const { key, value } of updates) {
    await db('app_settings')
      .insert({ key, value })
      .onConflict('key')
      .merge();
  }

  res.json({ ok: true });
});

/**
 * POST /auth/authentik/callback
 * Exchange an authorization code for a JWT.
 * Body: { code: string, redirectUri: string }
 */
router.post('/authentik/callback', async (req: Request, res: Response) => {
  const { code, redirectUri } = req.body as { code?: string; redirectUri?: string };

  if (!code || !redirectUri) {
    res.status(400).json({ error: 'code and redirectUri are required' });
    return;
  }

  const config = await getAuthentikConfig();
  if (!config) {
    res.status(503).json({ error: 'Authentik SSO is not configured on this server' });
    return;
  }

  try {
    // 1. Exchange authorization code for access token
    const tokenRes = await fetchWithTimeout(`${config.url}/application/o/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    }, OAUTH_TIMEOUT_MS);

    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({})) as { error_description?: string };
      res.status(400).json({ error: body.error_description || 'Token exchange failed' });
      return;
    }

    const tokens = await tokenRes.json() as { access_token: string };

    // 2. Fetch user info from Authentik
    const userInfoRes = await fetchWithTimeout(`${config.url}/application/o/userinfo/`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }, OAUTH_TIMEOUT_MS);

    if (!userInfoRes.ok) {
      res.status(400).json({ error: 'Failed to fetch user info from Authentik' });
      return;
    }

    const userInfo = await userInfoRes.json() as { sub: string; email: string };

    if (!userInfo.email || !userInfo.sub) {
      res.status(400).json({ error: 'Authentik did not return an email address' });
      return;
    }

    // 3. Find or create local user
    let user = await db('users')
      .where({ sso_provider: 'authentik', sso_id: userInfo.sub })
      .first();

    if (!user) {
      // Link to existing account if email matches, otherwise create new
      const existing = await db('users').where({ email: userInfo.email }).first();
      if (existing) {
        await db('users')
          .where({ id: existing.id })
          .update({ sso_provider: 'authentik', sso_id: userInfo.sub });
        user = { ...existing, sso_provider: 'authentik', sso_id: userInfo.sub };
      } else {
        const [created] = await db('users')
          .insert({
            email: userInfo.email,
            sso_provider: 'authentik',
            sso_id: userInfo.sub,
            role: 'admin',
          })
          .returning(['id', 'email', 'role']);
        user = created;
      }
    }

    const jwtToken = issueToken(user.id, user.role ?? 'admin');
    setSessionCookie(res, jwtToken, { id: user.id, email: user.email, role: user.role ?? 'admin' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'SSO error';
    log.error({ err: msg }, 'authentik callback failed');
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────

function issueToken(userId: string, role = 'admin'): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign({ userId, role }, secret, { expiresIn: '7d' });
}

/** Short-lived token used during MFA challenge (5 minutes). */
function issueMfaToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign({ userId, mfa: true }, secret, { expiresIn: '5m' });
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 3600 * 1000,
  path: '/',
};

/** Set the session cookie AND return the token in the response body. */
function setSessionCookie(res: Response, token: string, user: { id: string; email: string; role: string }) {
  res.cookie('opsatlas_token', token, COOKIE_OPTS);
  res.json({ token, user });
}

export default router;
