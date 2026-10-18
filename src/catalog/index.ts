import { CPUS, DIMMS, NVME, SUPERCHIPS } from './compute';
import { COOLING_UNITS, PDUS, PSUS, RACKS, STORAGE_SYSTEMS, UPS_SYSTEMS } from './facility';
import { GPUS } from './gpus';
import { MODELS, type ModelArchSpec } from './models';
import { NICS, NVSWITCHES, SWITCHES } from './network';
import { PLATFORMS, RACK_SYSTEMS } from './platforms';
import type {
  CatalogItem,
  CatalogKind,
  CoolingUnitSpec,
  CpuSpec,
  DimmSpec,
  GpuSpec,
  NicSpec,
  NvmeSpec,
  NvSwitchSpec,
  PduSpec,
  PlatformSpec,
  PsuSpec,
  RackSpec,
  RackSystemSpec,
  StorageSystemSpec,
  SuperchipSpec,
  SwitchSpec,
  UpsSpec,
} from './types';

export * from './types';
export type { ModelArchSpec } from './models';

export const CATALOG = {
  gpus: GPUS,
  cpus: CPUS,
  dimms: DIMMS,
  nvme: NVME,
  nics: NICS,
  switches: SWITCHES,
  nvswitches: NVSWITCHES,
  psus: PSUS,
  storage: STORAGE_SYSTEMS,
  racks: RACKS,
  pdus: PDUS,
  ups: UPS_SYSTEMS,
  cooling: COOLING_UNITS,
  superchips: SUPERCHIPS,
  platforms: PLATFORMS,
  rackSystems: RACK_SYSTEMS,
  models: MODELS,
} as const;

export const CATALOG_VERSION = '2026.10.1';

type KindMap = {
  gpu: GpuSpec;
  cpu: CpuSpec;
  dimm: DimmSpec;
  nvme: NvmeSpec;
  nic: NicSpec;
  switch: SwitchSpec;
  nvswitch: NvSwitchSpec;
  psu: PsuSpec;
  storage: StorageSystemSpec;
  rack: RackSpec;
  pdu: PduSpec;
  ups: UpsSpec;
  cooling: CoolingUnitSpec;
  superchip: SuperchipSpec;
  platform: PlatformSpec;
  'rack-system': RackSystemSpec;
};

const ALL_ITEMS: readonly CatalogItem[] = [
  ...GPUS,
  ...CPUS,
  ...DIMMS,
  ...NVME,
  ...NICS,
  ...SWITCHES,
  ...NVSWITCHES,
  ...PSUS,
  ...STORAGE_SYSTEMS,
  ...RACKS,
  ...PDUS,
  ...UPS_SYSTEMS,
  ...COOLING_UNITS,
  ...SUPERCHIPS,
  ...PLATFORMS,
  ...RACK_SYSTEMS,
];

const BY_ID = new Map<string, CatalogItem>(ALL_ITEMS.map((item) => [item.id, item]));
const MODELS_BY_ID = new Map<string, ModelArchSpec>(MODELS.map((m) => [m.id, m]));

export class CatalogLookupError extends Error {
  constructor(
    readonly id: string,
    readonly expected: string,
    readonly actual?: string,
  ) {
    super(
      actual
        ? `Catalog item "${id}" is a ${actual}, expected ${expected}`
        : `Unknown catalog item "${id}" (expected ${expected})`,
    );
    this.name = 'CatalogLookupError';
  }
}

/** Typed lookup that throws when the id does not exist or has a different kind. */
export function part<K extends CatalogKind>(kind: K, id: string): KindMap[K] {
  const item = BY_ID.get(id);
  if (!item) throw new CatalogLookupError(id, kind);
  if (item.kind !== kind) throw new CatalogLookupError(id, kind, item.kind);
  return item as KindMap[K];
}

export function tryPart<K extends CatalogKind>(kind: K, id: string): KindMap[K] | undefined {
  const item = BY_ID.get(id);
  return item && item.kind === kind ? (item as KindMap[K]) : undefined;
}

export function model(id: string): ModelArchSpec {
  const m = MODELS_BY_ID.get(id);
  if (!m) throw new CatalogLookupError(id, 'model');
  return m;
}

export function allCatalogItems(): readonly CatalogItem[] {
  return ALL_ITEMS;
}

/** Linear interpolation over a [x, y] curve (clamped at both ends). */
export function interpolateCurve(curve: readonly (readonly [number, number])[], x: number): number {
  const first = curve[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]!;
    if (x <= x1) {
      const [x0, y0] = curve[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return curve[curve.length - 1]![1];
}
