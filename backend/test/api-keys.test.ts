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
let adminId = '';
let viewerToken = '';

function signToken(payload: object): string {
  return jwt.sign(payload, process.env.JWT_SECRET!);
}

beforeAll(async () => {
  await db.migrate.latest();
  await db('api_keys').delete();
  await db('users').delete();

  const [admin] = await db('users').insert({ email: 'apikey-admin@test', role: 'admin' }).returning('id');
  adminId = admin.id;
  adminToken = signToken({ userId: admin.id, role: 'admin' });

  const [viewer] = await db('users').insert({ email: 'apikey-viewer@test', role: 'viewer' }).returning('id');
  viewerToken = signToken({ userId: viewer.id, role: 'viewer' });
});

afterAll(async () => { await db.destroy(); });

describe('API Keys CRUD', () => {
  let createdKeyId = '';
  let createdRawKey = '';

  it('GET returns empty list initially', async () => {
    const res = await request(app)
      .get('/auth/api-keys')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST creates a key and returns raw key once', async () => {
    const res = await request(app)
      .post('/auth/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Claude Desktop' });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^oa_[0-9a-f]{48}$/);
    expect(res.body.key_prefix).toBe(res.body.key.slice(0, 7));
    expect(res.body.name).toBe('Claude Desktop');
    expect(res.body.id).toBeDefined();
    expect(res.body.created_at).toBeDefined();

    createdKeyId = res.body.id;
    createdRawKey = res.body.key;
  });

  it('GET lists keys without hash or raw key', async () => {
    const res = await request(app)
      .get('/auth/api-keys')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(createdKeyId);
    expect(res.body[0].name).toBe('Claude Desktop');
    expect(res.body[0]).not.toHaveProperty('key_hash');
    expect(res.body[0]).not.toHaveProperty('key');
    expect(res.body[0]).toHaveProperty('key_prefix');
    expect(res.body[0]).toHaveProperty('created_at');
  });

  it('DELETE removes a key', async () => {
    const res = await request(app)
      .delete(`/auth/api-keys/${createdKeyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);

    const list = await request(app)
      .get('/auth/api-keys')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.body).toHaveLength(0);
  });

  it('DELETE returns 404 for non-existent key', async () => {
    const res = await request(app)
      .delete('/auth/api-keys/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('POST requires name', async () => {
    const res = await request(app)
      .post('/auth/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('viewer cannot manage API keys', async () => {
    const res = await request(app)
      .post('/auth/api-keys')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'should fail' });
    expect(res.status).toBe(403);
  });
});

describe('MCP auth with API key', () => {
  let rawKey = '';

  beforeAll(async () => {
    await db('api_keys').delete();
    const res = await request(app)
      .post('/auth/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'MCP test key' });
    rawKey = res.body.key;
  });

  it('MCP endpoint accepts valid API key via X-API-Key header', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-API-Key', rawKey)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }, id: 1 });
    expect(res.status).toBe(200);
  });

  it('MCP endpoint rejects invalid API key', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('X-API-Key', 'oa_invalid0000000000000000000000000000000000000000000000')
      .send({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }, id: 1 });
    expect(res.status).toBe(401);
  });

  it('deleted key no longer works', async () => {
    const keys = await request(app)
      .get('/auth/api-keys')
      .set('Authorization', `Bearer ${adminToken}`);
    const keyId = keys.body[0].id;

    await request(app)
      .delete(`/auth/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app)
      .post('/mcp')
      .set('X-API-Key', rawKey)
      .send({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }, id: 1 });
    expect(res.status).toBe(401);
  });

  it('MCP endpoint still works with JWT when no API key provided', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }, id: 1 });
    expect(res.status).toBe(200);
  });
});
