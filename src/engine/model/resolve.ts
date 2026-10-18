/**
 * Resolution of a rack template into a concrete node configuration (bill of materials),
 * including bottom-up idle/peak power derived purely from catalog components.
 */
import {
  part,
  type CoolingMode,
  type CpuSpec,
  type DimmSpec,
  type GpuSpec,
  type NicSpec,
  type NvmeSpec,
  type NvSwitchSpec,
  type PlatformSpec,
  type PsuSpec,
  type RackSystemSpec,
} from '../../catalog';
import { fanPowerW, gpuPowerW, linearPower, psuInputW } from '../physics/power';
import type { RackCooling, RackTemplate } from './spec';

export interface ResolvedNodeConfig {
  readonly key: string;
  readonly platform: PlatformSpec;
  readonly rackSystem: RackSystemSpec | null;
  readonly cooling: CoolingMode;
  readonly gpu: GpuSpec;
  readonly gpuCount: number;
  readonly gpuPowerLimitW: number;
  readonly cpu: CpuSpec;
  readonly cpuCount: number;
  readonly dimm: DimmSpec | null;
  readonly dimmCount: number;
  readonly hostMemoryGB: number;
  readonly memorySpeedMTs: number;
  readonly osDrive: NvmeSpec;
  readonly osDriveCount: number;
  readonly dataDrive: NvmeSpec;
  readonly dataDriveCount: number;
  readonly computeNic: NicSpec;
  /** Number of backend rails (one compute NIC per rail). */
  readonly rails: number;
  readonly storageNic: NicSpec;
  readonly storageNicCount: number;
  readonly nvswitch: NvSwitchSpec | null;
  readonly nvswitchCount: number;
  readonly psu: PsuSpec;
  readonly psuCount: number;
  /** PSUs needed to carry the bottom-up peak DC load. */
  readonly psuRequired: number;
  readonly fanCount: number;
  readonly fanMaxW: number;
  readonly baseboardW: number;
  readonly scaleUpDomainGpus: number;
  readonly rackUnits: number;
  readonly weightKg: number;
  readonly idleDcW: number;
  readonly peakDcW: number;
  readonly idleWallW: number;
  readonly peakWallW: number;
  /** Fraction of peak heat removed by liquid (0 for air-cooled nodes). */
  readonly liquidHeatFractionAtPeak: number;
  readonly costUsd: number;
}

export interface NodeLoadState {
  /** Sum of instantaneous GPU board power (W). */
  gpuW: number;
  /** Average GPU activity (0..1) — drives VRM / baseboard losses. */
  gpuActivity: number;
  cpuUtil: number;
  memActivity: number;
  storageActivity: number;
  networkActivity: number;
  nvlinkActivity: number;
  fanDuty: number;
  fansHealthy: number;
}

export interface NodePowerBreakdown {
  gpuW: number;
  cpuW: number;
  memoryW: number;
  storageW: number;
  networkW: number;
  nvswitchW: number;
  fanW: number;
  baseboardW: number;
  dcW: number;
  /** Heat into the liquid loop (cold plates). */
  liquidHeatW: number;
}

export function rackCoolingToNodeCooling(cooling: RackCooling): CoolingMode {
  return cooling === 'dlc' ? 'liquid' : 'air';
}

/** Effective DIMM speed: limited by CPU support and derated at two DIMMs per channel. */
export function effectiveMemorySpeed(cpu: CpuSpec, dimm: DimmSpec | null, dimmCount: number, cpuCount: number) {
  if (!dimm) return cpu.memory.maxMTs;
  const base = Math.min(dimm.speedMTs, cpu.memory.maxMTs);
  const perChannel = dimmCount / (cpu.memory.channels * cpuCount);
  if (perChannel > 1) return Math.min(base, dimm.type === 'DDR5 RDIMM' ? 4400 : 2933);
  return base;
}

