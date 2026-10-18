/**
 * Design-time metrics computed bottom-up from the topology and the catalog. Nothing here is a
 * free parameter: capacity, power, PUE and cost all follow from the selected components.
 */
import { part } from '../../catalog';
import { ambientTemperatureC, facilityPower } from '../physics/facility';
import { CABLE_LENGTH_M, CABLE_NS_PER_M } from './fabric';
import { buildPlantParams, rdhxCapacityW, splitRackHeat } from './plant';
import { usableUnits } from './spec';
import type { Topology } from './topology';

export interface DerivedMetrics {
  counts: {
    halls: number;
    racks: number;
    computeRacks: number;
    networkRacks: number;
    storageRacks: number;
    nodes: number;
    gpus: number;
    cpus: number;
    cpuCores: number;
    switches: number;
    links: number;
    scaleUpDomains: number;
  };
  compute: {
    /** Dense peak in PFLOPS. */
    peakDense: { fp64: number; tf32: number; bf16: number; fp8: number; fp4: number };
    peakSparseFp8: number;
    hbmTB: number;
    hbmBandwidthPBs: number;
    hostMemoryTB: number;
    localNvmeTB: number;
  };
  network: {
    topology: string;
    tiers: number;
    planes: number;
    switchModel: string | null;
    linkSpeedGbps: number;
    oversubscription: number;
    injectionTbps: number;
    bisectionTbps: number;
    latencyUs: { sameLeaf: number; viaSpine: number; viaCore: number };
  };
  storage: { systems: number; usablePB: number; readGBs: number; writeGBs: number };
  power: {
    itIdleKW: number;
    itPeakKW: number;
    maxRackKW: number;
    avgComputeRackKW: number;
    facilityPeakKW: number;
    designAmbientC: number;
    pueAnnual: number;
    pueAtPeak: number;
  };
  cooling: {
    roomAirKW: number;
    rdhxKW: number;
    liquidKW: number;
    airUsableKW: number;
    liquidUsableKW: number;
    chillerUsableKW: number;
  };
  cost: {
    computeUsd: number;
    networkUsd: number;
    storageUsd: number;
    facilityUsd: number;
    totalUsd: number;
    perGpuUsd: number;
    energyEurPerYear: number;
  };
}

/** Average IT load relative to design peak for annual energy estimates (assumption). */
export const ANNUAL_LOAD_FACTOR = 0.75;
/** Extreme-day margin above the mean summer afternoon maximum (≈ ASHRAE 0.4 % design dry-bulb; assumption). */
export const DESIGN_AMBIENT_MARGIN_C = 5;

export function designAmbientC(climate: {
  annualMeanC: number;
  seasonalAmplitudeC: number;
  diurnalAmplitudeC: number;
}) {
  return (
    climate.annualMeanC + climate.seasonalAmplitudeC + climate.diurnalAmplitudeC + DESIGN_AMBIENT_MARGIN_C
  );
}
/** Optics + fibre per link end-to-end, by port speed (estimates, USD). */
const OPTICS_COST_PER_LINK: Record<number, number> = { 200: 1_000, 400: 1_750, 800: 3_000 };
/** Building shell, electrical and mechanical distribution per MW of critical IT (assumption, USD). */
const FACILITY_SHELL_USD_PER_MW = 7_500_000;
const GENERATOR_USD_PER_MW = 600_000;

