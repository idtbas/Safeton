/**
 * Hardware catalog type definitions.
 *
 * Every numeric hardware property is a {@link Q} ("qualified quantity") that carries its
 * provenance. This keeps a hard, inspectable line between published vendor figures,
 * engineering estimates and pure simulation assumptions.
 */

/**
 * - `vendor`: published by the manufacturer (datasheet, spec sheet, product brief).
 * - `estimate`: not officially published; derived from public measurements, teardown data,
 *   industry reporting or comparable products.
 * - `assumption`: a modelling parameter chosen for the simulation. Plausible, but not a
 *   property of real hardware that could be looked up.
 */
export type SourceKind = 'vendor' | 'estimate' | 'assumption';

export interface Q {
  readonly v: number;
  readonly src: SourceKind;
  readonly note?: string;
}

export const vendor = (v: number, note?: string): Q => (note ? { v, src: 'vendor', note } : { v, src: 'vendor' });
export const est = (v: number, note?: string): Q => (note ? { v, src: 'estimate', note } : { v, src: 'estimate' });
export const assume = (v: number, note?: string): Q =>
  note ? { v, src: 'assumption', note } : { v, src: 'assumption' };

/** Peak tensor throughput for one precision. `sparse` is 2:4 structured sparsity, null if unsupported. */
export interface PrecisionPeak {
  readonly dense: Q;
  readonly sparse: Q | null;
}

export type CoolingMode = 'air' | 'liquid';

export interface ThermalInterface {
  /** Junction-to-coolant thermal resistance at full fan speed / nominal coolant flow (K/W). */
  readonly rthKW: Q;
  /** Lumped heat capacity of die, package and heat sink / cold plate (J/K). */
  readonly heatCapacityJK: Q;
}

export interface GpuSpec {
  readonly id: string;
  readonly kind: 'gpu';
  readonly vendor: 'NVIDIA' | 'AMD';
  readonly name: string;
  readonly architecture: string;
  readonly formFactor: 'SXM4' | 'SXM5' | 'SXM6' | 'Superchip' | 'OAM';
  readonly processNode: string;
  readonly launchYear: number;
  /** Streaming multiprocessors (NVIDIA) or compute units (AMD). */
  readonly computeUnits: number;
  /** All values in TFLOPS (TOPS for INT8). */
  readonly peak: {
    readonly fp64: Q;
    readonly fp64Tensor: Q;
    readonly tf32: PrecisionPeak;
    readonly bf16: PrecisionPeak;
    readonly fp16: PrecisionPeak;
    readonly fp8: PrecisionPeak | null;
    readonly fp4: PrecisionPeak | null;
    readonly int8: PrecisionPeak;
  };
  readonly memory: {
    readonly type: 'HBM2e' | 'HBM3' | 'HBM3e';
    readonly capacityGB: Q;
    readonly bandwidthGBs: Q;
    readonly stacks: number;
  };
  readonly interconnect: {
    readonly kind: 'NVLink 3' | 'NVLink 4' | 'NVLink 5' | 'Infinity Fabric';
    /** Aggregate bidirectional GPU-to-GPU bandwidth (GB/s). */
    readonly bandwidthGBs: Q;
    readonly links: number;
  };
  readonly hostInterface: string;
  readonly power: {
    /** Maximum board power / TDP (W). */
    readonly tdpW: Q;
    /** Idle power with driver loaded, persistence mode on (W). */
    readonly idleW: Q;
    /** Lowest configurable power limit (W). */
    readonly minPowerLimitW: Q;
  };
  readonly thermal: {
    /** Clocks are reduced above this temperature. */
    readonly slowdownC: Q;
    /** Hardware thermal shutdown. */
    readonly shutdownC: Q;
    /** Maximum HBM operating temperature. */
    readonly hbmMaxC: Q;
    readonly air: ThermalInterface | null;
    readonly liquid: ThermalInterface | null;
  };
  /** Fraction of dense peak that large GEMM-dominated training reaches end to end (kernel level). */
  readonly kernelEfficiency: Q;
  /** Fraction of peak HBM bandwidth reached by memory-bound decode kernels. */
  readonly hbmEfficiency: Q;
  /** Annualized failure rate of the device including HBM (fraction per year). */
  readonly afr: Q;
  readonly costUsd: Q;
}