export function nodePowerBreakdown(cfg: ResolvedNodeConfig, s: NodeLoadState): NodePowerBreakdown {
  const cpuW = cfg.cpuCount * linearPower(cfg.cpu.idleW.v, cfg.cpu.tdpW.v, s.cpuUtil);
  const memoryW = cfg.dimm
    ? cfg.dimmCount * linearPower(cfg.dimm.powerIdleW.v, cfg.dimm.powerActiveW.v, s.memActivity)
    : 0;
  const storageW =
    cfg.osDriveCount * cfg.osDrive.powerIdleW.v +
    cfg.dataDriveCount * linearPower(cfg.dataDrive.powerIdleW.v, cfg.dataDrive.powerActiveW.v, s.storageActivity);
  // Adapter power is ~70 % static (SerDes, PHY) and ~30 % traffic dependent.
  const networkW =
    cfg.rails * cfg.computeNic.powerW.v * (0.7 + 0.3 * s.networkActivity) +
    cfg.storageNicCount * cfg.storageNic.powerW.v * (0.7 + 0.3 * s.storageActivity);
  const nvswitchW = cfg.nvswitch ? cfg.nvswitchCount * cfg.nvswitch.powerW.v * (0.4 + 0.6 * s.nvlinkActivity) : 0;
  const fanW = cfg.fanCount * s.fansHealthy * fanPowerW(cfg.fanMaxW, s.fanDuty);
  // VRM and conversion losses on the baseboard scale with GPU load (60 % static).
  const baseboardW = cfg.baseboardW * (0.6 + 0.4 * s.gpuActivity);
  const dcW = s.gpuW + cpuW + memoryW + storageW + networkW + nvswitchW + fanW + baseboardW;
  const liquidHeatW = cfg.cooling === 'liquid' ? s.gpuW + cpuW + nvswitchW : 0;
  return { gpuW: s.gpuW, cpuW, memoryW, storageW, networkW, nvswitchW, fanW, baseboardW, dcW, liquidHeatW };
}

/** Active PSUs share the load; failed units drop out. */
export function nodeWallPowerW(cfg: ResolvedNodeConfig, dcW: number, activePsus: number): number {
  return psuInputW(cfg.psu, dcW, Math.max(1, activePsus));
}

const IDLE_STATE = (cfg: ResolvedNodeConfig): NodeLoadState => ({
  gpuW: cfg.gpuCount * gpuPowerW(cfg.gpu.power.idleW.v, cfg.gpu.power.tdpW.v, 0, 1, 35),
  gpuActivity: 0,
  cpuUtil: 0.02,
  memActivity: 0,
  storageActivity: 0,
  networkActivity: 0,
  nvlinkActivity: 0,
  fanDuty: cfg.cooling === 'air' ? 0.3 : 0.25,
  fansHealthy: 1,
});

const PEAK_STATE = (cfg: ResolvedNodeConfig): NodeLoadState => ({
  gpuW: cfg.gpuCount * cfg.gpuPowerLimitW,
  gpuActivity: 1,
  cpuUtil: 1,
  memActivity: 1,
  storageActivity: 1,
  networkActivity: 1,
  nvlinkActivity: 1,
  fanDuty: 1,
  fansHealthy: 1,
});

/**
 * Builds the concrete node configuration for a rack template. Throws a
 * `CatalogLookupError` for unknown ids — callers validate references first.
 */
