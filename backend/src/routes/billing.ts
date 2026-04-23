import { Router, Response } from 'express';
import db from '../db';
import { refreshBillingForUser, currentPeriod } from '../lib/billing-refresh';
import { AuthRequest } from '../middleware/auth';

const router = Router();

/** GET /billing/actuals?period=YYYY-MM */
router.get('/actuals', async (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) || currentPeriod();

  const rows = await db('billing_actuals')
    .join('cloud_connections', 'billing_actuals.connection_id', 'cloud_connections.id')
    .where('cloud_connections.user_id', req.userId)
    .where('billing_actuals.period', period)
    .select(
      'billing_actuals.id',
      'billing_actuals.connection_id',
      'cloud_connections.name as connection_name',
      'billing_actuals.provider',
      'billing_actuals.period',
      'billing_actuals.project_id',
      'billing_actuals.project_name',
      'billing_actuals.service',
      'billing_actuals.amount_usd',
      'billing_actuals.currency',
      'billing_actuals.fetched_at',
    )
    .orderBy('billing_actuals.amount_usd', 'desc');

  res.json(rows);
});

/** GET /billing/periods — list months for which we have data */
router.get('/periods', async (req: AuthRequest, res: Response) => {
  const periods = await db('billing_actuals')
    .join('cloud_connections', 'billing_actuals.connection_id', 'cloud_connections.id')
    .where('cloud_connections.user_id', req.userId)
    .distinct('billing_actuals.period')
    .orderBy('billing_actuals.period', 'desc')
    .pluck('billing_actuals.period');

  res.json(periods);
});

/**
 * POST /billing/refresh
 * Body: { period?: "YYYY-MM" }   (defaults to current month)
 * Fetches actuals for all eligible connections and upserts into DB.
 */
router.post('/refresh', async (req: AuthRequest, res: Response) => {
  const period = (req.body.period as string | undefined) || currentPeriod();
  const results = await refreshBillingForUser(req.userId!, period);
  res.json({ period, results });
});

export default router;
