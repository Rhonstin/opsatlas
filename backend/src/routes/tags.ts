import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest, requireAdmin } from '../middleware/auth';

const router = Router();

/** GET /tags — list user's tags */
router.get('/', async (req: AuthRequest, res: Response) => {
  const tags = await db('tags')
    .where({ user_id: req.userId })
    .orderBy('name');
  res.json(tags);
});

/** POST /tags — create a tag { name, color } */
router.post('/', requireAdmin, async (req: AuthRequest, res: Response) => {
  const { name, color } = req.body as { name?: string; color?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const existing = await db('tags')
    .where({ user_id: req.userId, name: name.trim() })
    .first();
  if (existing) {
    res.status(409).json({ error: 'Tag already exists' });
    return;
  }

  const [tag] = await db('tags')
    .insert({ user_id: req.userId, name: name.trim(), color: color || '#6c72f0' })
    .returning('*');
  res.status(201).json(tag);
});

/** PATCH /tags/:id — update tag name/color */
router.patch('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const tag = await db('tags')
    .where({ id: req.params.id, user_id: req.userId })
    .first();
  if (!tag) {
    res.status(404).json({ error: 'Tag not found' });
    return;
  }

  const { name, color } = req.body as { name?: string; color?: string };
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (name !== undefined) updates.name = name.trim();
  if (color !== undefined) updates.color = color;

  const [updated] = await db('tags')
    .where({ id: req.params.id })
    .update(updates)
    .returning('*');
  res.json(updated);
});

/** DELETE /tags/:id — delete tag (CASCADE removes instance_tags) */
router.delete('/:id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const deleted = await db('tags')
    .where({ id: req.params.id, user_id: req.userId })
    .delete();
  if (!deleted) {
    res.status(404).json({ error: 'Tag not found' });
    return;
  }
  res.status(204).send();
});

/** POST /instances/:id/tags — assign tags { tagIds: string[] } (replaces all) */
router.post('/instances/:id/tags', async (req: AuthRequest, res: Response) => {
  const instanceId = req.params.id;
  const { tagIds } = req.body as { tagIds?: string[] };
  if (!Array.isArray(tagIds)) {
    res.status(400).json({ error: 'tagIds must be an array' });
    return;
  }

  // Verify instance is visible to user
  const inst = await db('instances')
    .join('cloud_connections', 'instances.connection_id', 'cloud_connections.id')
    .where('instances.id', instanceId)
    .where('cloud_connections.user_id', req.userId)
    .first();
  if (!inst) {
    res.status(404).json({ error: 'Instance not found' });
    return;
  }

  await db.transaction(async (trx) => {
    await trx('instance_tags').where({ instance_id: instanceId }).delete();
    if (tagIds.length > 0) {
      // Verify all tags belong to the user
      const userTags = await trx('tags')
        .where({ user_id: req.userId })
        .whereIn('id', tagIds)
        .pluck('id');
      const validIds = tagIds.filter((id) => userTags.includes(id));
      if (validIds.length > 0) {
        await trx('instance_tags').insert(
          validIds.map((tagId) => ({ instance_id: instanceId, tag_id: tagId })),
        );
      }
    }
  });

  const tags = await db('instance_tags')
    .join('tags', 'instance_tags.tag_id', 'tags.id')
    .where('instance_tags.instance_id', instanceId)
    .select('tags.*');
  res.json(tags);
});

/** DELETE /instances/:id/tags/:tagId — remove one tag from instance */
router.delete('/instances/:id/tags/:tagId', async (req: AuthRequest, res: Response) => {
  await db('instance_tags')
    .where({ instance_id: req.params.id, tag_id: req.params.tagId })
    .delete();
  res.json({ ok: true });
});

export default router;