export function resolveNodeConfig(template: RackTemplate): ResolvedNodeConfig {
  const sys = template.system;
  const rackSystem = sys.kind === 'rack-system' ? part('rack-system', sys.rackSystemId) : null;
  const platform = part('platform', rackSystem ? rackSystem.trayPlatformId : sys.kind === 'platform' ? sys.platformId : '');
  const o = sys.overrides ?? {};
  const cooling = rackCoolingToNodeCooling(template.cooling);

  const gpu = part('gpu', platform.gpu.id);
  const cpu = part('cpu', platform.cpu.id);
  const dimmId = o.dimmId ?? platform.dimm?.id;
  const dimm = dimmId ? part('dimm', dimmId) : null;
  const dimmCount = dimm ? (o.dimmCount ?? platform.dimm?.count ?? 0) : 0;
  const dataDrive = part('nvme', o.dataDriveId ?? platform.dataDrive.id);
  const dataDriveCount = o.dataDriveCount ?? platform.dataDrive.count;
  const computeNic = part('nic', o.computeNicId ?? platform.computeNic.id);
  const psu = part('psu', o.psuId ?? platform.psu.id);
  const psuCount = o.psuCount ?? platform.psu.count;
  const nvswitch = platform.nvswitch ? part('nvswitch', platform.nvswitch.id) : null;
  const osDrive = part('nvme', platform.osDrive.id);
  const storageNic = part('nic', platform.storageNic.id);
  const gpuPowerLimitW = o.gpuPowerLimitW ?? gpu.power.tdpW.v;

  const hostMemoryGB = dimm
    ? dimm.capacityGB * dimmCount
    : cpu.memory.onPackageGB.v * platform.cpu.count;

  const key = [
    platform.id,
    rackSystem?.id ?? '-',
    cooling,
    gpuPowerLimitW,
    dimm?.id ?? '-',
    dimmCount,
    dataDrive.id,
    dataDriveCount,
    computeNic.id,
    psu.id,
    psuCount,
  ].join('|');

  const base = {
    key,
    platform,
    rackSystem,
    cooling,
    gpu,
    gpuCount: platform.gpu.count,
    gpuPowerLimitW,
    cpu,
    cpuCount: platform.cpu.count,
    dimm,
    dimmCount,
    hostMemoryGB,
    memorySpeedMTs: effectiveMemorySpeed(cpu, dimm, dimmCount, platform.cpu.count),
    osDrive,
    osDriveCount: platform.osDrive.count,
    dataDrive,
    dataDriveCount,
    computeNic,
    rails: platform.computeNic.count,
    storageNic,
    storageNicCount: platform.storageNic.count,
    nvswitch,
    nvswitchCount: platform.nvswitch?.count ?? 0,
    psu,
    psuCount,
    psuRequired: 0,
    // Liquid-cooled variants keep a reduced set of fans for residual air (DIMMs, NICs, PSUs).
    fanCount: platform.fans.count,
    fanMaxW: cooling === 'liquid' && platform.defaultCooling === 'air' ? platform.fans.maxPowerW.v * 0.3 : platform.fans.maxPowerW.v,
    baseboardW: platform.baseboardW.v,
    scaleUpDomainGpus: platform.scaleUpDomainGpus,
    rackUnits: platform.rackUnits,
    weightKg: platform.weightKg.v,
    idleDcW: 0,
    peakDcW: 0,
    idleWallW: 0,
    peakWallW: 0,
    liquidHeatFractionAtPeak: 0,
    costUsd: 0,
  };

  const idle = nodePowerBreakdown(base, IDLE_STATE(base));
  const peak = nodePowerBreakdown(base, PEAK_STATE(base));
  const psuRequired = Math.ceil(peak.dcW / psu.ratedW.v);
  const peakWallW = nodeWallPowerW(base, peak.dcW, psuCount);
  const idleWallW = nodeWallPowerW(base, idle.dcW, psuCount);

  const costUsd =
    platform.chassisCostUsd.v +
    gpu.costUsd.v * platform.gpu.count +
    cpu.costUsd.v * platform.cpu.count +
    (dimm ? dimm.costUsd.v * dimmCount : 0) +
    osDrive.costUsd.v * platform.osDrive.count +
    dataDrive.costUsd.v * dataDriveCount +
    computeNic.costUsd.v * platform.computeNic.count +
    storageNic.costUsd.v * platform.storageNic.count +
    psu.costUsd.v * psuCount;

  return {
    ...base,
    psuRequired,
    idleDcW: idle.dcW,
    peakDcW: peak.dcW,
    idleWallW,
    peakWallW,
    liquidHeatFractionAtPeak: peak.liquidHeatW / peakWallW,
    costUsd,
  };
}
