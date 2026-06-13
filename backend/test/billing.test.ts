/**
 * M17: billing_actuals stores the raw provider amount + currency, and the read
 * path converts from the source to the current display currency — so a stale
 * cached amount_usd is never trusted and changing currency can't corrupt history.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_secret_for_rbac_suite';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef';

import db from '../src/db';
import { buildApp } from '../src/app';

const app = buildApp();
let adminToken = '';
let connId = '';

beforeAll(async () => {
  await db.migrate.latest();
  await db('billing_actuals').delete();
  await db('cloud_connections').delete();
  await db('users').delete();
  await db('app_settings').where({ key: 'preferred_currency' }).delete();

  const [u] = await db('users').insert({ email: 'bill@test', role: 'admin' }).returning('id');
  adminToken = jwt.sign({ userId: u.id, role: 'admin' }, process.env.JWT_SECRET!);
  const [c] = await db('cloud_connections')
    .insert({ user_id: u.id, provider: 'aws', name: 'aws1', credentials_enc: 'x', status: 'active' })
    .returning('id');
  connId = c.id;
});

afterAll(async () => { await db.destroy(); });

describe('GET /billing/actuals', () => {
  it('reads from source_amount, not a stale cached amount_usd', async () => {
    // amount_usd deliberately wrong (999); source is the truth (100 USD)
    await db('billing_actuals').insert({
      connection_id: connId, provider: 'aws', period: '2026-06',
      project_id: 'acct-1', project_name: 'acct-1', service: 'EC2',
      source_amount: 100, source_currency: 'USD',
      amount_usd: 999, currency: 'USD', fetched_at: new Date(),
    });

    const res = await request(app)
      .get('/billing/actuals?period=2026-06')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    // USD→USD rate is 1, so the response must reflect the source (100), not 999
    expect(parseFloat(res.body[0].amount_usd)).toBeCloseTo(100, 2);
    expect(res.body[0].currency).toBe('USD');
  });
});
