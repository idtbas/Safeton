/**
 * Infrastructure templates. Each template defines the IT design (systems, racks, fabric,
 * storage, site); the facility (air handlers, CDUs, chillers, dry coolers, UPS, generators,
 * utility feed) is sized automatically from the resulting heat and power loads with N+1
 * redundancy — the way a design engineer would size the plant around an IT load.
 */
import { part } from '../../catalog';
import { facilityPower } from '../physics/facility';
import { designAmbientC } from './derive';
import { buildPlantParams, rdhxCapacityW, splitRackHeat } from './plant';
import {
  INFRA_SPEC_VERSION,
  type FabricSpec,
  type HallSpec,
  type InfraSpec,
  type RackCooling,
  type RackSystemRef,
  type SiteSpec,
  type StorageSpec,
} from './spec';
import { expandTopology } from './topology';

export interface DesignInput {
  id: string;
  name: string;
  description: string;
  templateId: string | null;
  site: Pick<SiteSpec, 'name' | 'code' | 'city' | 'country' | 'climate' | 'energyPriceEurPerKWh'>;
  compute: {
    system: RackSystemRef;
    racks: number;
    rackId: string;
    cooling: RackCooling;
    pdu: { pduId: string; perFeed: number; feeds: 1 | 2 };
  };
  halls: number;
  racksPerRow: number;
  fabric: FabricSpec;
  storage: StorageSpec;
  airSupplyC?: number;
  warmWaterSupplyC?: number;
  simulationStart?: string;
}

const ROW_IDS = 'ABCDEFGHJKLMPQRTUVWXYZ'.split('');
const DEFAULT_START = '2026-10-19T07:00:00.000Z';

const nPlus1 = (load: number, unit: number, min = 2) => Math.max(min, Math.ceil(load / unit) + 1);

