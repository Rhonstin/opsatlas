/** Shared cost/uptime helpers — single source of truth for the dashboard,
 * instances table and instance drawer. */

export const LONG_RUNNING_HOURS = 30 * 24; // 30 days

export interface CostableInstance {
  status: string;
  estimated_hourly_cost: string | null;
  launched_at: string | null;
}

/** Cost accrued from the start of the current month until now (RUNNING only). */
export function calcCostToDate(inst: CostableInstance): number {
  if (inst.status !== 'RUNNING' || !inst.estimated_hourly_cost) return 0;
  const hourly = parseFloat(inst.estimated_hourly_cost);
  const now = Date.now();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const instanceStart = inst.launched_at
    ? Math.max(new Date(inst.launched_at).getTime(), startOfMonth.getTime())
    : startOfMonth.getTime();
  return hourly * ((now - instanceStart) / 3_600_000);
}

export function isLongRunning(inst: { status: string; uptime_hours: number | null }): boolean {
  return inst.status === 'RUNNING' && inst.uptime_hours !== null && inst.uptime_hours > LONG_RUNNING_HOURS;
}

export function isIdle(inst: { status: string }): boolean {
  return inst.status === 'STOPPED' || inst.status === 'TERMINATED';
}

export function fmtUptime(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
