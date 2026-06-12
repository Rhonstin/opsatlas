/** Shared instance upsert — used by both the manual sync route and the scheduler. */
import db from '../db';

export interface UpsertableInstance {
  provider: string;
  resourceType?: string;
  connectionId: string;
  projectId: string | null;
  instanceId: string;
  name: string;
  status: string;
  region: string;
  zone: string;
  privateIp: string | null;
  publicIp: string | null;
  machineType: string;
  launchedAt: Date | null;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  rawPayload: Record<string, unknown>;
}

export async function upsertInstanceRow(inst: UpsertableInstance): Promise<void> {
  await db('instances')
    .insert({
      provider: inst.provider,
      resource_type: inst.resourceType ?? 'compute',
      connection_id: inst.connectionId,
      project_or_account_id: inst.projectId,
      instance_id: inst.instanceId,
      name: inst.name,
      status: inst.status,
      region: inst.region,
      zone: inst.zone,
      private_ip: inst.privateIp,
      public_ip: inst.publicIp,
      instance_type: inst.machineType,
      launched_at: inst.launchedAt,
      last_seen_at: new Date(),
      estimated_hourly_cost: inst.estimatedHourlyCost,
      estimated_monthly_cost: inst.estimatedMonthlyCost,
      raw_payload: JSON.stringify(inst.rawPayload),
    })
    .onConflict(['connection_id', 'instance_id'])
    .merge([
      'name', 'status', 'region', 'zone',
      'private_ip', 'public_ip', 'instance_type',
      'launched_at', 'last_seen_at',
      'estimated_hourly_cost', 'estimated_monthly_cost',
      'project_or_account_id', 'resource_type', 'raw_payload', 'updated_at',
    ]);
}