export interface CpuSpec {
  readonly id: string;
  readonly kind: 'cpu';
  readonly vendor: 'Intel' | 'AMD' | 'NVIDIA';
  readonly name: string;
  readonly codename: string;
  readonly isa: 'x86-64' | 'Armv9 (Neoverse V2)';
  readonly cores: number;
  readonly threads: number;
  readonly baseGHz: Q;
  readonly boostGHz: Q;
  readonly l3MB: Q;
  readonly tdpW: Q;
  readonly idleW: Q;
  readonly memory: {
    readonly type: 'DDR4' | 'DDR5' | 'LPDDR5X';
    readonly channels: number;
    readonly maxMTs: number;
    /** Memory integrated on the package (Grace). 0 for socketed DIMM platforms. */
    readonly onPackageGB: Q;
    readonly onPackageBandwidthGBs: Q | null;
  };
  readonly pcie: { readonly gen: number; readonly lanes: number };
  readonly afr: Q;
  readonly costUsd: Q;
}

export interface DimmSpec {
  readonly id: string;
  readonly kind: 'dimm';
  readonly name: string;
  readonly type: 'DDR4 RDIMM' | 'DDR5 RDIMM';
  readonly capacityGB: number;
  readonly speedMTs: number;
  readonly powerActiveW: Q;
  readonly powerIdleW: Q;
  readonly afr: Q;
  readonly costUsd: Q;
}

export interface NvmeSpec {
  readonly id: string;
  readonly kind: 'nvme';
  readonly name: string;
  readonly formFactor: 'U.2' | 'E1.S' | 'E3.S' | 'M.2';
  readonly interface: string;
  readonly capacityTB: number;
  readonly seqReadGBs: Q;
  readonly seqWriteGBs: Q;
  readonly randReadKIOPS: Q;
  readonly powerActiveW: Q;
  readonly powerIdleW: Q;
  readonly afr: Q;
  readonly costUsd: Q;
}

export interface NicSpec {
  readonly id: string;
  readonly kind: 'nic';
  readonly name: string;
  readonly vendor: string;
  readonly class: 'NIC' | 'SuperNIC' | 'DPU';
  readonly protocols: readonly string[];
  readonly ports: number;
  readonly portSpeedGbps: number;
  readonly hostInterface: string;
  readonly powerW: Q;
  /** One-way adapter latency contribution (ns). */
  readonly latencyNs: Q;
  readonly afr: Q;
  readonly costUsd: Q;
}

export interface SwitchSpec {
  readonly id: string;
  readonly kind: 'switch';
  readonly name: string;
  readonly vendor: string;
  readonly fabric: 'InfiniBand' | 'Ethernet';
  readonly generation: string;
  /** Logical ports at `portSpeedGbps` (radix). */
  readonly ports: number;
  readonly portSpeedGbps: number;
  /** Aggregate switching capacity (Tb/s, bidirectional). */
  readonly switchingTbps: Q;
  /** Port-to-port latency (ns). */
  readonly latencyNs: Q;
  readonly rackUnits: number;
  readonly powerTypicalW: Q;
  readonly powerMaxW: Q;
  readonly afr: Q;
  readonly costUsd: Q;
}

export interface NvSwitchSpec {
  readonly id: string;
  readonly kind: 'nvswitch';
  readonly name: string;
  readonly generation: string;
  readonly nvlinkPorts: number;
  /** Aggregate bidirectional bandwidth (GB/s). */
  readonly bandwidthGBs: Q;
  readonly powerW: Q;
  readonly afr: Q;
}

export interface PsuSpec {
  readonly id: string;
  readonly kind: 'psu';
  readonly name: string;
  readonly ratedW: Q;
  readonly efficiencyClass: string;
  /** Efficiency curve as [loadFraction, efficiency] points, interpolated linearly. */
  readonly efficiencyCurve: readonly (readonly [number, number])[];
  readonly afr: Q;
  readonly costUsd: Q;
}

export interface StorageSystemSpec {
  readonly id: string;
  readonly kind: 'storage';
  readonly name: string;
  readonly class: 'parallel-fs' | 'nfs' | 'object';
  readonly rackUnits: number;
  readonly usableTB: Q;
  readonly readGBs: Q;
  readonly writeGBs: Q;
  readonly powerW: Q;
  readonly afr: Q;
  readonly costUsd: Q;
}

export interface RackSpec {
  readonly id: string;
  readonly kind: 'rack';
  readonly name: string;
  readonly rackUnits: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly staticLoadKg: Q;
  readonly emptyWeightKg: Q;
  readonly costUsd: Q;
}

export interface PduSpec {
  readonly id: string;
  readonly kind: 'pdu';
  readonly name: string;
  readonly phases: 1 | 3;
  readonly voltageV: number;
  readonly currentA: number;
  /** Continuous usable capacity after derating (kW). */
  readonly capacityKW: Q;
  readonly outlets: number;
  readonly costUsd: Q;
}

