import { Router, Response } from 'express';
import db from '../db';
import { encrypt, decrypt } from '../lib/crypto';
import { testGcpCredentials } from '../gcp/sync';
import { testHetznerCredentials } from '../hetzner/sync';
import { testAwsCredentials } from '../aws/ec2';
import { discoverGcpProjects } from '../gcp/projects';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/** Returns an error string if the credential shape is wrong, or null if valid. */
function validateCredentialShape(provider: string, creds: unknown): string | null {
  if (typeof creds !== 'object' || creds === null) return 'credentials must be an object';
  const c = creds as Record<string, unknown>;
  if (provider === 'gcp') {
    if (typeof c.type !== 'string' || !c.type) return 'GCP credentials must include a "type" field';
    if (typeof c.project_id !== 'string' || !c.project_id) return 'GCP credentials must include a "project_id" field';
    if (typeof c.private_key !== 'string' || !c.private_key) return 'GCP credentials must include a "private_key" field';
    if (typeof c.client_email !== 'string' || !c.client_email) return 'GCP credentials must include a "client_email" field';
  } else if (provider === 'aws') {
    if (typeof c.access_key_id !== 'string' || !c.access_key_id) return 'AWS credentials must include an "access_key_id" field';
    if (typeof c.secret_access_key !== 'string' || !c.secret_access_key) return 'AWS credentials must include a "secret_access_key" field';
  } else if (provider === 'hetzner') {
    if (typeof c.token !== 'string' || !c.token) return 'Hetzner credentials must include a "token" field';
  }
  return null;
}

router.get('/', async (req: AuthRequest, res: Response) => {
  const connections = await db('cloud_connections')
    .where({ user_id: req.userId })
    .select('id', 'provider', 'name', 'status', 'last_sync_at', 'last_error', 'created_at');
  res.json(connections);
});

/** POST /connections/validate — test credentials without creating a connection */
router.post('/validate', async (req: AuthRequest, res: Response) => {
  const { provider, credentials } = req.body as { provider?: string; credentials?: unknown };
  if (!provider || !credentials) {
    res.status(400).json({ error: 'provider and credentials are required' });
    return;
  }

  try {
    const creds = credentials as Record<string, unknown>;
    if (provider === 'gcp') {
      await testGcpCredentials((creds.project_id as string) || 'unknown', creds);
      res.json({ ok: true, message: 'GCP credentials validated.' });
    } else if (provider === 'hetzner') {
      await testHetznerCredentials(creds.token as string);
      res.json({ ok: true, message: 'Hetzner credentials validated.' });
    } else if (provider === 'aws') {
      await testAwsCredentials(creds);
      res.json({ ok: true, message: 'AWS credentials validated.' });
    } else {
      res.status(400).json({ error: 'Unknown provider' });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ ok: false, error: message });
  }
});

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
  if (!['gcp', 'aws', 'hetzner'].includes(provider)) {
    res.status(400).json({ error: 'provider must be gcp, aws, or hetzner' });
    return;
  }
  if (name.length > 128) {
    res.status(400).json({ error: 'name must be 128 characters or fewer' });
    return;
  }
  const credError = validateCredentialShape(provider, credentials);
  if (credError) {
    res.status(400).json({ error: credError });
    return;
  }

  const credentials_enc = encrypt(JSON.stringify(credentials));
  const [conn] = await db('cloud_connections')
    .insert({ user_id: req.userId, provider, name, credentials_enc })
    .returning(['id', 'provider', 'name', 'status', 'last_sync_at', 'created_at']);

  res.status(201).json(conn);
});

