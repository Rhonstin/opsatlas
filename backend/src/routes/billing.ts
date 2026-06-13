import { Router, Response } from 'express';
import db from '../db';
import { refreshBillingForUser, currentPeriod } from '../lib/billing-refresh';
import { getRate, convert } from '../lib/exchange-rates';
import { AuthRequest, requireAdmin } from '../middleware/auth';

const router = Router();

async function preferredCurrency(): Promise<string> {
  const row = await db('app_settings').where({ key: 'preferred_currency' }).first().catch(() => null);
  return row?.value ?? 'USD';
}

/** GET /billing/actuals?period=YYYY-MM */
router.get('/actuals', requireAdmin, async (req: AuthRequest, res: Response) => {
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
      'billing_actuals.source_amount',
      'billing_actuals.source_currency',
      'billing_actuals.fetched_at',
    );

  // Convert from the raw source amount to the user's CURRENT preferred currency,
  // so changing the display currency reflects immediately without a re-fetch.
  const display = await preferredCurrency();
  const rateCache = new Map<string, number>();
  const getCachedRate = async (from: string): Promise<number> => {
    if (!rateCache.has(from)) rateCache.set(from, await getRate(from, display));
    return rateCache.get(from)!;
  };

  const converted = await Promise.all(
    rows.map(async (r) => {
      const src = r.source_amount != null ? parseFloat(r.source_amount) : parseFloat(r.amount_usd);
      const srcCurrency = r.source_currency ?? r.currency ?? 'USD';
      const rate = await getCachedRate(srcCurrency);
      return {
        ...r,
        amount_usd: String(convert(src, rate)), // amount in `currency` (display), name kept for API stability
        currency: display,
      };
    }),
  );

  converted.sort((a, b) => parseFloat(b.amount_usd) - parseFloat(a.amount_usd));
  res.json(converted);
});

/** GET /billing/periods — list months for which we have data */
router.get('/periods', requireAdmin, async (req: AuthRequest, res: Response) => {
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
router.post('/refresh', requireAdmin, async (req: AuthRequest, res: Response) => {
  const period = (req.body.period as string | undefined) || currentPeriod();
  const results = await refreshBillingForUser(req.userId!, period);
  res.json({ period, results });
});

export default router;
