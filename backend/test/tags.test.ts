/**
 * 3.2: Tags — CRUD, assign/unassign, filter instances by tag, RBAC.
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
let tagId = '';

beforeAll(async () => {
  await db.migrate.latest();
  await db('instance_tags').delete();
  await db('tags').delete();
  await db('instances').delete();
  await db('cloud_connections').delete();
  await db('users').delete();

  const [admin] = await db('users').insert({ email: 'tag-admin@test', role: 'admin' }).returning('id');
  adminToken = jwt.sign({ userId: admin.id, role: 'admin' }, process.env.JWT_SECRET!);

  const [viewer] = await db('users').insert({ email: 'tag-viewer@test', role: 'viewer' }).returning('id');
  viewerToken = jwt.sign({ userId: viewer.id, role: 'viewer' }, process.env.JWT_SECRET!);

  const [conn] = await db('cloud_connections')
    .insert({ user_id: admin.id, provider: 'aws', name: 'aws1', credentials_enc: 'x', status: 'active' })
    .returning('id');

  const [inst] = await db('instances')
    .insert({
      connection_id: conn.id, provider: 'aws', instance_id: 'i-789', name: 'tagged-instance',
      status: 'RUNNING', region: 'us-east-1', instance_type: 't2.micro',
      last_seen_at: new Date(),
    })
    .returning('id');
  instanceId = inst.id;
});

afterAll(async () => { await db.destroy(); });

describe('Tags API', () => {
  it('POST /tags creates a tag', async () => {
    const res = await request(app)
      .post('/tags')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'production', color: '#e05252' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('production');
    expect(res.body.color).toBe('#e05252');
    tagId = res.body.id;
  });

  it('POST /tags rejects duplicate name', async () => {
    const res = await request(app)
      .post('/tags')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'production', color: '#000' });
    expect(res.status).toBe(409);
  });

  it('GET /tags lists tags', async () => {
    const res = await request(app)
      .get('/tags')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.some((t: { name: string }) => t.name === 'production')).toBe(true);
  });

  it('PATCH /tags/:id updates tag', async () => {
    const res = await request(app)
      .patch(`/tags/${tagId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ color: '#4caf82' });
    expect(res.status).toBe(200);
    expect(res.body.color).toBe('#4caf82');
  });

  it('viewer cannot create tags', async () => {
    const res = await request(app)
      .post('/tags')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'forbidden' });
    expect(res.status).toBe(403);
  });

  it('POST /tags/instances/:id/tags assigns tags', async () => {
    const res = await request(app)
      .post(`/tags/instances/${instanceId}/tags`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tagIds: [tagId] });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(tagId);
  });

  it('GET /instances?tags=production filters by tag', async () => {
    const res = await request(app)
      .get('/instances?tags=production')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(instanceId);
    expect(res.body[0].tags.length).toBe(1);
    expect(res.body[0].tags[0].name).toBe('production');
  });

  it('DELETE /tags/instances/:id/tags/:tagId removes one tag', async () => {
    const res = await request(app)
      .delete(`/tags/instances/${instanceId}/tags/${tagId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const check = await request(app)
      .get(`/instances?tags=production`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(check.body.length).toBe(0);
  });

  it('DELETE /tags/:id deletes tag', async () => {
    const res = await request(app)
      .delete(`/tags/${tagId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    const list = await request(app)
      .get('/tags')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.find((t: { id: string }) => t.id === tagId)).toBeUndefined();
  });

  it('returns 404 for non-existent instance tag assignment', async () => {
    const res = await request(app)
      .post('/tags/instances/00000000-0000-0000-0000-000000000000/tags')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tagIds: [] });
    expect(res.status).toBe(404);
  });
});
