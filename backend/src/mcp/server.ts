import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listInstances, getInstance, listInstancesInput, getInstanceInput } from './tools/instances';
import { listDnsRecords, listDnsRecordsInput } from './tools/dns';
import { listConnections, getConnectionHealth, getConnectionHealthInput } from './tools/connections';
import { triggerSync, triggerSyncInput } from './tools/sync';

export function createMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: 'opsatlas',
    version: '1.0.0',
  });

  server.tool(
    'list_instances',
    'List cloud instances (VMs, Cloud SQL databases, Coolify apps) with optional filters for provider, status, resource type, and tags.',
    listInstancesInput.shape,
    async (args) => listInstances(userId, args),
  );

  server.tool(
    'get_instance',
    'Get detailed information about a specific instance including IP addresses, cost, domains, and metadata.',
    getInstanceInput.shape,
    async (args) => getInstance(userId, args),
  );

  server.tool(
    'list_dns_records',
    'List DNS records with optional filters for zone, record type, and connection. Shows matched instances when available.',
    listDnsRecordsInput.shape,
    async (args) => listDnsRecords(userId, args),
  );

  server.tool(
    'list_connections',
    'List all cloud and DNS connections with their status, last sync time, and any errors.',
    {},
    async () => listConnections(userId),
  );

  server.tool(
    'get_connection_health',
    'Get detailed health info for a connection: projects, recent sync runs, instance count, and errors.',
    getConnectionHealthInput.shape,
    async (args) => getConnectionHealth(userId, args),
  );

  server.tool(
    'trigger_sync',
    'Trigger a background sync for a cloud connection. Returns immediately with a sync run ID that can be polled for status.',
    triggerSyncInput.shape,
    async (args) => triggerSync(userId, args),
  );

  return server;
}
