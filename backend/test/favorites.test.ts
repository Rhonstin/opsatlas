/**
 * 3.1: Favorites — CRUD for user bookmarked instances.
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
let viewerToken = '';
let instanceId = '';
let otherInstanceId = '';

beforeAll(async () => {
  await db.migrate.latest();
  await db('favorite_instances').delete();
  await db('instances').delete();
  await db('cloud_connections').delete();
  await db('users').delete();

  const [admin] = await db('users').insert({ email: 'fav-admin@test', role: 'admin' }).returning('id');
  adminToken = jwt.sign({ userId: admin.id, role: 'admin' }, process.env.JWT_SECRET!);

  const [viewer] = await db('users').insert({ email: 'fav-viewer@test', role: 'viewer' }).returning('id');
  viewerToken = jwt.sign({ userId: viewer.id, role: 'viewer' }, process.env.JWT_SECRET!);

  const [conn] = await db('cloud_connections')
    .insert({ user_id: admin.id, provider: 'aws', name: 'aws1', credentials_enc: 'x', status: 'active' })
    .returning('id');

  const [inst] = await db('instances')
    .insert({
      connection_id: conn.id, provider: 'aws', instance_id: 'i-123', name: 'test-instance',
      status: 'RUNNING', region: 'us-east-1', instance_type: 't2.micro',
      last_seen_at: new Date(),
    })
    .returning('id');
  instanceId = inst.id;

  const [inst2] = await db('instances')
    .insert({
      connection_id: conn.id, provider: 'aws', instance_id: 'i-456', name: 'other-instance',
      status: 'STOPPED', region: 'us-east-1', instance_type: 't2.micro',
      last_seen_at: new Date(),
    })
    .returning('id');
  otherInstanceId = inst2.id;
});

afterAll(async () => { await db.destroy(); });

describe('Favorites API', () => {
  it('GET /favorites returns empty array initially', async () => {
    const res = await request(app)
      .get('/favorites')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST /favorites/instances/:id/favorite adds a favorite', async () => {
    const res = await request(app)
      .post(`/favorites/instances/${instanceId}/favorite`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const favs = await request(app)
      .get('/favorites')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(favs.body).toContain(instanceId);
  });

  it('POST is idempotent (duplicate add)', async () => {
    const res = await request(app)
      .post(`/favorites/instances/${instanceId}/favorite`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const favs = await request(app)
      .get('/favorites')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(favs.body.filter((id: string) => id === instanceId)).toHaveLength(1);
  });

  it('DELETE /favorites/instances/:id/favorite removes a favorite', async () => {
    const res = await request(app)
      .delete(`/favorites/instances/${instanceId}/favorite`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const favs = await request(app)
      .get('/favorites')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(favs.body).not.toContain(instanceId);
  });

  it('returns 404 for non-existent instance', async () => {
    const res = await request(app)
      .post('/favorites/instances/00000000-0000-0000-0000-000000000000/favorite')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('users have independent favorites', async () => {
    await request(app)
      .post(`/favorites/instances/${instanceId}/favorite`)
      .set('Authorization', `Bearer ${adminToken}`);

    const viewerFavs = await request(app)
      .get('/favorites')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(viewerFavs.body).not.toContain(instanceId);

    // Cleanup
    await request(app)
      .delete(`/favorites/instances/${instanceId}/favorite`)
      .set('Authorization', `Bearer ${adminToken}`);
  });
});