export function designInfrastructure(input: DesignInput): InfraSpec {
  const airSupplyC = input.airSupplyC ?? 24;
  const warmSupplyC = input.warmWaterSupplyC ?? 32;
  const halls: HallSpec[] = [];
  const racksPerHall = Math.ceil(input.compute.racks / input.halls);
  let remaining = input.compute.racks;
  for (let h = 0; h < input.halls && remaining > 0; h++) {
    const hallRacks = Math.min(racksPerHall, remaining);
    remaining -= hallRacks;
    const rows = [];
    let left = hallRacks;
    for (let r = 0; left > 0; r++) {
      const count = Math.min(input.racksPerRow, left);
      left -= count;
      rows.push({
        id:
          ROW_IDS[r % ROW_IDS.length]! + (r >= ROW_IDS.length ? String(Math.floor(r / ROW_IDS.length)) : ''),
        rackGroups: [
          {
            count,
            template: {
              rackId: input.compute.rackId,
              cooling: input.compute.cooling,
              system: input.compute.system,
              pdu: input.compute.pdu,
            },
          },
        ],
      });
    }
    halls.push({
      id: `H${h + 1}`,
      name: `Data Hall ${h + 1}`,
      rows,
      air: { unitId: 'crah-150', count: 2, redundancy: 'N+1', supplyC: airSupplyC },
      liquid:
        input.compute.cooling === 'dlc'
          ? { cduId: 'cdu-row-1350', count: 2, redundancy: 'N+1', supplyC: warmSupplyC }
          : null,
    });
  }

  const provisional: InfraSpec = {
    schemaVersion: INFRA_SPEC_VERSION,
    id: input.id,
    name: input.name,
    description: input.description,
    templateId: input.templateId,
    site: {
      ...input.site,
      utility: { feedMW: 1, feeds: 2 },
      ups: { upsId: 'ups-modular-250', modules: 2, redundancy: 'N+1' },
      generators: { count: 2, unitMW: 3, redundancy: 'N+1' },
      plant: {
        chillerId: 'chiller-air-1000',
        chillers: 2,
        chillerRedundancy: 'N+1',
        chilledWaterSupplyC: 18,
        dryCoolerId: input.compute.cooling === 'dlc' ? 'drycooler-1200' : null,
        dryCoolers: input.compute.cooling === 'dlc' ? 2 : 0,
        warmWaterSupplyC: warmSupplyC,
        freeCooling: true,
      },
    },
    halls,
    fabric: input.fabric,
    storage: input.storage,
    simulationStart: input.simulationStart ?? DEFAULT_START,
  };

  // ---- Size the plant from the IT design ------------------------------------------------
  const topo = expandTopology(provisional);
  const rdhxCap = rdhxCapacityW();
  let itW = 0;
  let totalRoom = 0;
  let totalRdhx = 0;
  let totalLiquid = 0;
  const hallLoads = topo.halls.map(() => ({ room: 0, liquid: 0, it: 0 }));
  for (const rack of topo.racks) {
    let liquid = 0;
    for (let i = 0; i < rack.nodeCount; i++) {
      const c = topo.nodes[rack.nodeStart + i]!.cfg;
      liquid += c.peakWallW * c.liquidHeatFractionAtPeak;
    }
    if (rack.rackSystem) liquid += rack.auxPeakW * 0.85;
    const split = splitRackHeat(rack.cooling, rack.designPeakW, liquid, rdhxCap);
    hallLoads[rack.hallIdx]!.room += split.roomAirW;
    hallLoads[rack.hallIdx]!.liquid += split.liquidW;
    hallLoads[rack.hallIdx]!.it += rack.designPeakW;
    itW += rack.designPeakW;
    totalRoom += split.roomAirW;
    totalRdhx += split.rdhxW;
    totalLiquid += split.liquidW;
  }

  provisional.halls.forEach((hall, i) => {
    const load = hallLoads[i]!;
    // Room air handlers are sized for at least 10 % of the hall IT load even when rear doors or
    // cold plates take most of the heat (residual heat, humidity control, door failures).
    const roomDesignW = Math.max(load.room, load.it * 0.1);
    const airUnit = roomDesignW < 300_000 ? 'inrow-50' : 'crah-150';
    const airCap = part('cooling', airUnit).capacityKW.v * 1000;
    hall.air = { ...hall.air, unitId: airUnit, count: nPlus1(roomDesignW, airCap) };
    if (hall.liquid) {
      const cdu = load.liquid < 600_000 ? 'cdu-inrack-150' : 'cdu-row-1350';
      const cap = part('cooling', cdu).capacityKW.v * 1000;
      hall.liquid = { ...hall.liquid, cduId: cdu, count: nPlus1(load.liquid, cap) };
    }
  });

  const plant = provisional.site.plant;
  const chilledW = totalRoom + totalRdhx + (plant.dryCoolerId ? 0 : totalLiquid);
  const chillerId =
    chilledW < 600_000 ? 'chiller-air-250' : chilledW < 6_000_000 ? 'chiller-air-1000' : 'chiller-water-3500';
  const chillerCap = part('cooling', chillerId).capacityKW.v * 1000;
  plant.chillerId = chillerId;
  plant.chillers = nPlus1(chilledW * 1.1, chillerCap);
  if (plant.dryCoolerId) {
    const dcCap = part('cooling', plant.dryCoolerId).capacityKW.v * 1000;
    plant.dryCoolers = nPlus1(totalLiquid, dcCap);
  }
  const upsId = itW < 500_000 ? 'ups-modular-50' : 'ups-modular-250';
  provisional.site.ups = {
    upsId,
    modules: nPlus1(itW, part('ups', upsId).moduleKW.v * 1000),
    redundancy: 'N+1',
  };

  const sized = expandTopology(provisional);
  const facility = facilityPower(buildPlantParams(sized), {
    itW,
    roomAirHeatW: totalRoom,
    rdhxHeatW: totalRdhx,
    liquidHeatW: totalLiquid,
    ambientC: designAmbientC(input.site.climate),
  });
  const facilityMW = facility.facilityW / 1e6;
  const genUnitMW = facilityMW < 0.5 ? 0.25 : facilityMW < 2 ? 0.5 : 3;
  provisional.site.generators = {
    count: nPlus1(facilityMW, genUnitMW),
    unitMW: genUnitMW,
    redundancy: 'N+1',
  };
  const feedStep = facilityMW < 2 ? 0.25 : facilityMW < 20 ? 1 : 5;
  provisional.site.utility = { feedMW: Math.ceil((facilityMW * 1.2) / feedStep) * feedStep, feeds: 2 };

  return provisional;
}

