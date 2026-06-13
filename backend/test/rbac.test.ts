/**
 * Auth/RBAC integration tests — run against a real Postgres.
 *
 *   docker run -d --rm --name opsatlas-test-pg -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=opsatlas_test -p 127.0.0.1:5433:5432 postgres
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/opsatlas_test npm test
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_secret_for_rbac_suite';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef';

// Imported after env is set — db/app read env at module load
import db from '../src/db';
import { buildApp } from '../src/app';

const app = buildApp();

let adminToken = '';
let adminId = '';
let viewerToken = '';
let connectionId = '';

function signToken(payload: object): string {
  return jwt.sign(payload, process.env.JWT_SECRET!);
}

beforeAll(async () => {
  await db.migrate.latest();
  // Clean slate — order matters because of FK constraints
  await db('auto_update_runs').delete();
  await db('auto_update_policies').delete();
  await db('sync_runs').delete();
  await db('instances').delete();
  await db('projects_or_accounts').delete();
  await db('cloud_connections').delete();
  await db('dns_records').delete();
  await db('dns_connections').delete();
  await db('users').delete();

  const reg = await request(app)
    .post('/auth/register')
    .send({ email: 'admin@rbac.test', password: 'password123' });
  expect(reg.status).toBe(201);
  adminToken = reg.body.token;
  adminId = reg.body.user.id;

  const [viewer] = await db('users')
    .insert({ email: 'viewer@rbac.test', role: 'viewer' })
    .returning('id');
  viewerToken = signToken({ userId: viewer.id, role: 'viewer' });

  const [conn] = await db('cloud_connections')
    .insert({ user_id: adminId, provider: 'hetzner', name: 'rbac-conn', credentials_enc: 'x', status: 'active' })
    .returning('id');
  connectionId = conn.id;
});

afterAll(async () => {
  await db.destroy();
});

describe('authentication', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/instances');
    expect(res.status).toBe(401);
  });

  it('rejects garbage tokens', async () => {
    const res = await request(app).get('/instances').set('Authorization', 'Bearer not-a-jwt');
    expect(res.status).toBe(401);
  });

  it('treats a token without a role claim as viewer, not admin', async () => {
    const noRole = signToken({ userId: adminId });
    const res = await request(app)
      .post('/auto-update-policies')
      .set('Authorization', `Bearer ${noRole}`)
      .send({ name: 'should-fail' });
    expect(res.status).toBe(403);
  });
});

describe('viewer is read-only', () => {
  const cases: Array<[string, string, object?]> = [
    ['post', '/sync/00000000-0000-0000-0000-000000000000'],
    ['post', '/dns-sync/00000000-0000-0000-0000-000000000000'],
    ['post', '/auto-update-policies', { name: 'x' }],
    ['patch', '/auto-update-policies/00000000-0000-0000-0000-000000000000', { enabled: false }],
    ['delete', '/auto-update-policies/00000000-0000-0000-0000-000000000000'],
    ['post', '/auto-update-policies/00000000-0000-0000-0000-000000000000/run'],
    ['get', '/config/export'],
    ['post', '/config/import', { version: 1 }],
    ['put', '/auth/config', { allowRegistrations: true }],
    ['put', '/auth/sso-config', { url: 'https://x' }],
  ];

  for (const [method, path, body] of cases) {
    it(`viewer gets 403 on ${method.toUpperCase()} ${path}`, async () => {
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send(body ?? {});
      expect(res.status).toBe(403);
    });
  }

  it('viewer can list instances', async () => {
    const res = await request(app).get('/instances').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
  });

  it('viewer export contains no cost fields', async () => {
    await db('instances').insert({
      connection_id: connectionId, provider: 'hetzner', instance_id: 'rbac-1', name: 'srv',
      status: 'RUNNING', region: 'fsn1', zone: 'fsn1-dc14', instance_type: 'cx21',
      estimated_hourly_cost: 0.01, estimated_monthly_cost: 7,
    });
    const res = await request(app).get('/instances/export').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    for (const inst of res.body.instances) {
      expect(inst).not.toHaveProperty('estimated_hourly_cost');
      expect(inst).not.toHaveProperty('estimated_monthly_cost');
    }
  });
});

describe('admin mutations', () => {
  it('admin can update server config', async () => {
    const res = await request(app)
      .put('/auth/config')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ allowRegistrations: true });
    expect(res.status).toBe(200);
  });

  it('admin export includes cost fields', async () => {
    const res = await request(app).get('/instances/export').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.instances[0]).toHaveProperty('estimated_monthly_cost');
  });

  it('admin can create a global policy', async () => {
    const res = await request(app)
      .post('/auto-update-policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'rbac-policy', interval_minutes: 60 });
    expect(res.status).toBe(201);
  });

  it('rejects a policy targeting a connection the user does not own', async () => {
    const res = await request(app)
      .post('/auto-update-policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'bad-target', scope: 'connection', target_id: '00000000-0000-0000-0000-000000000042' });
    expect(res.status).toBe(400);
  });

  it('accepts a policy targeting own connection', async () => {
    const res = await request(app)
      .post('/auto-update-policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'good-target', scope: 'connection', target_id: connectionId });
    expect(res.status).toBe(201);
  });
});

describe('ownership isolation between admins', () => {
  let otherAdminToken = '';

  beforeAll(async () => {
    const [other] = await db('users')
      .insert({ email: 'admin2@rbac.test', role: 'admin' })
      .returning('id');
    otherAdminToken = signToken({ userId: other.id, role: 'admin' });
  });

  it('cannot PATCH another admin\'s connection', async () => {
    const res = await request(app)
      .patch(`/connections/${connectionId}`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .send({ name: 'hijacked' });
    expect(res.status).toBe(404);

    const conn = await db('cloud_connections').where({ id: connectionId }).first();
    expect(conn.name).toBe('rbac-conn');
  });

  it('cannot trigger sync on another admin\'s connection', async () => {
    const res = await request(app)
      .post(`/sync/${connectionId}`)
      .set('Authorization', `Bearer ${otherAdminToken}`);
    expect(res.status).toBe(404);
  });
});
