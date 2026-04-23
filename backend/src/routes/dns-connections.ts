import { Router, Response } from 'express';
import db from '../db';
import { encrypt, decrypt } from '../lib/crypto';
import { testCloudflareToken } from '../dns/cloudflare';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/** GET /dns-connections — list all DNS connections for the user */
router.get('/', async (req: AuthRequest, res: Response) => {
  const rows = await db('dns_connections')
    .where({ user_id: req.userId })
    .select('id', 'provider', 'name', 'status', 'last_sync_at', 'last_error', 'created_at');
  res.json(rows);
});

/** POST /dns-connections — create a new DNS connection */
router.post('/', async (req: AuthRequest, res: Response) => {
  const { provider, name, credentials } = req.body as {
    provider?: string;
    name?: string;
    credentials?: unknown;
  };

  if (!provider || !name || !credentials) {
    res.status(400).json({ error: 'provider, name, and credentials are required' });
    return;
  }
  if (!['cloudflare'].includes(provider)) {
    res.status(400).json({ error: 'Supported providers: cloudflare' });
    return;
  }

  const credentials_enc = encrypt(JSON.stringify(credentials));
  const [conn] = await db('dns_connections')
    .insert({ user_id: req.userId, provider, name, credentials_enc })
    .returning(['id', 'provider', 'name', 'status', 'last_sync_at', 'created_at']);

  res.status(201).json(conn);
});

/** DELETE /dns-connections/:id */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const deleted = await db('dns_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .delete();

  if (!deleted) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});

/** POST /dns-connections/:id/test — validate credentials */
router.post('/:id/test', async (req: AuthRequest, res: Response) => {
  const conn = await db('dns_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .first();

  if (!conn) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    const credentials = JSON.parse(decrypt(conn.credentials_enc)) as { token: string };

    if (conn.provider === 'cloudflare') {
      await testCloudflareToken(credentials.token);
      await db('dns_connections')
        .where({ id: conn.id })
        .update({ status: 'active', last_error: null });
      res.json({ ok: true, message: 'Cloudflare API token validated successfully.' });
    } else {
      res.status(400).json({ ok: false, error: `Unsupported provider: ${conn.provider}` });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await db('dns_connections')
      .where({ id: conn.id })
      .update({ status: 'error', last_error: message });
    res.status(400).json({ ok: false, error: message });
  }
});

export default router;
