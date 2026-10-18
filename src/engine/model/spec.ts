/**
 * Declarative infrastructure specification.
 *
 * An {@link InfraSpec} is a compact, JSON-serializable description of a site. Racks are
 * described as groups (`count × template`) so a 4 000-rack hyperscale site stays a few
 * kilobytes. The concrete topology (every rack, node, GPU, switch and link) is derived from
 * it deterministically by `expandTopology`.
 */

export const INFRA_SPEC_VERSION = 1;

export type RackCooling = 'air' | 'rdhx' | 'dlc';
export type Redundancy = 'N' | 'N+1' | 'N+2' | '2N';
export type FabricTopology = 'rail-optimized' | 'fat-tree' | 'none';

/** Per-node deviations from the platform's reference configuration. */
export interface NodeOverrides {
  gpuPowerLimitW?: number;
  dimmId?: string;
  dimmCount?: number;
  dataDriveId?: string;
  dataDriveCount?: number;
  computeNicId?: string;
  psuId?: string;
  psuCount?: number;
}

export type RackSystemRef =
  | { kind: 'platform'; platformId: string; nodesPerRack: number; overrides?: NodeOverrides }
  | { kind: 'rack-system'; rackSystemId: string; overrides?: NodeOverrides };

export interface RackTemplate {
  rackId: string;
  cooling: RackCooling;
  system: RackSystemRef;
  pdu: { pduId: string; perFeed: number; feeds: 1 | 2 };
}

export interface RackGroupSpec {
  count: number;
  template: RackTemplate;
}

export interface RowSpec {
  id: string;
  rackGroups: RackGroupSpec[];
}

export interface HallSpec {
  id: string;
  name: string;
  rows: RowSpec[];
  air: { unitId: string; count: number; redundancy: Redundancy; supplyC: number };
  liquid: { cduId: string; count: number; redundancy: Redundancy; supplyC: number } | null;
}

export interface FabricSpec {
  topology: FabricTopology;
  switchId: string;
  /** Leaf downlink:uplink ratio. 1 = non-blocking. */
  oversubscription: number;
}

export interface SiteSpec {
  name: string;
  code: string;
  city: string;
  country: string;
  climate: { annualMeanC: number; seasonalAmplitudeC: number; diurnalAmplitudeC: number };
  utility: { feedMW: number; feeds: 1 | 2 };
  ups: { upsId: string; modules: number; redundancy: Redundancy };
  generators: { count: number; unitMW: number; redundancy: Redundancy };
  plant: {
    chillerId: string;
    chillers: number;
    chillerRedundancy: Redundancy;
    chilledWaterSupplyC: number;
    dryCoolerId: string | null;
    dryCoolers: number;
    warmWaterSupplyC: number;
    freeCooling: boolean;
  };
  energyPriceEurPerKWh: number;
}

export interface StorageSpec {
  systemId: string;
  count: number;
}

export interface InfraSpec {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  /** Template the spec was generated from, if any. */
  templateId: string | null;
  site: SiteSpec;
  halls: HallSpec[];
  fabric: FabricSpec;
  storage: StorageSpec;
  /** Wall-clock start of the simulation (ISO 8601, UTC). */
  simulationStart: string;
}

/** Number of units held in reserve for a redundancy scheme over `n` installed units. */
export function redundantUnits(redundancy: Redundancy, installed: number): number {
  switch (redundancy) {
    case 'N':
      return 0;
    case 'N+1':
      return Math.min(1, installed);
    case 'N+2':
      return Math.min(2, installed);
    case '2N':
      return Math.floor(installed / 2);
  }
}

/** Units that may carry load while the redundancy target is still met. */
export function usableUnits(redundancy: Redundancy, installed: number): number {
  return Math.max(0, installed - redundantUnits(redundancy, installed));
}
