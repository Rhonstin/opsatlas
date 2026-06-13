/**
 * M17: currency conversion is applied on the shared sync path, and instances
 * deleted at the provider are pruned. Provider listing + FX are mocked so the
 * test is deterministic and offline; the DB is real.
 */
import { vi, beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_secret_for_rbac_suite';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef';

// FX: fixed rate so we can assert the converted value exactly (no network)
vi.mock('../src/lib/exchange-rates', () => ({
  getRate: vi.fn(async () => 1.1),
  convert: (amount: number, rate: number) => Math.round(amount * rate * 1_000_000) / 1_000_000,
}));
vi.mock('../src/hetzner/sync', () => ({ listHetznerServers: vi.fn() }));

import db from '../src/db';
import { encrypt } from '../src/lib/crypto';
import { syncConnectionInstances } from '../src/lib/sync-runner';
import { listHetznerServers } from '../src/hetzner/sync';

const listMock = listHetznerServers as unknown as ReturnType<typeof vi.fn>;

let userId = '';
let connId = '';

function hetznerServer(id: string, hourly: number) {
  return {
    instanceId: id, name: `srv-${id}`, status: 'RUNNING',
    zone: 'fsn1-dc14', region: 'fsn1', machineType: 'cx21',
    privateIp: null, publicIp: '1.2.3.4', launchedAt: new Date(),
    estimatedHourlyCost: hourly, estimatedMonthlyCost: hourly * 730,
    rawPayload: {},
  };
}

beforeAll(async () => {
  await db.migrate.latest();
  await db('instances').delete();
  await db('cloud_connections').delete();
  await db('users').delete();

  const [u] = await db('users').insert({ email: 'sync@test', role: 'admin' }).returning('id');
  userId = u.id;
  const [c] = await db('cloud_connections').insert({
    user_id: userId, provider: 'hetzner', name: 'h1',
    credentials_enc: encrypt(JSON.stringify({ token: 'x' })), status: 'pending',
  }).returning('id');
  connId = c.id;
});

afterAll(async () => { await db.destroy(); });

beforeEach(async () => { await db('instances').delete(); listMock.mockReset(); });

describe('syncConnectionInstances', () => {
  it('converts provider costs to the preferred currency', async () => {
    listMock.mockResolvedValue([hetznerServer('a', 10)]);

    const { count } = await syncConnectionInstances({ id: connId, provider: 'hetzner', name: 'h1', user_id: userId, credentials_enc: encrypt(JSON.stringify({ token: 'x' })) }, 'USD');

    expect(count).toBe(1);
    const row = await db('instances').where({ connection_id: connId, instance_id: 'a' }).first();
    // 10 EUR × 1.1 = 11 — proves conversion happens on this (shared) path
    expect(parseFloat(row.estimated_hourly_cost)).toBeCloseTo(11, 5);
  });

  it('prunes instances that disappeared from the provider', async () => {
    // Seed a stale instance not returned by the next sync
    await db('instances').insert({
      connection_id: connId, provider: 'hetzner', instance_id: 'gone',
      name: 'old', status: 'RUNNING', region: 'fsn1', zone: 'fsn1-dc14',
      instance_type: 'cx11', last_seen_at: new Date(Date.now() - 86_400_000),
    });
    listMock.mockResolvedValue([hetznerServer('still-here', 5)]);

    await syncConnectionInstances({ id: connId, provider: 'hetzner', name: 'h1', user_id: userId, credentials_enc: encrypt(JSON.stringify({ token: 'x' })) }, 'USD');

    const gone = await db('instances').where({ connection_id: connId, instance_id: 'gone' }).first();
    const present = await db('instances').where({ connection_id: connId, instance_id: 'still-here' }).first();
    expect(gone).toBeUndefined();          // stale row pruned
    expect(present).toBeDefined();         // live row kept
  });

  it('does NOT prune when the provider listing fails (no wipe on transient error)', async () => {
    await db('instances').insert({
      connection_id: connId, provider: 'hetzner', instance_id: 'keep',
      name: 'keep', status: 'RUNNING', region: 'fsn1', zone: 'fsn1-dc14',
      instance_type: 'cx11', last_seen_at: new Date(Date.now() - 86_400_000),
    });
    listMock.mockRejectedValue(new Error('Hetzner API 503'));

    await expect(
      syncConnectionInstances({ id: connId, provider: 'hetzner', name: 'h1', user_id: userId, credentials_enc: encrypt(JSON.stringify({ token: 'x' })) }, 'USD'),
    ).rejects.toThrow();

    const keep = await db('instances').where({ connection_id: connId, instance_id: 'keep' }).first();
    expect(keep).toBeDefined(); // not deleted — listing failed, cleanup skipped
  });
});
