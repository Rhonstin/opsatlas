/**
 * GCP cost estimation — static rate table fallback.
 * Ported from gcp-vm-janitor/billing.py.
 * Rates are on-demand USD/hour (us-central1, non-spot).
 */

const APPROX_CPU_RATE: Record<string, number> = {
  n1: 0.031611, n2: 0.031611, n2d: 0.027502,
  e2: 0.021811, c2: 0.03398, c2d: 0.029563,
  m1: 0.0348,   m2: 0.0348,  t2d: 0.027502,
  t2a: 0.026,   n4: 0.031611,
};

const APPROX_RAM_RATE: Record<string, number> = {
  n1: 0.004237, n2: 0.004237, n2d: 0.003686,
  e2: 0.002923, c2: 0.000454, c2d: 0.003965,
  m1: 0.000891, m2: 0.000891, t2d: 0.003686,
  t2a: 0.0035,  n4: 0.004237,
};

const STANDARD_RAM: Record<string, number> = {
  'n1-standard-1': 3.75,  'n1-standard-2': 7.5,   'n1-standard-4': 15.0,
  'n1-standard-8': 30.0,  'n1-standard-16': 60.0,  'n1-standard-32': 120.0,
  'n1-standard-64': 240.0,'n1-standard-96': 360.0,
  'n1-highmem-2': 13.0,   'n1-highmem-4': 26.0,    'n1-highmem-8': 52.0,
  'n1-highmem-16': 104.0, 'n1-highmem-32': 208.0,  'n1-highmem-64': 416.0,
  'n2-standard-2': 8.0,   'n2-standard-4': 16.0,   'n2-standard-8': 32.0,
  'n2-standard-16': 64.0, 'n2-standard-32': 128.0, 'n2-standard-48': 192.0,
  'n2-standard-64': 256.0,'n2-standard-80': 320.0,
  'n2-highmem-2': 16.0,   'n2-highmem-4': 32.0,    'n2-highmem-8': 64.0,
  'n2-highmem-16': 128.0, 'n2-highmem-32': 256.0,  'n2-highmem-64': 512.0,
  'e2-standard-2': 8.0,   'e2-standard-4': 16.0,   'e2-standard-8': 32.0,
  'e2-standard-16': 64.0, 'e2-standard-32': 128.0,
  'e2-highmem-2': 16.0,   'e2-highmem-4': 32.0,    'e2-highmem-8': 64.0,
  'e2-highmem-16': 128.0,
  'e2-highcpu-2': 2.0,    'e2-highcpu-4': 4.0,     'e2-highcpu-8': 8.0,
  'e2-highcpu-16': 16.0,  'e2-highcpu-32': 32.0,
  'e2-medium': 4.0,       'e2-micro': 1.0,          'e2-small': 2.0,
  'f1-micro': 0.6,        'g1-small': 1.7,
  'c2-standard-4': 16.0,  'c2-standard-8': 32.0,   'c2-standard-16': 64.0,
  'c2-standard-30': 120.0,'c2-standard-60': 240.0,
};

const NAMED_VCPU: Record<string, number> = {
  'e2-medium': 2, 'e2-micro': 2, 'e2-small': 2,
  'f1-micro': 1,  'g1-small': 1,
};

// e2-custom-medium/small/micro map to shared vCPU counts
const CUSTOM_NAMED_VCPU: Record<string, number> = {
  micro: 2, small: 2, medium: 2,
};

export function parseMachineType(machineType: string): [number, number] {
  const mt = machineType.toLowerCase();

  // Custom numeric: e2-custom-2-8192 or e2-custom-2-8192-ext
  const customNumeric = mt.match(/^(.+)-custom-(\d+)-(\d+)(?:-ext)?$/);
  if (customNumeric) {
    return [parseInt(customNumeric[2]), parseInt(customNumeric[3]) / 1024];
  }

  // Custom named: e2-custom-medium-8192 (medium/small/micro = shared vCPU preset)
  const customNamed = mt.match(/^(.+)-custom-(micro|small|medium)-(\d+)(?:-ext)?$/);
  if (customNamed) {
    const vcpu = CUSTOM_NAMED_VCPU[customNamed[2]] ?? 2;
    return [vcpu, parseInt(customNamed[3]) / 1024];
  }

  if (mt in STANDARD_RAM) {
    const ramGb = STANDARD_RAM[mt];
    let vcpu = NAMED_VCPU[mt];
    if (!vcpu) {
      const m = mt.match(/-(\d+)$/);
      vcpu = m ? parseInt(m[1]) : 1;
    }
    return [vcpu, ramGb];
  }

  const vcpuMatch = mt.match(/-(\d+)$/);
  const vcpu = vcpuMatch ? parseInt(vcpuMatch[1]) : 1;
  return [vcpu, vcpu * 4.0];
}

function machineFamily(machineType: string): string | null {
  const mt = machineType.toLowerCase();
  for (const family of ['n2d', 'n2', 'n1', 'e2', 'c2d', 'c2', 'm2', 'm1', 't2d', 't2a', 'n4']) {
    if (mt.startsWith(family + '-') || mt === family) return family;
  }
  return null;
}

/** Map an instance region (e.g. "us-central1") to a billing region group. */
export function regionToGroup(region: string): string {
  const r = region.toLowerCase();
  if (r.startsWith('europe-') || r.startsWith('eu-')) return 'europe';
  if (
    r.startsWith('asia-') ||
    r.startsWith('ap-') ||
    r.startsWith('australia')
  ) return 'apac';
  // northamerica-*, southamerica-*, us-* all map to americas
  return 'americas';
}

/**
 * Returns { hourly, monthly } USD estimates for a machine type.
 * Pass `region` and `priceCache` (loaded via loadPriceCache()) to use live
 * billing catalog prices; otherwise falls back to static rate tables.
 */
export function estimateCost(
  machineType: string,
  region?: string,
  priceCache?: Map<string, number>,
): { hourly: number; monthly: number } {
  const [vcpu, ramGb] = parseMachineType(machineType);
  const family = machineFamily(machineType);

  let cpuRate: number;
  let ramRate: number;

  if (priceCache && family && region) {
    const rg = regionToGroup(region);
    // Prefer region-specific price, fall back to americas, then static table
    cpuRate =
      priceCache.get(`${family}:cpu:${rg}`) ??
      priceCache.get(`${family}:cpu:americas`) ??
      APPROX_CPU_RATE[family] ?? 0.03;
    ramRate =
      priceCache.get(`${family}:ram:${rg}`) ??
      priceCache.get(`${family}:ram:americas`) ??
      APPROX_RAM_RATE[family] ?? 0.004;
  } else {
    cpuRate = (family ? APPROX_CPU_RATE[family] : null) ?? 0.03;
    ramRate = (family ? APPROX_RAM_RATE[family] : null) ?? 0.004;
  }

  const hourly = vcpu * cpuRate + ramGb * ramRate;
  return { hourly, monthly: hourly * 730 };
}