export interface UpsSpec {
  readonly id: string;
  readonly kind: 'ups';
  readonly name: string;
  readonly moduleKW: Q;
  readonly efficiencyCurve: readonly (readonly [number, number])[];
  readonly runtimeMinAtFullLoad: Q;
  readonly costUsdPerModule: Q;
}

export type CoolingUnitClass = 'crah' | 'inrow' | 'rdhx' | 'cdu' | 'chiller' | 'drycooler';

export interface CoolingUnitSpec {
  readonly id: string;
  readonly kind: 'cooling';
  readonly class: CoolingUnitClass;
  readonly name: string;
  /** Nominal heat removal capacity (kW). */
  readonly capacityKW: Q;
  /** Parasitic power at nominal capacity (fans, pumps), W. Chillers use COP instead. */
  readonly parasiticW: Q;
  /** Chillers only: COP at 35 °C ambient and at 15 °C ambient. */
  readonly copAt35C?: Q;
  readonly copAt15C?: Q;
  readonly afr: Q;
  readonly costUsd: Q;
}

/** A tightly coupled CPU+GPU module (e.g. GB200). */
export interface SuperchipSpec {
  readonly id: string;
  readonly kind: 'superchip';
  readonly name: string;
  readonly cpuId: string;
  readonly cpuCount: number;
  readonly gpuId: string;
  readonly gpuCount: number;
  /** Chip-to-chip coherent link bandwidth (GB/s, bidirectional). */
  readonly c2cBandwidthGBs: Q;
  readonly maxModulePowerW: Q;
}

export interface PartRef {
  readonly id: string;
  readonly count: number;
}

export interface PlatformSpec {
  readonly id: string;
  readonly kind: 'platform';
  readonly name: string;
  /** What real-world system class this composition corresponds to. */
  readonly reference: string;
  readonly class: 'server' | 'rack-scale-tray';
  readonly rackUnits: number;
  readonly weightKg: Q;
  readonly gpu: PartRef;
  readonly cpu: PartRef;
  readonly superchip: PartRef | null;
  /** DIMM population (null for on-package memory platforms). */
  readonly dimm: PartRef | null;
  readonly dimmSlots: number;
  readonly osDrive: PartRef;
  readonly dataDrive: PartRef;
  readonly dataDriveBays: number;
  /** Backend (compute fabric) adapters; one per rail. */
  readonly computeNic: PartRef;
  /** Storage / in-band management adapters. */
  readonly storageNic: PartRef;
  readonly nvswitch: PartRef | null;
  /** GPUs sharing one NVLink / Infinity Fabric domain (scale-up domain). */
  readonly scaleUpDomainGpus: number;
  readonly psu: PartRef;
  /** PSUs required to carry peak load; the rest is redundancy. */
  readonly psuRequired: number;
  readonly fans: { readonly count: number; readonly maxPowerW: Q };
  /** BMC, PCIe switches, retimers, VRM losses, etc. (W at full load). */
  readonly baseboardW: Q;
  readonly cooling: readonly CoolingMode[];
  readonly defaultCooling: CoolingMode;
  /** Published maximum system power (W) — used to cross-check the bottom-up power model. */
  readonly maxPowerW: Q;
  readonly boot: { readonly postSeconds: Q; readonly osBootSeconds: Q; readonly shutdownSeconds: Q };
  /** Chassis, baseboard, integration (excluding GPUs/CPUs/DIMMs/drives/NICs). */
  readonly chassisCostUsd: Q;
}

/** Rack-scale systems (NVL72-class) — the rack itself is part of the product. */
export interface RackSystemSpec {
  readonly id: string;
  readonly kind: 'rack-system';
  readonly name: string;
  readonly reference: string;
  readonly trayPlatformId: string;
  readonly computeTrays: number;
  readonly switchTrays: number;
  readonly nvswitchPerTray: PartRef;
  readonly switchTrayOverheadW: Q;
  readonly powerShelves: number;
  readonly powerShelfKW: Q;
  readonly rackId: string;
  readonly weightKg: Q;
  readonly maxPowerKW: Q;
  readonly costUsd: Q;
}

export type CatalogItem =
  | GpuSpec
  | CpuSpec
  | DimmSpec
  | NvmeSpec
  | NicSpec
  | SwitchSpec
  | NvSwitchSpec
  | PsuSpec
  | StorageSystemSpec
  | RackSpec
  | PduSpec
  | UpsSpec
  | CoolingUnitSpec
  | SuperchipSpec
  | PlatformSpec
  | RackSystemSpec;

export type CatalogKind = CatalogItem['kind'];
