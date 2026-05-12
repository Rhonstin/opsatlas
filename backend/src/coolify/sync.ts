/**
 * Coolify sync module.
 * Connects to a self-hosted Coolify v4 instance via REST API + Bearer token.
 * Applications and services are normalized to the shared Instance model.
 */

export interface CoolifyInstance {
  instanceId: string;
  name: string;
  status: string;
  region: string;          // Coolify server hostname
  zone: string;            // Coolify project name
  machineType: string;     // 'application' | 'service'
  privateIp: string | null;
  publicIp: string | null;
  launchedAt: Date | null;
  estimatedHourlyCost: number;
  estimatedMonthlyCost: number;
  rawPayload: Record<string, unknown>;
}

interface CoolifyProject { id: number; uuid: string; name: string }

interface CoolifyApplication {
  id: number;
  uuid: string;
  name: string;
  status?: string | null;
  fqdn?: string | null;
  git_repository?: string | null;
  git_branch?: string | null;
  project?: { uuid?: string; name?: string } | null;
  created_at: string;
}

interface CoolifyService {
  id: number;
  uuid: string;
  name: string;
  fqdn?: string | null;
  project?: { uuid?: string; name?: string } | null;
  created_at: string;
}

function normalizeStatus(s: string | null | undefined): string {
  if (!s) return 'UNKNOWN';
  const base = s.split(':')[0].toLowerCase().trim();
  const map: Record<string, string> = {
    running: 'RUNNING',
    stopped: 'STOPPED',
    exited: 'STOPPED',
    starting: 'STAGING',
    restarting: 'STAGING',
    error: 'ERROR',
    degraded: 'ERROR',
  };
  return map[base] ?? base.toUpperCase();
}

/** Parse a Coolify fqdn string (URLs or hostnames, comma-separated) into plain hostnames. */
function parseFqdn(fqdn: string | null | undefined): string[] {
  if (!fqdn) return [];
  return fqdn.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try { return new URL(s).host; } catch { return s; }
    });
}

async function coolifyFetch<T>(baseUrl: string, token: string, path: string): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/v1${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `Coolify API ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}

export async function testCoolifyCredentials(baseUrl: string, token: string): Promise<void> {
  // /projects requires auth — validates both connectivity and token
  await coolifyFetch<unknown>(baseUrl, token, '/projects');
}

export async function listCoolifyApps(
  baseUrl: string,
  token: string,
): Promise<CoolifyInstance[]> {
  const hostname = (() => { try { return new URL(baseUrl).hostname; } catch { return baseUrl; } })();

  const [projects, applications, services] = await Promise.all([
    coolifyFetch<CoolifyProject[]>(baseUrl, token, '/projects'),
    coolifyFetch<CoolifyApplication[]>(baseUrl, token, '/applications'),
    coolifyFetch<CoolifyService[]>(baseUrl, token, '/services').catch(() => [] as CoolifyService[]),
  ]);

  const projectMap = new Map(projects.map((p) => [p.uuid, p.name]));

  const instances: CoolifyInstance[] = [];

  for (const app of applications) {
    const projectUuid = app.project?.uuid;
    const projectName = (projectUuid ? projectMap.get(projectUuid) : null) ?? app.project?.name ?? 'default';
    const fqdnList = parseFqdn(app.fqdn);
    instances.push({
      instanceId: app.uuid,
      name: app.name,
      status: normalizeStatus(app.status),
      region: hostname,
      zone: projectName,
      machineType: 'application',
      privateIp: null,
      publicIp: null,
      launchedAt: app.created_at ? new Date(app.created_at) : null,
      estimatedHourlyCost: 0,
      estimatedMonthlyCost: 0,
      rawPayload: {
        id: app.id,
        uuid: app.uuid,
        fqdn_list: fqdnList,
        git_repository: app.git_repository ?? null,
        git_branch: app.git_branch ?? null,
        resource_subtype: 'application',
      },
    });
  }

  for (const svc of services) {
    const projectUuid = svc.project?.uuid;
    const projectName = (projectUuid ? projectMap.get(projectUuid) : null) ?? svc.project?.name ?? 'default';
    const fqdnList = parseFqdn(svc.fqdn);
    instances.push({
      instanceId: svc.uuid,
      name: svc.name,
      status: 'RUNNING',
      region: hostname,
      zone: projectName,
      machineType: 'service',
      privateIp: null,
      publicIp: null,
      launchedAt: svc.created_at ? new Date(svc.created_at) : null,
      estimatedHourlyCost: 0,
      estimatedMonthlyCost: 0,
      rawPayload: {
        id: svc.id,
        uuid: svc.uuid,
        fqdn_list: fqdnList,
        resource_subtype: 'service',
      },
    });
  }

  return instances;
}