export interface InfraTemplate {
  id: string;
  name: string;
  tier: string;
  summary: string;
  /** Editable design input; `build()` sizes the facility around it. */
  input: () => DesignInput;
  build: () => InfraSpec;
}

function template(t: Omit<InfraTemplate, 'build' | 'input'> & { design: () => DesignInput }): InfraTemplate {
  return {
    id: t.id,
    name: t.name,
    tier: t.tier,
    summary: t.summary,
    input: t.design,
    build: () => designInfrastructure(t.design()),
  };
}

const FRANKFURT = {
  city: 'Frankfurt am Main',
  country: 'DE',
  climate: { annualMeanC: 10.5, seasonalAmplitudeC: 9.5, diurnalAmplitudeC: 4.5 },
  energyPriceEurPerKWh: 0.18,
};

export const TEMPLATES: readonly InfraTemplate[] = [
  template({
    id: 'single-server',
    name: 'Single AI Server',
    tier: 'Server',
    summary: '1 × HGX H100 8-GPU in a lab rack, air cooled, no backend fabric',
    design: () => ({
      id: 'single-server',
      name: 'Single AI Server',
      description: 'One HGX H100 8-GPU system in a 42U lab rack with local storage and an NFS appliance.',
      templateId: 'single-server',
      site: {
        name: 'Engineering Lab',
        code: 'MUC-LAB',
        city: 'München',
        country: 'DE',
        climate: { annualMeanC: 9.5, seasonalAmplitudeC: 9.5, diurnalAmplitudeC: 5 },
        energyPriceEurPerKWh: 0.2,
      },
      compute: {
        system: { kind: 'platform', platformId: 'hgx-h100-8gpu', nodesPerRack: 1 },
        racks: 1,
        rackId: 'rack-42u-600',
        cooling: 'air',
        pdu: { pduId: 'pdu-3ph-415v-32a', perFeed: 1, feeds: 2 },
      },
      halls: 1,
      racksPerRow: 8,
      fabric: { topology: 'none', switchId: 'nvidia-qm9700', oversubscription: 1 },
      storage: { systemId: 'generic-flash-nfs-node', count: 1 },
    }),
  }),
  template({
    id: 'gpu-rack',
    name: 'GPU Rack',
    tier: 'Rack',
    summary: '4 × HGX H200 (32 GPUs), rear-door cooled, single NDR switch',
    design: () => ({
      id: 'gpu-rack',
      name: 'GPU Rack',
      description:
        'Four HGX H200 systems in one 48U rack with an active rear-door heat exchanger and one Quantum-2 switch.',
      templateId: 'gpu-rack',
      site: { name: 'Colocation Suite', code: 'FRA-C4', ...FRANKFURT },
      compute: {
        system: { kind: 'platform', platformId: 'hgx-h200-8gpu', nodesPerRack: 4 },
        racks: 1,
        rackId: 'rack-48u-800',
        cooling: 'rdhx',
        pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 2, feeds: 2 },
      },
      halls: 1,
      racksPerRow: 8,
      fabric: { topology: 'fat-tree', switchId: 'nvidia-qm9700', oversubscription: 1 },
      storage: { systemId: 'generic-flash-nfs-node', count: 2 },
    }),
  }),
  template({
    id: 'cluster-256',
    name: 'GPU Cluster 256',
    tier: 'Cluster',
    summary: '32 × HGX H100 (256 GPUs), rail-optimized NDR fabric, Lustre storage',
    design: () => ({
      id: 'cluster-256',
      name: 'GPU Cluster 256',
      description: 'One scalable unit: 32 HGX H100 systems, 8-rail NDR InfiniBand, two AI400X2 appliances.',
      templateId: 'cluster-256',
      site: { name: 'Frankfurt Campus', code: 'FRA1', ...FRANKFURT },
      compute: {
        system: { kind: 'platform', platformId: 'hgx-h100-8gpu', nodesPerRack: 4 },
        racks: 8,
        rackId: 'rack-48u-800',
        cooling: 'rdhx',
        pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 2, feeds: 2 },
      },
      halls: 1,
      racksPerRow: 8,
      fabric: { topology: 'rail-optimized', switchId: 'nvidia-qm9700', oversubscription: 1 },
      storage: { systemId: 'ddn-ai400x2', count: 2 },
    }),
  }),
  template({
    id: 'enterprise-4096',
    name: 'Enterprise AI Data Center',
    tier: 'Enterprise',
    summary: '512 × HGX H200 (4 096 GPUs), two halls, 2-tier NDR fat-tree per rail',
    design: () => ({
      id: 'enterprise-4096',
      name: 'Enterprise AI Data Center',
      description:
        '512 HGX H200 systems in two data halls, rail-optimized non-blocking NDR fabric, 8 AI400X2.',
      templateId: 'enterprise-4096',
      site: { name: 'Frankfurt Campus', code: 'FRA2', ...FRANKFURT },
      compute: {
        system: { kind: 'platform', platformId: 'hgx-h200-8gpu', nodesPerRack: 4 },
        racks: 128,
        rackId: 'rack-48u-800',
        cooling: 'rdhx',
        pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 2, feeds: 2 },
      },
      halls: 2,
      racksPerRow: 16,
      fabric: { topology: 'rail-optimized', switchId: 'nvidia-qm9700', oversubscription: 1 },
      storage: { systemId: 'ddn-ai400x2', count: 8 },
    }),
  }),
  template({
    id: 'supercomputer-nvl72',
    name: 'NVL72 AI Supercomputer',
    tier: 'Supercomputer',
    summary: '64 × GB200 NVL72 (4 608 GPUs), direct liquid cooling, Nordic site',
    design: () => ({
      id: 'supercomputer-nvl72',
      name: 'NVL72 AI Supercomputer',
      description:
        '64 GB200 NVL72 racks (72-GPU NVLink domains), warm-water DLC with dry coolers, 4-rail NDR fabric.',
      templateId: 'supercomputer-nvl72',
      site: {
        name: 'Nordic Compute Campus',
        code: 'LLA1',
        city: 'Luleå',
        country: 'SE',
        climate: { annualMeanC: 2, seasonalAmplitudeC: 11.5, diurnalAmplitudeC: 4 },
        energyPriceEurPerKWh: 0.06,
      },
      compute: {
        system: { kind: 'rack-system', rackSystemId: 'gb200-nvl72' },
        racks: 64,
        rackId: 'rack-mgx-48u',
        cooling: 'dlc',
        pdu: { pduId: 'pdu-3ph-415v-125a', perFeed: 2, feeds: 2 },
      },
      halls: 2,
      racksPerRow: 16,
      fabric: { topology: 'rail-optimized', switchId: 'nvidia-qm9700', oversubscription: 1 },
      storage: { systemId: 'ddn-ai400x2', count: 16 },
    }),
  }),
  template({
    id: 'hyperscale-32k',
    name: 'Hyperscale AI Campus',
    tier: 'Hyperscale',
    summary: '4 096 × HGX B200 (32 768 GPUs), DLC, 800G XDR fabric, four halls',
    design: () => ({
      id: 'hyperscale-32k',
      name: 'Hyperscale AI Campus',
      description:
        '4 096 liquid-cooled HGX B200 systems with ConnectX-8, rail-optimized Quantum-X800 fabric, 64 AI400X2.',
      templateId: 'hyperscale-32k',
      site: {
        name: 'Dallas–Fort Worth Campus',
        code: 'DFW1',
        city: 'Dallas',
        country: 'US',
        climate: { annualMeanC: 19, seasonalAmplitudeC: 10, diurnalAmplitudeC: 6 },
        energyPriceEurPerKWh: 0.065,
      },
      compute: {
        system: {
          kind: 'platform',
          platformId: 'hgx-b200-8gpu',
          nodesPerRack: 4,
          overrides: { computeNicId: 'nvidia-cx8-xdr' },
        },
        racks: 1024,
        rackId: 'rack-48u-800',
        cooling: 'dlc',
        pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 2, feeds: 2 },
      },
      halls: 4,
      racksPerRow: 32,
      fabric: { topology: 'rail-optimized', switchId: 'nvidia-q3400', oversubscription: 1 },
      storage: { systemId: 'ddn-ai400x2', count: 64 },
    }),
  }),
];

