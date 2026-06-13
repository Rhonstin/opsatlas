import { Router, Response } from 'express';
import db from '../db';
import { AuthRequest, requireAdmin } from '../middleware/auth';
import { syncDnsConnection } from '../lib/dns-sync';
import { logger } from '../lib/logger';

const log = logger.child({ module: 'routes/dns-sync' });
const router = Router();

/**
 * POST /dns-sync/:connection_id
 * Trigger a DNS sync for a dns_connection. Runs async, returns 202 immediately.
 */
router.post('/:connection_id', requireAdmin, async (req: AuthRequest, res: Response) => {
  const conn = await db('dns_connections')
    .where({ id: req.params.connection_id, user_id: req.userId })
    .first();

  if (!conn) {
    res.status(404).json({ error: 'DNS connection not found' });
    return;
  }

  res.status(202).json({ status: 'syncing', connection_id: conn.id });

  // Shared with the scheduler: upserts records and prunes ones deleted at the provider.
  syncDnsConnection(conn)
    .then((n) => log.info({ connectionId: conn.id, records: n }, 'dns sync done'))
    .catch((err: unknown) => {
      log.error({ connectionId: conn.id, err }, 'dns sync failed');
    });
});

export default router;
