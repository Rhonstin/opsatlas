const BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.replace('/login');
    }
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string } }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<{ token: string; user: { id: string; email: string } } | { mfa_required: true; mfa_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getAuthProviders: () =>
    fetch(`${BASE}/auth/providers`)
      .then((r) => r.json()) as Promise<{
        authentik: { enabled: boolean; url?: string; clientId?: string };
      }>,

  getServerConfig: () =>
    fetch(`${BASE}/auth/config`)
      .then((r) => r.json()) as Promise<{ allowRegistrations: boolean; preferredCurrency: string }>,

  setAllowRegistrations: (allow: boolean) =>
    request<{ ok: boolean }>('/auth/config', {
      method: 'PUT',
      body: JSON.stringify({ allowRegistrations: allow }),
    }),

  setPreferredCurrency: (currency: string) =>
    request<{ ok: boolean }>('/auth/config', {
      method: 'PUT',
      body: JSON.stringify({ preferredCurrency: currency }),
    }),

  // MFA
  getMfaStatus: () =>
    request<{ mfa_enabled: boolean }>('/auth/mfa/status'),

  setupMfa: () =>
    request<{ secret: string; otpauth_url: string; qr_data_url: string }>('/auth/mfa/setup'),

  verifyMfaSetup: (code: string) =>
    request<{ ok: boolean }>('/auth/mfa/verify-setup', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  disableMfa: (code: string) =>
    request<{ ok: boolean }>('/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  confirmMfa: (mfa_token: string, code: string) =>
    request<{ token: string; user: { id: string; email: string } }>('/auth/mfa/confirm', {
      method: 'POST',
      body: JSON.stringify({ mfa_token, code }),
    }),

  authentikCallback: (code: string, redirectUri: string) =>
    request<{ token: string; user: { id: string; email: string } }>('/auth/authentik/callback', {
      method: 'POST',
      body: JSON.stringify({ code, redirectUri }),
    }),

  getSsoConfig: () =>
    request<{ authentik: { url: string; clientId: string; hasSecret: boolean } }>('/auth/sso-config'),

  saveSsoConfig: (data: { url: string; clientId: string; clientSecret?: string }) =>
    request<{ ok: boolean }>('/auth/sso-config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getConnections: () => request<Connection[]>('/connections'),

  validateCredentials: (provider: string, credentials: unknown) =>
    request<{ ok: boolean; message?: string; error?: string }>('/connections/validate', {
      method: 'POST',
      body: JSON.stringify({ provider, credentials }),
    }),

  createConnection: (data: { provider: string; name: string; credentials: unknown }) =>
    request<Connection>('/connections', { method: 'POST', body: JSON.stringify(data) }),

  updateConnection: (id: string, data: { name?: string; credentials?: unknown }) =>
    request<Connection>(`/connections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteConnection: (id: string) => request<void>(`/connections/${id}`, { method: 'DELETE' }),

  testConnection: (id: string) =>
    request<{ ok: boolean; message?: string; error?: string }>(`/connections/${id}/test`, {
      method: 'POST',
    }),

  discoverProjects: (connectionId: string) =>
    request<GcpProject[]>(`/connections/${connectionId}/projects/discover`),

  getSelectedProjects: (connectionId: string) =>
    request<SavedProject[]>(`/connections/${connectionId}/projects`),

  saveProjects: (connectionId: string, projects: { projectId: string; name: string }[]) =>
    request<SavedProject[]>(`/connections/${connectionId}/projects`, {
      method: 'POST',
      body: JSON.stringify({ projects }),
    }),

  triggerSync: (connectionId: string) =>
    request<{ sync_run_id: string; status: string }>(`/sync/${connectionId}`, { method: 'POST' }),

  getSyncRun: (runId: string) =>
    request<SyncRun>(`/sync/${runId}`),

  getSyncHistory: () => request<SyncRun[]>('/sync/history'),

  getInstance: (id: string) => request<InstanceDetail>(`/instances/${id}`),

  getInstances: (params?: { provider?: string; status?: string; connection_id?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<Instance[]>(`/instances${qs}`);
  },

  getCostSummary: () => request<CostSummary>('/instances/cost-summary'),

  // DNS connections
  getDnsConnections: () => request<DnsConnection[]>('/dns-connections'),

  createDnsConnection: (data: { provider: string; name: string; credentials: unknown }) =>
    request<DnsConnection>('/dns-connections', { method: 'POST', body: JSON.stringify(data) }),

  deleteDnsConnection: (id: string) =>
    request<void>(`/dns-connections/${id}`, { method: 'DELETE' }),

  testDnsConnection: (id: string) =>
    request<{ ok: boolean; message?: string; error?: string }>(`/dns-connections/${id}/test`, {
      method: 'POST',
    }),

  triggerDnsSync: (connectionId: string) =>
    request<{ status: string; connection_id: string }>(`/dns-sync/${connectionId}`, { method: 'POST' }),

  getDnsRecords: (params?: { zone?: string; type?: string; connection_id?: string }) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
    return request<DnsRecord[]>(`/dns/records${qs}`);
  },

  getInstancesWithDns: (params?: { provider?: string; status?: string; connection_id?: string }) => {
    const p = { ...(params ?? {}), with_dns: 'true' };
    const qs = '?' + new URLSearchParams(p as Record<string, string>).toString();
    return request<(Instance & { domains: string[] | null })[]>(`/instances${qs}`);
  },

  // Auto-update policies
  getAutoUpdatePolicies: () => request<AutoUpdatePolicy[]>('/auto-update-policies'),

  createAutoUpdatePolicy: (data: Partial<AutoUpdatePolicy>) =>
    request<AutoUpdatePolicy>('/auto-update-policies', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAutoUpdatePolicy: (id: string, data: Partial<AutoUpdatePolicy>) =>
    request<AutoUpdatePolicy>(`/auto-update-policies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteAutoUpdatePolicy: (id: string) =>
    request<void>(`/auto-update-policies/${id}`, { method: 'DELETE' }),

  runAutoUpdatePolicy: (id: string) =>
    request<{ status: string; message: string }>(`/auto-update-policies/${id}/run`, { method: 'POST' }),

  getAutoUpdateRuns: (policyId: string) =>
    request<AutoUpdateRun[]>(`/auto-update-policies/${policyId}/runs`),

  // Config export / import
  exportConfig: () => request<ConfigExport>('/config/export'),

  importConfig: (config: ConfigExport) =>
    request<ConfigImportResult>('/config/import', {
      method: 'POST',
      body: JSON.stringify(config),
    }),

  // Billing actuals
  getBillingActuals: (period?: string) => {
    const qs = period ? `?period=${period}` : '';
    return request<BillingActual[]>(`/billing/actuals${qs}`);
  },

  getBillingPeriods: () => request<string[]>('/billing/periods'),

  refreshBilling: (period?: string) =>
    request<BillingRefreshResult>('/billing/refresh', {
      method: 'POST',
      body: JSON.stringify({ period }),
    }),
};

export interface SyncRun {
  id: string;
  connection_id: string;
  connection_name?: string;
  provider?: string;
  status: 'running' | 'success' | 'error';
  started_at: string;
  finished_at: string | null;
  error_log: string | null;
}

export interface Instance {
  id: string;
  provider: 'gcp' | 'aws' | 'hetzner';
  resource_type: string;        // 'compute' | 'cloudsql'
  connection_id: string;
  connection_name: string;
  instance_id: string;
  name: string;
  status: string;
  region: string;
  zone: string | null;
  private_ip: string | null;
  public_ip: string | null;
  instance_type: string | null;
  launched_at: string | null;
  uptime_hours: number | null;
  last_seen_at: string;
  estimated_hourly_cost: string | null;
  estimated_monthly_cost: string | null;
  project_or_account_id: string | null;
  project_name: string | null;
  project_external_id: string | null;
  created_at: string;
}

export interface GcpProject {
  projectId: string;
  name: string;
  state: string;
}

export interface SavedProject {
  id: string;
  external_id: string;
  name: string;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface Connection {
  id: string;
  provider: 'gcp' | 'aws' | 'hetzner';
  name: string;
  status: 'active' | 'error' | 'pending';
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface CostSummaryInstance {
  id: string;
  name: string;
  provider: string;
  status: string;
  instance_type: string | null;
  region: string;
  connection_name: string;
  uptime_hours: number | null;
  monthly_cost: number;
  estimated_monthly_cost: string | null;
}

export interface CostByProject {
  key: string;
  project_name: string;
  project_external_id: string | null;
  connection_name: string;
  provider: string;
  total_monthly: number;
  instance_count: number;
}

export interface DnsConnection {
  id: string;
  provider: 'cloudflare';
  name: string;
  status: 'active' | 'error' | 'pending';
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface DnsRecord {
  id: string;
  dns_connection_id: string;
  connection_name: string;
  provider: string;
  zone: string;
  name: string;
  type: 'A' | 'AAAA' | 'CNAME';
  value: string;
  ttl: number | null;
  proxied: boolean;
  last_seen_at: string;
  matched_instance_id: string | null;
  matched_instance_name: string | null;
}

export interface InstanceDisk {
  device_name: string;
  size_gb: number;
  type: string;
  boot: boolean;
  iface: string;
}

export interface InstanceDetail extends Instance {
  cpu_count: number | null;
  ram_gb: number | null;
  disks: InstanceDisk[];
  domains: string[];
  project_name: string | null;
  project_external_id: string | null;
  database_version: string | null;
}

export interface BillingActual {
  id: string;
  connection_id: string;
  connection_name: string;
  provider: string;
  period: string;
  project_id: string | null;
  project_name: string | null;
  service: string;
  amount_usd: string;
  currency: string;
  fetched_at: string;
}

export interface BillingRefreshResult {
  period: string;
  results: Array<{
    connection_id: string;
    connection_name: string;
    provider: string;
    status: 'ok' | 'skipped' | 'error';
    rows_upserted?: number;
    message?: string;
  }>;
}

export interface AutoUpdateRun {
  id: string;
  status: 'success' | 'error' | 'running';
  error: string | null;
  connections_synced: number;
  instances_synced: number;
  dns_records_synced: number;
  cost_rows_upserted: number;
  started_at: string;
  finished_at: string | null;
}

export interface AutoUpdatePolicy {
  id: string;
  user_id: string;
  name: string;
  scope: 'global' | 'connection' | 'provider';
  target_id: string | null;
  provider: string | null;
  enabled: boolean;
  interval_minutes: number;
  sync_instances: boolean;
  sync_dns: boolean;
  sync_cost: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: 'success' | 'error' | 'running' | null;
  last_error: string | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
}

export interface CostSummary {
  by_project: CostByProject[];
  top_expensive: CostSummaryInstance[];
  long_running: CostSummaryInstance[];
  idle_candidates: CostSummaryInstance[];
  domains_mapped: number;
}

export interface ConfigExport {
  version: number;
  exported_at: string;
  cloud_connections: Array<{ provider: string; name: string; credentials: unknown }>;
  dns_connections: Array<{ provider: string; name: string; credentials: unknown }>;
  auto_update_policies: Array<{
    name: string;
    scope: string;
    provider: string | null;
    enabled: boolean;
    interval_minutes: number;
    sync_instances: boolean;
    sync_dns: boolean;
    sync_cost: boolean;
  }>;
}

export interface ConfigImportResult {
  created: number;
  skipped: number;
  results: Array<{
    type: string;
    name: string;
    status: 'created' | 'skipped';
    reason?: string;
  }>;
}
