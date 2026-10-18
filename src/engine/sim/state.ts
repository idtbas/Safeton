/**
 * Struct-of-arrays runtime state. Hot-path quantities live in typed arrays indexed by the
 * topology's node / GPU / switch / link / rack indices. Every array listed in the `*_FIELDS`
 * tables is part of the persisted simulation state and the determinism hash.
 */
import type { Topology } from '../model/topology';

type ArrayCtor =
  | Uint8ArrayConstructor
  | Uint16ArrayConstructor
  | Uint32ArrayConstructor
  | Int32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor;

const NODE_FIELDS = {
  state: Uint8Array,
  stateTimer: Float32Array,
  stateSince: Float64Array,
  upSince: Float64Array,
  powered: Uint8Array,
  drain: Uint8Array,
  /** What to do after a shutdown completes: 0 = stay off, 1 = POST (reboot), 2 = maintenance. */
  afterShutdown: Uint8Array,
  faults: Uint16Array,
  job: Int32Array,
  psuFailed: Uint8Array,
  fanFailed: Uint8Array,
  nicDownMask: Uint16Array,
  nicFlapTimer: Float32Array,
  dimmFault: Uint8Array,
  nvmeFault: Uint8Array,
  nvswitchFault: Uint8Array,
  fanDuty: Float32Array,
  inletC: Float32Array,
  cpuUtil: Float32Array,
  memActivity: Float32Array,
  storageActivity: Float32Array,
  netActivity: Float32Array,
  nvlinkActivity: Float32Array,
  memUsedGB: Float32Array,
  dcW: Float32Array,
  wallW: Float32Array,
  liquidHeatW: Float32Array,
  gpuW: Float32Array,
  gpuUtilAvg: Float32Array,
  gpuTempMax: Float32Array,
  netGbps: Float32Array,
  railGbps: Float32Array, // per (node, rail): nodes * maxRails — sized separately
  storageGBs: Float32Array,
  energyWh: Float64Array,
  bootCount: Uint16Array,
} as const satisfies Record<string, ArrayCtor>;

const GPU_FIELDS = {
  health: Uint8Array,
  util: Float32Array,
  activity: Float32Array,
  memUsedGB: Float32Array,
  powerW: Float32Array,
  tempC: Float32Array,
  clock: Float32Array,
  throttle: Uint8Array,
  powerLimitW: Float32Array,
  eccSbe: Uint32Array,
  eccDbe: Uint32Array,
  retiredRows: Uint16Array,
  lastXid: Uint16Array,
  rthVar: Float32Array,
} as const satisfies Record<string, ArrayCtor>;

const SWITCH_FIELDS = {
  failed: Uint8Array,
  adminUp: Uint8Array,
  trafficGbps: Float32Array,
  util: Float32Array,
  powerW: Float32Array,
} as const satisfies Record<string, ArrayCtor>;

const LINK_FIELDS = {
  up: Uint8Array,
  util: Float32Array,
} as const satisfies Record<string, ArrayCtor>;

const RACK_FIELDS = {
  powerW: Float32Array,
  inletC: Float32Array,
  hotspotC: Float32Array,
  roomHeatW: Float32Array,
  rdhxHeatW: Float32Array,
  liquidHeatW: Float32Array,
} as const satisfies Record<string, ArrayCtor>;

type Instance<C> = C extends Uint8ArrayConstructor
  ? Uint8Array
  : C extends Uint16ArrayConstructor
    ? Uint16Array
    : C extends Uint32ArrayConstructor
      ? Uint32Array
      : C extends Int32ArrayConstructor
        ? Int32Array
        : C extends Float32ArrayConstructor
          ? Float32Array
          : Float64Array;

type Arrays<F extends Record<string, ArrayCtor>> = { [K in keyof F]: Instance<F[K]> };

export type NodeArrays = Arrays<typeof NODE_FIELDS>;
export type GpuArrays = Arrays<typeof GPU_FIELDS>;
export type SwitchArrays = Arrays<typeof SWITCH_FIELDS>;
export type LinkArrays = Arrays<typeof LINK_FIELDS>;
export type RackArrays = Arrays<typeof RACK_FIELDS>;

function allocate<F extends Record<string, ArrayCtor>>(fields: F, n: number, sizes: Partial<Record<keyof F, number>> = {}): Arrays<F> {
  const out = {} as Record<string, unknown>;
  for (const [key, Ctor] of Object.entries(fields)) out[key] = new Ctor(sizes[key as keyof F] ?? n);
  return out as Arrays<F>;
}

export interface RuntimeArrays {
  nodes: NodeArrays;
  gpus: GpuArrays;
  switches: SwitchArrays;
  links: LinkArrays;
  racks: RackArrays;
}

export function allocateRuntime(topo: Topology): RuntimeArrays {
  return {
    nodes: allocate(NODE_FIELDS, topo.nodes.length, { railGbps: topo.nodes.length * Math.max(1, topo.maxRails) }),
    gpus: allocate(GPU_FIELDS, topo.gpuCount),
    switches: allocate(SWITCH_FIELDS, topo.switches.length),
    links: allocate(LINK_FIELDS, topo.links.count),
    racks: allocate(RACK_FIELDS, topo.racks.length),
  };
}

export type SerializedArrays = Record<string, Record<string, ArrayBufferView>>;

export function serializeRuntime(rt: RuntimeArrays): SerializedArrays {
  const out: SerializedArrays = {};
  for (const [group, arrays] of Object.entries(rt)) {
    out[group] = {};
    for (const [key, arr] of Object.entries(arrays as Record<string, ArrayBufferView & { slice(): ArrayBufferView }>)) {
      out[group][key] = arr.slice();
    }
  }
  return out;
}

export function restoreRuntime(rt: RuntimeArrays, data: SerializedArrays): void {
  for (const [group, arrays] of Object.entries(rt)) {
    const src = data[group];
    if (!src) throw new Error(`Snapshot is missing runtime group "${group}"`);
    for (const [key, target] of Object.entries(arrays as Record<string, { length: number; set(a: ArrayLike<number>): void }>)) {
      const s = src[key] as unknown as ArrayLike<number> | undefined;
      if (!s) throw new Error(`Snapshot is missing runtime array "${group}.${key}"`);
      if (s.length !== target.length) {
        throw new Error(`Runtime array "${group}.${key}" length mismatch (${s.length} ≠ ${target.length})`);
      }
      target.set(s);
    }
  }
}

/** Iterates all arrays (stable order) — used for hashing. */
export function forEachArray(rt: RuntimeArrays, fn: (name: string, arr: ArrayBufferView) => void): void {
  for (const group of Object.keys(rt).sort()) {
    const arrays = rt[group as keyof RuntimeArrays] as unknown as Record<string, ArrayBufferView>;
    for (const key of Object.keys(arrays).sort()) fn(`${group}.${key}`, arrays[key]!);
  }
}
