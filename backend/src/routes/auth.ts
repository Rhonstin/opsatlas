import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import db from '../db';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const SALT_ROUNDS = 12;

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

/** PUT /auth/config — update server config. Requires auth. */
router.put('/config', authenticateToken, async (req: AuthRequest, res: Response) => {
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

router.post('/register', async (req: Request, res: Response) => {
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
  const [user] = await db('users').insert({ email, password_hash }).returning(['id', 'email']);

  const token = issueToken(user.id);
  res.status(201).json({ token, user: { id: user.id, email: user.email } });
});

router.post('/login', async (req: Request, res: Response) => {
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

  const token = issueToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email } });
});

// ── MFA routes ────────────────────────────────────────────────────────────────

/**
 * POST /auth/mfa/confirm
 * Exchange a short-lived MFA token + TOTP code for a full session token.
 * Body: { mfa_token: string, code: string }
 */
router.post('/mfa/confirm', async (req: Request, res: Response) => {
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

  const token = issueToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email } });
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
  const config = await getAuthentikConfig();
  res.json({
    authentik: config
      ? { enabled: true, url: config.url, clientId: config.clientId }
      : { enabled: false },
  });
});

/** GET /auth/sso-config — returns current DB config (secret masked). Requires auth. */
router.get('/sso-config', authenticateToken, async (_req: AuthRequest, res: Response) => {
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

/** PUT /auth/sso-config — save Authentik config to DB. Requires auth. */
router.put('/sso-config', authenticateToken, async (req: AuthRequest, res: Response) => {
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
    const tokenRes = await fetch(`${config.url}/application/o/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({})) as { error_description?: string };
      res.status(400).json({ error: body.error_description || 'Token exchange failed' });
      return;
    }

    const tokens = await tokenRes.json() as { access_token: string };

    // 2. Fetch user info from Authentik
    const userInfoRes = await fetch(`${config.url}/application/o/userinfo/`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

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
          })
          .returning(['id', 'email']);
        user = created;
      }
    }

    const jwtToken = issueToken(user.id);
    res.json({ token: jwtToken, user: { id: user.id, email: user.email } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'SSO error';
    console.error('[authentik callback]', msg);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────

function issueToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign({ userId }, secret, { expiresIn: '7d' });
}

/** Short-lived token used during MFA challenge (5 minutes). */
function issueMfaToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign({ userId, mfa: true }, secret, { expiresIn: '5m' });
}

export default router;
