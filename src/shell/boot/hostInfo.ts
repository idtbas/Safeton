/**
 * Facts about the machine running the management console, read from real browser APIs. The
 * firmware stage of the boot reports these instead of invented hardware.
 */
export interface HostInfo {
  platform: string;
  browser: string;
  logicalCores: number | null;
  /** Approximate device memory in GB (Chromium only, rounded by the browser). */
  memoryGB: number | null;
  screen: string;
  pixelRatio: number;
  timeZone: string;
  language: string;
  secureContext: boolean;
  webCrypto: boolean;
  workers: boolean;
  indexedDB: boolean;
  storageQuotaGB: number | null;
  storageUsageMB: number | null;
  online: boolean;
}

interface UADataLike {
  platform?: string;
  brands?: { brand: string; version: string }[];
}

function browserName(ua: string, data: UADataLike | undefined): string {
  const brand = data?.brands?.find((b) => !/not.?a.?brand/i.test(b.brand) && b.brand !== 'Chromium');
  if (brand) return `${brand.brand} ${brand.version}`;
  const m = /(Firefox|Edg|OPR|Chrome|Version)\/(\d+)/.exec(ua) ?? /(HeadlessChrome)\/(\d+)/.exec(ua) ?? null;
  if (!m) return 'Unknown browser';
  const name = m[1] === 'Version' ? 'Safari' : m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1]!;
  return `${name} ${m[2]}`;
}

export async function collectHostInfo(): Promise<HostInfo> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const data = (nav as unknown as { userAgentData?: UADataLike } | undefined)?.userAgentData;
  let quota: number | null = null;
  let usage: number | null = null;
  try {
    const est = await nav?.storage?.estimate?.();
    if (est?.quota) quota = est.quota / 1e9;
    if (est?.usage !== undefined) usage = est.usage / 1e6;
  } catch {
    // Storage estimate is optional.
  }
  return {
    platform: data?.platform || nav?.platform || 'unknown',
    browser: browserName(nav?.userAgent ?? '', data),
    logicalCores: nav?.hardwareConcurrency ?? null,
    memoryGB: (nav as unknown as { deviceMemory?: number } | undefined)?.deviceMemory ?? null,
    screen: typeof screen !== 'undefined' ? `${screen.width}×${screen.height}` : 'n/a',
    pixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: nav?.language ?? 'n/a',
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    webCrypto: typeof crypto !== 'undefined' && !!crypto.subtle,
    workers: typeof Worker !== 'undefined',
    indexedDB: typeof indexedDB !== 'undefined',
    storageQuotaGB: quota,
    storageUsageMB: usage,
    online: nav?.onLine ?? true,
  };
}
