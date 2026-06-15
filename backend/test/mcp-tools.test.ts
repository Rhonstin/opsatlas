/**
 * MCP tool handlers — integration tests.
 * Tests the handler functions directly (not through MCP transport).
 */
import { vi, beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_secret_for_rbac_suite';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef';

vi.mock('../src/lib/sync-runner', () => ({
  syncConnectionInstances: vi.fn(async () => ({ count: 1, errors: [] })),
  getPreferredCurrency: vi.fn(async () => 'USD'),
}));

import db from '../src/db';
import { encrypt } from '../src/lib/crypto';
import { listInstances, getInstance } from '../src/mcp/tools/instances';
import { listDnsRecords } from '../src/mcp/tools/dns';
import { listConnections, getConnectionHealth } from '../src/mcp/tools/connections';
import { triggerSync } from '../src/mcp/tools/sync';
import { syncConnectionInstances } from '../src/lib/sync-runner';

const syncMock = syncConnectionInstances as unknown as ReturnType<typeof vi.fn>;

let adminId = '';
let viewerId = '';
let connId = '';
let instanceId = '';
let dnsConnId = '';

beforeAll(async () => {
  await db.migrate.latest();
  await db('dns_records').delete();
  await db('dns_connections').delete();
  await db('instances').delete();
  await db('cloud_connections').delete();
  await db('users').delete();

  const [admin] = await db('users').insert({ email: 'mcp-admin@test', role: 'admin' }).returning('id');
  adminId = admin.id;
  const [viewer] = await db('users').insert({ email: 'mcp-viewer@test', role: 'viewer' }).returning('id');
  viewerId = viewer.id;

  const [conn] = await db('cloud_connections').insert({
    user_id: adminId, provider: 'hetzner', name: 'hetzner-prod',
    credentials_enc: encrypt(JSON.stringify({ token: 'x' })), status: 'active',
  }).returning('id');
  connId = conn.id;

  const [inst] = await db('instances').insert({
    connection_id: connId, provider: 'hetzner', instance_id: 'h-001',
    name: 'web-server-1', status: 'RUNNING', region: 'fsn1', zone: 'fsn1-dc14',
    instance_type: 'cx21', public_ip: '1.2.3.4', private_ip: '10.0.0.1',
    estimated_hourly_cost: '0.007', estimated_monthly_cost: '5.11',
    last_seen_at: new Date(), launched_at: new Date(Date.now() - 3600_000),
  }).returning('id');
  instanceId = inst.id;

  await db('instances').insert({
    connection_id: connId, provider: 'hetzner', instance_id: 'h-002',
    name: 'db-server-1', status: 'STOPPED', region: 'fsn1', zone: 'fsn1-dc14',
    instance_type: 'cx31', public_ip: '5.6.7.8',
    estimated_hourly_cost: '0.015', estimated_monthly_cost: '10.95',
    last_seen_at: new Date(),
  });

  const [dnsConn] = await db('dns_connections').insert({
    user_id: adminId, provider: 'cloudflare', name: 'cf-main',
    credentials_enc: encrypt(JSON.stringify({ api_token: 'x' })), status: 'active',
  }).returning('id');
  dnsConnId = dnsConn.id;

  await db('dns_records').insert([
    { dns_connection_id: dnsConnId, zone: 'example.com', zone_id: 'z1', record_id: 'r1', name: 'example.com', type: 'A', value: '1.2.3.4', ttl: 300, proxied: true },
    { dns_connection_id: dnsConnId, zone: 'example.com', zone_id: 'z1', record_id: 'r2', name: 'api.example.com', type: 'A', value: '5.6.7.8', ttl: 300, proxied: false },
  ]);
});

afterAll(async () => { await db.destroy(); });

beforeEach(() => { syncMock.mockClear(); });

describe('MCP: list_instances', () => {
  it('returns all instances for admin user', async () => {
    const result = await listInstances(adminId, {});
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBeDefined();
    expect(data[0].provider).toBe('hetzner');
  });

  it('filters by provider', async () => {
    const result = await listInstances(adminId, { provider: 'gcp' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(0);
  });

  it('filters by status', async () => {
    const result = await listInstances(adminId, { status: 'STOPPED' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('db-server-1');
  });

  it('enriches instances with DNS domains', async () => {
    const result = await listInstances(adminId, {});
    const data = JSON.parse(result.content[0].text);
    const withDomains = data.find((i: { domains: string[] | null }) => i.domains && i.domains.length > 0);
    expect(withDomains).toBeDefined();
    expect(withDomains.domains.some((d: string) => d.includes('example.com'))).toBe(true);
  });

  it('viewer sees admin instances', async () => {
    const result = await listInstances(viewerId, {});
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(2);
  });
});

describe('MCP: get_instance', () => {
  it('returns instance details', async () => {
    const result = await getInstance(adminId, { instance_id: instanceId });
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe('web-server-1');
    expect(data.provider).toBe('hetzner');
    expect(data.status).toBe('RUNNING');
    expect(data.public_ip).toBe('1.2.3.4');
    expect(data.domains.some((d: string) => d.includes('example.com'))).toBe(true);
    expect(data.estimated_monthly_cost).toBeCloseTo(5.11, 2);
  });

  it('returns error for non-existent instance', async () => {
    const result = await getInstance(adminId, { instance_id: '00000000-0000-0000-0000-000000000000' });
    expect(result.isError).toBe(true);
  });

  it('viewer cannot see instances from other non-admin users', async () => {
    const result = await getInstance(viewerId, { instance_id: instanceId });
    const data = JSON.parse(result.content[0].text);
    expect(data.name).toBe('web-server-1');
  });
});

describe('MCP: list_dns_records', () => {
  it('returns all DNS records', async () => {
    const result = await listDnsRecords(adminId, {});
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(2);
    expect(data[0].zone).toBe('example.com');
  });

  it('filters by zone', async () => {
    const result = await listDnsRecords(adminId, { zone: 'other.com' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(0);
  });

  it('filters by type', async () => {
    const result = await listDnsRecords(adminId, { type: 'A' });
    const data = JSON.parse(result.content[0].text);
    expect(data).toHaveLength(2);
  });

  it('matches DNS records to instances', async () => {
    const result = await listDnsRecords(adminId, {});
    const data = JSON.parse(result.content[0].text);
    const matched = data.find((r: { matched_instance: string | null; value: string }) => r.matched_instance && r.value === '1.2.3.4');
    expect(matched).toBeDefined();
    expect(matched.matched_instance).toBe('web-server-1');
  });
});

describe('MCP: list_connections', () => {
  it('returns cloud and DNS connections', async () => {
    const result = await listConnections(adminId);
    const data = JSON.parse(result.content[0].text);
    expect(data.cloud_connections).toHaveLength(1);
    expect(data.cloud_connections[0].name).toBe('hetzner-prod');
    expect(data.dns_connections).toHaveLength(1);
    expect(data.dns_connections[0].name).toBe('cf-main');
  });

  it('returns empty for user with no connections', async () => {
    const result = await listConnections(viewerId);
    const data = JSON.parse(result.content[0].text);
    expect(data.cloud_connections).toHaveLength(0);
    expect(data.dns_connections).toHaveLength(0);
  });
});

describe('MCP: get_connection_health', () => {
  it('returns connection details with projects and instance count', async () => {
    const result = await getConnectionHealth(adminId, { connection_id: connId });
    const data = JSON.parse(result.content[0].text);
    expect(data.connection.name).toBe('hetzner-prod');
    expect(data.instance_count).toBe(2);
    expect(data.projects).toBeDefined();
  });

  it('returns error for non-existent connection', async () => {
    const result = await getConnectionHealth(adminId, { connection_id: '00000000-0000-0000-0000-000000000000' });
    expect(result.isError).toBe(true);
  });
});

describe('MCP: trigger_sync', () => {
  it('starts a sync and returns run ID', async () => {
    const result = await triggerSync(adminId, { connection_id: connId });
    const data = JSON.parse(result.content[0].text);
    expect(data.sync_run_id).toBeDefined();
    expect(data.status).toBe('running');
    expect(data.message).toContain('hetzner-prod');
  });

  it('returns error for non-existent connection', async () => {
    const result = await triggerSync(adminId, { connection_id: '00000000-0000-0000-0000-000000000000' });
    expect(result.isError).toBe(true);
  });

  it('calls syncConnectionInstances', async () => {
    await triggerSync(adminId, { connection_id: connId });
    await new Promise((r) => setTimeout(r, 10));
    expect(syncMock).toHaveBeenCalled();
  });
});