export interface ClimatePreset {
  id: string;
  city: string;
  country: string;
  climate: { annualMeanC: number; seasonalAmplitudeC: number; diurnalAmplitudeC: number };
  /** Typical industrial electricity price (estimate). */
  energyPriceEurPerKWh: number;
}

/** Representative site climates (normals rounded; prices are order-of-magnitude estimates). */
export const CLIMATE_PRESETS: readonly ClimatePreset[] = [
  {
    id: 'frankfurt',
    city: 'Frankfurt am Main',
    country: 'DE',
    climate: { annualMeanC: 10.5, seasonalAmplitudeC: 9.5, diurnalAmplitudeC: 4.5 },
    energyPriceEurPerKWh: 0.18,
  },
  {
    id: 'munich',
    city: 'München',
    country: 'DE',
    climate: { annualMeanC: 9.5, seasonalAmplitudeC: 9.5, diurnalAmplitudeC: 5 },
    energyPriceEurPerKWh: 0.2,
  },
  {
    id: 'dublin',
    city: 'Dublin',
    country: 'IE',
    climate: { annualMeanC: 10, seasonalAmplitudeC: 5, diurnalAmplitudeC: 4 },
    energyPriceEurPerKWh: 0.21,
  },
  {
    id: 'lulea',
    city: 'Luleå',
    country: 'SE',
    climate: { annualMeanC: 2, seasonalAmplitudeC: 11.5, diurnalAmplitudeC: 4 },
    energyPriceEurPerKWh: 0.06,
  },
  {
    id: 'ashburn',
    city: 'Ashburn, Virginia',
    country: 'US',
    climate: { annualMeanC: 13.5, seasonalAmplitudeC: 11, diurnalAmplitudeC: 6 },
    energyPriceEurPerKWh: 0.08,
  },
  {
    id: 'dallas',
    city: 'Dallas',
    country: 'US',
    climate: { annualMeanC: 19, seasonalAmplitudeC: 10, diurnalAmplitudeC: 6 },
    energyPriceEurPerKWh: 0.065,
  },
  {
    id: 'phoenix',
    city: 'Phoenix',
    country: 'US',
    climate: { annualMeanC: 23.5, seasonalAmplitudeC: 10.5, diurnalAmplitudeC: 8 },
    energyPriceEurPerKWh: 0.075,
  },
  {
    id: 'singapore',
    city: 'Singapore',
    country: 'SG',
    climate: { annualMeanC: 27.5, seasonalAmplitudeC: 1, diurnalAmplitudeC: 3.5 },
    energyPriceEurPerKWh: 0.2,
  },
];

export function buildTemplate(id: string): InfraSpec {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown infrastructure template "${id}"`);
  return t.build();
}