export function deriveMetrics(topo: Topology): DerivedMetrics {
  const { nodes, racks, switches, storage, halls, fabric } = topo;
  const site = topo.spec.site;

  let fp64 = 0;
  let tf32 = 0;
  let bf16 = 0;
  let fp8 = 0;
  let fp4 = 0;
  let fp8Sparse = 0;
  let hbm = 0;
  let hbmBw = 0;
  let hostMem = 0;
  let nvme = 0;
  let cpus = 0;
  let cores = 0;
  let injection = 0;
  let computeUsd = 0;

  for (const node of nodes) {
    const c = node.cfg;
    const g = c.gpu;
    const n = c.gpuCount;
    fp64 += g.peak.fp64Tensor.v * n;
    tf32 += g.peak.tf32.dense.v * n;
    bf16 += g.peak.bf16.dense.v * n;
    fp8 += (g.peak.fp8?.dense.v ?? 0) * n;
    fp4 += (g.peak.fp4?.dense.v ?? 0) * n;
    fp8Sparse += (g.peak.fp8?.sparse?.v ?? 0) * n;
    hbm += g.memory.capacityGB.v * n;
    hbmBw += g.memory.bandwidthGBs.v * n;
    hostMem += c.hostMemoryGB;
    nvme += c.dataDrive.capacityTB * c.dataDriveCount;
    cpus += c.cpuCount;
    cores += c.cpuCount * c.cpu.cores;
    injection += c.rails * c.computeNic.portSpeedGbps;
    computeUsd += c.costUsd;
  }

  const rdhxCap = rdhxCapacityW();
  let itIdle = 0;
  let itPeak = 0;
  let maxRack = 0;
  let computeRackPeak = 0;
  let computeRacks = 0;
  let roomAir = 0;
  let rdhxHeat = 0;
  let liquid = 0;
  let rackCapex = 0;
  let rdhxDoors = 0;
  for (const rack of racks) {
    let rackIdle = rack.auxIdleW;
    let rackLiquid = 0;
    for (let i = 0; i < rack.nodeCount; i++) {
      const cfg = nodes[rack.nodeStart + i]!.cfg;
      rackIdle += cfg.idleWallW;
      rackLiquid += cfg.peakWallW * cfg.liquidHeatFractionAtPeak;
    }
    // Liquid-cooled NVLink switch trays reject most of their heat to the loop.
    if (rack.rackSystem) rackLiquid += rack.auxPeakW * 0.85;
    itIdle += rackIdle;
    itPeak += rack.designPeakW;
    maxRack = Math.max(maxRack, rack.designPeakW);
    if (rack.kind === 'compute') {
      computeRacks++;
      computeRackPeak += rack.designPeakW;
    }
    const split = splitRackHeat(rack.cooling, rack.designPeakW, rackLiquid, rdhxCap);
    roomAir += split.roomAirW;
    rdhxHeat += split.rdhxW;
    liquid += split.liquidW;
    rackCapex += rack.spec.costUsd.v + rack.pdu.spec.costUsd.v * rack.pdu.perFeed * rack.pdu.feeds;
    if (rack.rackSystem) rackCapex += rack.rackSystem.costUsd.v;
    if (rack.cooling === 'rdhx') rdhxDoors++;
  }

  // ---- Network ---------------------------------------------------------------------------
  let networkUsd = 0;
  for (const sw of switches) networkUsd += sw.spec.costUsd.v;
  const linkCost = OPTICS_COST_PER_LINK[fabric.portSpeedGbps] ?? 2_000;
  for (let i = 0; i < topo.links.count; i++) {
    const ports =
      topo.links.tier[i] === 0 ? 1 : topo.links.bandwidthGbps[i]! / Math.max(1, fabric.portSpeedGbps);
    networkUsd += ports * linkCost;
  }
  const swLat = fabric.switchSpec?.latencyNs.v ?? 0;
  const nicLat = nodes[0]?.cfg.computeNic.latencyNs.v ?? 0;
  const access = CABLE_LENGTH_M.access * CABLE_NS_PER_M;
  const ls = CABLE_LENGTH_M.leafSpine * CABLE_NS_PER_M;
  const sc = CABLE_LENGTH_M.spineCore * CABLE_NS_PER_M;
  const sameLeaf = 2 * nicLat + 2 * access + swLat;
  const viaSpine = sameLeaf + 2 * ls + 2 * swLat;
  const viaCore = viaSpine + 2 * sc + 2 * swLat;
  const bisectionPerPlane =
    fabric.tiers === 0
      ? 0
      : (fabric.endpointsPerPlane * fabric.portSpeedGbps) / Math.max(1, fabric.oversubscription) / 2;

  // ---- Storage ---------------------------------------------------------------------------
  let storUsable = 0;
  let storRead = 0;
  let storWrite = 0;
  let storageUsd = 0;
  for (const s of storage) {
    storUsable += s.spec.usableTB.v;
    storRead += s.spec.readGBs.v;
    storWrite += s.spec.writeGBs.v;
    storageUsd += s.spec.costUsd.v;
  }

  // ---- Facility --------------------------------------------------------------------------
  const plant = buildPlantParams(topo);
  const designAmbient = designAmbientC(site.climate);
  const atPeak = facilityPower(plant, {
    itW: itPeak,
    roomAirHeatW: roomAir,
    rdhxHeatW: rdhxHeat,
    liquidHeatW: liquid,
    ambientC: designAmbient,
  });
  const lf = ANNUAL_LOAD_FACTOR;
  // Annual PUE: integrate over a representative year (monthly × 4-hourly samples).
  let annualFacilityWh = 0;
  let annualItWh = 0;
  const year = new Date(topo.spec.simulationStart).getUTCFullYear();
  for (let month = 0; month < 12; month++) {
    for (let hour = 0; hour < 24; hour += 4) {
      const t = Date.UTC(year, month, 15, hour);
      const amb = ambientTemperatureC(site.climate, t);
      const p = facilityPower(plant, {
        itW: itPeak * lf,
        roomAirHeatW: roomAir * lf,
        rdhxHeatW: rdhxHeat * lf,
        liquidHeatW: liquid * lf,
        ambientC: amb,
      });
      annualFacilityWh += p.facilityW;
      annualItWh += itPeak * lf;
    }
  }
  const pueAnnual = annualItWh > 0 ? annualFacilityWh / annualItWh : 0;
  const energyEurPerYear = ((itPeak * lf * pueAnnual * 8760) / 1000) * site.energyPriceEurPerKWh;

  let coolingUsd = rdhxDoors * part('cooling', 'rdhx-75').costUsd.v;
  let airUsable = 0;
  let liquidUsable = 0;
  for (const hall of halls) {
    coolingUsd += hall.spec.air.count * hall.airUnit.costUsd.v;
    airUsable += hall.airUsableW;
    if (hall.liquidUnit && hall.spec.liquid) coolingUsd += hall.spec.liquid.count * hall.liquidUnit.costUsd.v;
    liquidUsable += hall.liquidUsableW;
  }
  const chiller = part('cooling', site.plant.chillerId);
  coolingUsd += site.plant.chillers * chiller.costUsd.v;
  if (site.plant.dryCoolerId)
    coolingUsd += site.plant.dryCoolers * part('cooling', site.plant.dryCoolerId).costUsd.v;
  const ups = part('ups', site.ups.upsId);
  const upsUsd = site.ups.modules * ups.costUsdPerModule.v;
  const genUsd = site.generators.count * site.generators.unitMW * GENERATOR_USD_PER_MW;
  const shellUsd = (itPeak / 1e6) * FACILITY_SHELL_USD_PER_MW;
  const facilityUsd = rackCapex + coolingUsd + upsUsd + genUsd + shellUsd;

  const totalUsd = computeUsd + networkUsd + storageUsd + facilityUsd;
  const gpus = topo.gpuCount;

  return {
    counts: {
      halls: halls.length,
      racks: racks.length,
      computeRacks,
      networkRacks: racks.filter((r) => r.kind === 'network').length,
      storageRacks: racks.filter((r) => r.kind === 'storage').length,
      nodes: nodes.length,
      gpus,
      cpus,
      cpuCores: cores,
      switches: switches.length,
      links: topo.links.count,
      scaleUpDomains: topo.nvlDomainCount,
    },
    compute: {
      peakDense: {
        fp64: fp64 / 1000,
        tf32: tf32 / 1000,
        bf16: bf16 / 1000,
        fp8: fp8 / 1000,
        fp4: fp4 / 1000,
      },
      peakSparseFp8: fp8Sparse / 1000,
      hbmTB: hbm / 1000,
      hbmBandwidthPBs: hbmBw / 1e6,
      hostMemoryTB: hostMem / 1000,
      localNvmeTB: nvme,
    },
    network: {
      topology: fabric.topology,
      tiers: fabric.tiers,
      planes: fabric.planes,
      switchModel: fabric.switchSpec?.name ?? null,
      linkSpeedGbps: fabric.portSpeedGbps,
      oversubscription: fabric.oversubscription,
      injectionTbps: injection / 1000,
      bisectionTbps: (bisectionPerPlane * fabric.planes) / 1000,
      latencyUs: {
        sameLeaf: sameLeaf / 1000,
        viaSpine: fabric.tiers >= 2 ? viaSpine / 1000 : 0,
        viaCore: fabric.tiers >= 3 ? viaCore / 1000 : 0,
      },
    },
    storage: { systems: storage.length, usablePB: storUsable / 1000, readGBs: storRead, writeGBs: storWrite },
    power: {
      itIdleKW: itIdle / 1000,
      itPeakKW: itPeak / 1000,
      maxRackKW: maxRack / 1000,
      avgComputeRackKW: computeRacks > 0 ? computeRackPeak / computeRacks / 1000 : 0,
      facilityPeakKW: atPeak.facilityW / 1000,
      designAmbientC: designAmbient,
      pueAnnual,
      pueAtPeak: atPeak.pue,
    },
    cooling: {
      roomAirKW: roomAir / 1000,
      rdhxKW: rdhxHeat / 1000,
      liquidKW: liquid / 1000,
      airUsableKW: airUsable / 1000,
      liquidUsableKW: liquidUsable / 1000,
      chillerUsableKW: usableUnits(site.plant.chillerRedundancy, site.plant.chillers) * chiller.capacityKW.v,
    },
    cost: {
      computeUsd,
      networkUsd,
      storageUsd,
      facilityUsd,
      totalUsd,
      perGpuUsd: gpus > 0 ? totalUsd / gpus : 0,
      energyEurPerYear,
    },
  };
}
