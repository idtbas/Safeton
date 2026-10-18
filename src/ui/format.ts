/**
 * Unit-aware formatting for engineering quantities. Locale-sensitive number formatting, SI
 * prefixes chosen by magnitude, consistent precision.
 */

let locale = 'de-DE';
let timeZone = 'Europe/Berlin';
let tempUnit: 'C' | 'F' = 'C';
let hour12 = false;

export function configureFormatting(opts: {
  locale?: string;
  timeZone?: string;
  temperatureUnit?: 'C' | 'F';
  hourCycle?: 'h23' | 'h12';
}) {
  if (opts.locale) locale = opts.locale;
  if (opts.timeZone) timeZone = opts.timeZone;
  if (opts.temperatureUnit) tempUnit = opts.temperatureUnit;
  if (opts.hourCycle) hour12 = opts.hourCycle === 'h12';
  nfCache.clear();
}

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
    nfCache.set(key, f);
  }
  return f;
}

export function formatNumber(v: number, digits = 0, minDigits = digits): string {
  if (!Number.isFinite(v)) return '—';
  return nf(minDigits, digits).format(v);
}

/** Picks a precision that keeps ~3 significant digits. */
function auto(v: number): string {
  const a = Math.abs(v);
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return formatNumber(v, digits, digits);
}

export interface Quantity {
  value: string;
  unit: string;
}

function scaled(v: number, units: [number, string][]): Quantity {
  if (!Number.isFinite(v)) return { value: '—', unit: units[0]![1] };
  const a = Math.abs(v);
  let chosen = units[0]!;
  for (const u of units) if (a >= u[0]) chosen = u;
  return { value: auto(v / chosen[0]), unit: chosen[1] };
}

export const q = (x: Quantity) => `${x.value} ${x.unit}`;

export function power(w: number): Quantity {
  return scaled(w, [
    [1, 'W'],
    [1e3, 'kW'],
    [1e6, 'MW'],
    [1e9, 'GW'],
  ]);
}

export function energyWh(wh: number): Quantity {
  return scaled(wh, [
    [1, 'Wh'],
    [1e3, 'kWh'],
    [1e6, 'MWh'],
    [1e9, 'GWh'],
  ]);
}

export function bandwidthGbps(gbps: number): Quantity {
  return scaled(gbps * 1e9, [
    [1, 'b/s'],
    [1e3, 'kb/s'],
    [1e6, 'Mb/s'],
    [1e9, 'Gb/s'],
    [1e12, 'Tb/s'],
    [1e15, 'Pb/s'],
  ]);
}

export function bytesGB(gb: number): Quantity {
  return scaled(gb * 1e9, [
    [1, 'B'],
    [1e3, 'kB'],
    [1e6, 'MB'],
    [1e9, 'GB'],
    [1e12, 'TB'],
    [1e15, 'PB'],
  ]);
}

export function throughputGBs(gbs: number): Quantity {
  return scaled(gbs * 1e9, [
    [1, 'B/s'],
    [1e6, 'MB/s'],
    [1e9, 'GB/s'],
    [1e12, 'TB/s'],
  ]);
}

export function flops(f: number): Quantity {
  return scaled(f, [
    [1, 'FLOP/s'],
    [1e12, 'TFLOP/s'],
    [1e15, 'PFLOP/s'],
    [1e18, 'EFLOP/s'],
  ]);
}

export function count(v: number): Quantity {
  return scaled(v, [
    [1, ''],
    [1e3, 'K'],
    [1e6, 'M'],
    [1e9, 'B'],
    [1e12, 'T'],
  ]);
}

export function compact(v: number): string {
  const c = count(v);
  return c.unit ? `${c.value}${c.unit}` : c.value;
}

export function currency(v: number, cur: 'EUR' | 'USD' = 'EUR'): string {
  const a = Math.abs(v);
  const c = cur === 'EUR' ? '€' : '$';
  if (a >= 1e9)
    return `${formatNumber(v / 1e9, 2, 2)} Mrd ${c}`.replace('Mrd', locale.startsWith('de') ? 'Mrd.' : 'B');
  if (a >= 1e6) return `${formatNumber(v / 1e6, 1, 1)} ${locale.startsWith('de') ? 'Mio.' : 'M'} ${c}`;
  if (a >= 1e3) return `${formatNumber(v / 1e3, 1, 1)} ${locale.startsWith('de') ? 'Tsd.' : 'K'} ${c}`;
  return `${formatNumber(v, 0)} ${c}`;
}

export function percent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${formatNumber(fraction * 100, digits, digits)} %`;
}

export function temperature(c: number, digits = 1): string {
  if (!Number.isFinite(c)) return '—';
  return tempUnit === 'F'
    ? `${formatNumber((c * 9) / 5 + 32, digits, digits)} °F`
    : `${formatNumber(c, digits, digits)} °C`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${String(h % 24).padStart(2, '0')}h`;
}

export function dateTime(epochMs: number, withSeconds = true): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12,
  }).format(epochMs);
}

export function clockTime(epochMs: number): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12,
  }).format(epochMs);
}