router.get('/:id', async (req: AuthRequest, res: Response) => {
  const conn = await db('cloud_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .select('id', 'provider', 'name', 'status', 'last_sync_at', 'last_error', 'created_at')
    .first();

  if (!conn) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(conn);
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const { name, credentials } = req.body as { name?: string; credentials?: unknown };

  const existing = await db('cloud_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .first();
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (name) updates.name = name;
  if (credentials) {
    updates.credentials_enc = encrypt(JSON.stringify(credentials));
    updates.status = 'pending';
  }

  const [updated] = await db('cloud_connections')
    .where({ id: req.params.id })
    .update(updates)
    .returning(['id', 'provider', 'name', 'status', 'last_sync_at', 'created_at']);

  res.json(updated);
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const deleted = await db('cloud_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .delete();

  if (!deleted) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});

router.post('/:id/test', async (req: AuthRequest, res: Response) => {
  const conn = await db('cloud_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .first();

  if (!conn) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    const credentials = JSON.parse(decrypt(conn.credentials_enc)) as Record<string, unknown>;

    if (conn.provider === 'gcp') {
      const projectId = (credentials.project_id as string) || conn.name;
      await testGcpCredentials(projectId, credentials);
      await db('cloud_connections').where({ id: conn.id }).update({ status: 'active', last_error: null });
      res.json({ ok: true, message: 'GCP credentials validated successfully.' });
    } else if (conn.provider === 'hetzner') {
      await testHetznerCredentials(credentials.token as string);
      await db('cloud_connections').where({ id: conn.id }).update({ status: 'active', last_error: null });
      res.json({ ok: true, message: 'Hetzner credentials validated successfully.' });
    } else if (conn.provider === 'aws') {
      await testAwsCredentials(credentials);
      await db('cloud_connections').where({ id: conn.id }).update({ status: 'active', last_error: null });
      res.json({ ok: true, message: 'AWS credentials validated successfully.' });
    } else {
      res.json({ ok: true, message: 'Provider not supported.' });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await db('cloud_connections').where({ id: conn.id }).update({ status: 'error', last_error: message });
    res.status(400).json({ ok: false, error: message });
  }
});

/** GET /connections/:id/projects/discover — list accessible GCP projects */
router.get('/:id/projects/discover', async (req: AuthRequest, res: Response) => {
  const conn = await db('cloud_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .first();
  if (!conn) { res.status(404).json({ error: 'Not found' }); return; }
  if (conn.provider !== 'gcp') { res.status(400).json({ error: 'Only GCP supports project discovery' }); return; }

  try {
    const credentials = JSON.parse(decrypt(conn.credentials_enc)) as Record<string, unknown>;
    const projects = await discoverGcpProjects(credentials);
    res.json(projects);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    res.status(400).json({ error: message });
  }
});

/** GET /connections/:id/projects — saved project selection */
router.get('/:id/projects', async (req: AuthRequest, res: Response) => {
  const conn = await db('cloud_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .first();
  if (!conn) { res.status(404).json({ error: 'Not found' }); return; }

  const projects = await db('projects_or_accounts')
    .where({ connection_id: req.params.id })
    .select('id', 'external_id', 'name', 'last_sync_at', 'last_error');
  res.json(projects);
});

/** POST /connections/:id/projects — replace project selection */
router.post('/:id/projects', async (req: AuthRequest, res: Response) => {
  const conn = await db('cloud_connections')
    .where({ id: req.params.id, user_id: req.userId })
    .first();
  if (!conn) { res.status(404).json({ error: 'Not found' }); return; }

  const { projects } = req.body as { projects?: Array<{ projectId: string; name: string }> };
  if (!Array.isArray(projects)) {
    res.status(400).json({ error: 'projects must be an array' });
    return;
  }

  await db.transaction(async (trx) => {
    await trx('projects_or_accounts').where({ connection_id: req.params.id }).delete();
    if (projects.length > 0) {
      await trx('projects_or_accounts').insert(
        projects.map((p) => ({
          connection_id: req.params.id,
          external_id: p.projectId,
          name: p.name || p.projectId,
        })),
      );
    }
  });

  const saved = await db('projects_or_accounts')
    .where({ connection_id: req.params.id })
    .select('id', 'external_id', 'name');
  res.json(saved);
});

export default router;
