import { Router, Response } from 'express';
import crypto from 'crypto';
import db from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

function generateApiKey(): string {
  return 'oa_' + crypto.randomBytes(24).toString('hex');
}

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

router.get('/', async (req: AuthRequest, res: Response) => {
  const keys = await db('api_keys')
    .where({ user_id: req.userId })
    .select('id', 'name', 'key_prefix', 'created_at', 'last_used_at')
    .orderBy('created_at', 'desc');

  res.json(keys);
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const raw = generateApiKey();
  const keyHash = hashKey(raw);
  const keyPrefix = raw.slice(0, 7);

  const [key] = await db('api_keys')
    .insert({ user_id: req.userId, name: name.trim(), key_prefix: keyPrefix, key_hash: keyHash })
    .returning(['id', 'name', 'key_prefix', 'created_at']);

  res.status(201).json({ ...key, key: raw });
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const deleted = await db('api_keys')
    .where({ id: req.params.id, user_id: req.userId })
    .delete();

  if (!deleted) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).send();
});

export default router;
