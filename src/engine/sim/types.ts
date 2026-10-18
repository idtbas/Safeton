/**
 * Public simulation types: state enums (numeric for typed arrays), events, jobs, commands,
 * queries and snapshots. This module is the contract between the engine and every consumer
 * (worker protocol, OS layer, future terminal).
 */
import type { InfraSpec } from '../model/spec';

// ---- Node and GPU states ------------------------------------------------------------------

export const NodeState = {
  Offline: 0,
  Post: 1,
  Booting: 2,
  Online: 3,
  Degraded: 4,
  Draining: 5,
  Maintenance: 6,
  Failed: 7,
  ShuttingDown: 8,
} as const;
export type NodeStateCode = (typeof NodeState)[keyof typeof NodeState];
export const NODE_STATE_NAMES = [
  'offline',
  'post',
  'booting',
  'online',
  'degraded',
  'draining',
  'maintenance',
  'failed',
  'shutting-down',
] as const;
export type NodeStateName = (typeof NODE_STATE_NAMES)[number];

/** Node fault flags (bitmask). */
export const NodeFault = {
  Gpu: 1,
  PsuRedundancy: 2,
  Fan: 4,
  Nic: 8,
  Dimm: 16,
  Nvme: 32,
  Thermal: 64,
  NvSwitch: 128,
  PowerBrake: 256,
} as const;
export const NODE_FAULT_NAMES: Record<number, string> = {
  1: 'gpu',
  2: 'psu-redundancy',
  4: 'fan',
  8: 'nic',
  16: 'dimm',
  32: 'nvme',
  64: 'thermal',
  128: 'nvswitch',
  256: 'power-brake',
};

export const GpuHealth = {
  Ok: 0,
  /** Usable; correctable-error storm or row remap pending. */
  Degraded: 1,
  /** Unusable until the GPU is reset (node reboot). */
  ResetRequired: 2,
  /** Hardware failure; requires repair / RMA. */
  Failed: 3,
} as const;
export type GpuHealthCode = (typeof GpuHealth)[keyof typeof GpuHealth];
export const GPU_HEALTH_NAMES = ['ok', 'degraded', 'reset-required', 'failed'] as const;

/** GPU clock throttle reasons (bitmask, mirrors nvidia-smi clocks_throttle_reasons). */
export const Throttle = {
  PowerCap: 1,
  ThermalSlowdown: 2,
  HwSlowdown: 4,
  PowerBrake: 8,
} as const;

// ---- Events -------------------------------------------------------------------------------

export type Severity = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical';
export const SEVERITY_RANK: Record<Severity, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
};

export type EventSourceKind =
  | 'system'
  | 'node'
  | 'gpu'
  | 'rack'
  | 'switch'
  | 'link'
  | 'job'
  | 'scheduler'
  | 'facility'
  | 'hall'
  | 'storage';

export interface SimEvent {
  seq: number;
  tick: number;
  /** Simulated wall-clock time (epoch ms). */
  time: number;
  severity: Severity;
  source: { kind: EventSourceKind; id: string };
  code: string;
  message: string;
}

// ---- Jobs ---------------------------------------------------------------------------------

export type Precision = 'bf16' | 'fp8';
export type RecomputeMode = 'auto' | 'selective' | 'full';

export interface TrainingJobSpec {
  kind: 'training';
  name: string;
  user?: string;
  priority?: number;
  modelId: string;
  gpus: number;
  /** Tensor / pipeline parallel degree; omitted = chosen by the auto-planner. */
  tp?: number;
  pp?: number;
  recompute?: RecomputeMode;
  precision: Precision;
  seqLen: number;
  /** Global batch size in sequences. */
  globalBatch: number;
  /** Training target in tokens. */
  totalTokens: number;
  /** Simulated minutes between checkpoints. */
  checkpointIntervalMin: number;
  asyncCheckpoint?: boolean;
}

export interface InferenceJobSpec {
  kind: 'inference';
  name: string;
  user?: string;
  priority?: number;
  modelId: string;
  replicas: number;
  tp: number;
  precision: Precision;
  /** Offered load (requests per second, all replicas). */
  requestRate: number;
  avgInputTokens: number;
  avgOutputTokens: number;
}

export type JobSpec = TrainingJobSpec | InferenceJobSpec;

export type JobState =
  | 'pending'
  | 'initializing'
  | 'running'
  | 'checkpointing'
  | 'restarting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const ACTIVE_JOB_STATES: readonly JobState[] = ['initializing', 'running', 'checkpointing', 'restarting'];

export interface TrainingPlan {
  tp: number;
  pp: number;
  dp: number;
  interleave: number;
  microbatches: number;
  recompute: 'selective' | 'full';
  bubbleFraction: number;
  stageImbalance: number;
  modelFlopsPerToken: number;
  hardwareFlopsPerStep: number;
  modelFlopsPerStep: number;
  tokensPerStep: number;
  totalSteps: number;
  memoryGB: { weights: number; grads: number; optimizer: number; activations: number; overhead: number; total: number };
  hbmGB: number;
  checkpointGB: number;
  tpBytesPerGpu: number;
  ppBytesPerGpu: number;
  dpBytesPerGpu: number;
  nodes: number;
  /** Estimated step time on idle, healthy hardware (s). */
  nominalStepS: number;
  nominalMfu: number;
}

export interface InferencePlan {
  tp: number;
  replicas: number;
  nodes: number;
  replicasPerNode: number;
  weightsGBPerGpu: number;
  kvBytesPerTokenPerGpu: number;
  kvCapacityTokensPerReplica: number;
  maxConcurrentPerReplica: number;
  prefillSecondsPerRequest: number;
  minDecodeStepS: number;
  maxThroughputTokS: number;
}

export interface JobMetrics {
  stepTimeS: number;
  tokensPerSec: number;
  mfu: number;
  tflopsPerGpu: number;
  commExposedFraction: number;
  congestion: number;
  clockFactor: number;
  /** Inference */
  servedRps: number;
  queueDepth: number;
  ttftS: number;
  tpotS: number;
  batchPerReplica: number;
  sloAttainment: number;
}

export interface Job {
  id: number;
  name: string;
  user: string;
  priority: number;
  spec: JobSpec;
  state: JobState;
  reason: string | null;
  submittedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  nodes: number[];
  plan: TrainingPlan | InferencePlan;
  /** Seconds remaining in the current transitional phase (init / checkpoint / restart). */
  phaseRemainingS: number;
  /** Inference: remaining model-load seconds per allocated node (aligned with `nodes`). */
  nodeInitS: number[];
  /** Training: true while the job waits to be re-placed after a failure. */
  requeued: boolean;
  /** Background (async) checkpoint write still in flight, seconds and GB/s. */
  ckptWriteRemainingS: number;
  ckptWriteGBs: number;
  // Training progress
  step: number;
  stepFraction: number;
  lastCheckpointStep: number;
  sinceCheckpointS: number;
  tokensDone: number;
  restarts: number;
  lostSteps: number;
  /** Seconds spent making forward progress vs. total allocated seconds (goodput). */
  productiveS: number;
  allocatedS: number;
  // Inference progress
  requestsServed: number;
  queue: number;
  metrics: JobMetrics;
}

// ---- Commands -----------------------------------------------------------------------------

export type NodeSelector = (number | string)[] | { rack: string } | { hall: string } | 'all';

export type FaultTarget =
  | { kind: 'node-crash'; node: number | string }
  | { kind: 'gpu'; node: number | string; gpu?: number; xid?: number }
  | { kind: 'psu'; node: number | string }
  | { kind: 'fan'; node: number | string }
  | { kind: 'nic'; node: number | string; rail?: number }
  | { kind: 'dimm'; node: number | string }
  | { kind: 'switch'; switch: number | string }
  | { kind: 'cooling-unit'; hall: number; unit: 'air' | 'liquid' }
  | { kind: 'chiller' };

export type Command =
  | { type: 'sim.setFailureRate'; multiplier: number }
  | { type: 'sim.setAutoRemediation'; enabled: boolean }
  | { type: 'node.powerOn'; nodes: NodeSelector }
  | { type: 'node.powerOff'; nodes: NodeSelector; force?: boolean }
  | { type: 'node.reboot'; nodes: NodeSelector; force?: boolean }
  | { type: 'node.drain'; nodes: NodeSelector; reason?: string }
  | { type: 'node.resume'; nodes: NodeSelector }
  | { type: 'node.maintenance'; nodes: NodeSelector; enter: boolean; force?: boolean }
  | { type: 'node.repair'; nodes: NodeSelector }
  | { type: 'node.setPowerLimit'; nodes: NodeSelector; watts: number }
  | { type: 'switch.setAdminState'; switches: (number | string)[]; up: boolean }
  | { type: 'switch.repair'; switches: (number | string)[] }
  | { type: 'fault.inject'; target: FaultTarget }
  | { type: 'facility.setSetpoint'; hall: number; airSupplyC?: number; liquidSupplyC?: number }
  | { type: 'facility.repairAll' }
  | { type: 'job.submit'; job: JobSpec }
  | { type: 'job.cancel'; jobId: number }
  | { type: 'job.setRequestRate'; jobId: number; requestRate: number };

export type CommandType = Command['type'];

export interface CommandError {
  code: string;
  message: string;
}

export type CommandResult =
  | { ok: true; message: string; data?: unknown }
  | { ok: false; error: CommandError };

// ---- Snapshots ----------------------------------------------------------------------------

export interface PerfStats {
  tickMsAvg: number;
  tickMsP95: number;
  ticksPerSecond: number;
  simSecondsPerSecond: number;
  lagging: boolean;
}

export interface FacilitySnapshot {
  ambientC: number;
  itPowerW: number;
  facilityPowerW: number;
  coolingPowerW: number;
  upsLossW: number;
  pue: number;
  chillerCop: number;
  freeCoolingChilled: number;
  freeCoolingWarm: number;
  chilledWaterSupplyC: number;
  chillersHealthy: number;
  chillersInstalled: number;
  energyMWh: number;
  energyCostEur: number;
}

export interface HallSnapshot {
  id: string;
  name: string;
  itPowerW: number;
  roomAirHeatW: number;
  rdhxHeatW: number;
  liquidHeatW: number;
  supplyAirC: number;
  supplyAirSetpointC: number;
  airCapacityW: number;
  airUnitsHealthy: number;
  airUnitsInstalled: number;
  liquidSupplyC: number | null;
  liquidSupplySetpointC: number | null;
  liquidCapacityW: number;
  liquidUnitsHealthy: number;
  liquidUnitsInstalled: number;
}

export interface ClusterSnapshot {
  nodesTotal: number;
  nodesByState: number[];
  gpusTotal: number;
  gpusHealthy: number;
  gpusAllocated: number;
  gpuUtilAvg: number;
  gpuTempAvg: number;
  gpuTempMax: number;
  gpuPowerW: number;
  hbmUsedGB: number;
  hbmTotalGB: number;
  throttledGpus: number;
  fabricTrafficGbps: number;
  fabricCapacityGbps: number;
  switchesDown: number;
  linksDown: number;
  storageReadGBs: number;
  storageWriteGBs: number;
  trainingTokensPerSec: number;
  inferenceTokensPerSec: number;
  achievedPflops: number;
}

export interface JobSummary {
  id: number;
  name: string;
  kind: 'training' | 'inference';
  user: string;
  state: JobState;
  reason: string | null;
  modelId: string;
  gpus: number;
  nodes: number;
  progress: number;
  etaS: number | null;
  restarts: number;
  goodput: number;
  submittedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  metrics: JobMetrics;
}

/** Column-oriented per-entity data (transferable). */
export interface NodeColumns {
  state: Uint8Array;
  faults: Uint16Array;
  job: Int32Array;
  powerW: Float32Array;
  gpuUtil: Float32Array;
  gpuTempMax: Float32Array;
  fanDuty: Float32Array;
  inletC: Float32Array;
  netGbps: Float32Array;
}

export interface RackColumns {
  powerW: Float32Array;
  inletC: Float32Array;
  liquidHeatW: Float32Array;
}

export interface SwitchColumns {
  up: Uint8Array;
  util: Float32Array;
  powerW: Float32Array;
}

export interface SeriesSample {
  t: number;
  values: Record<string, number>;
}

export interface Snapshot {
  tick: number;
  time: number;
  dt: number;
  running: boolean;
  timeScale: number;
  failureRateMultiplier: number;
  autoRemediation: boolean;
  perf: PerfStats;
  facility: FacilitySnapshot;
  halls: HallSnapshot[];
  cluster: ClusterSnapshot;
  jobs: JobSummary[];
  nodes: NodeColumns;
  racks: RackColumns;
  switches: SwitchColumns;
  events: SimEvent[];
  samples: SeriesSample[];
}

// ---- Static topology description for consumers ---------------------------------------------

export interface TopologyInfo {
  spec: InfraSpec;
  fingerprint: string;
  halls: { id: string; name: string; racks: number[] }[];
  racks: {
    name: string;
    hall: number;
    row: string;
    kind: 'compute' | 'network' | 'storage';
    cooling: string;
    nodeStart: number;
    nodeCount: number;
    switches: number[];
    designPeakW: number;
  }[];
  nodes: { hostname: string; rack: number; platform: string; gpus: number; gpuModel: string; leafGroup: number; nvlDomain: number }[];
  switches: { name: string; tier: number; plane: number; model: string; rack: number }[];
  storage: { name: string; model: string; rack: number }[];
  gpuCount: number;
  fabric: { topology: string; tiers: number; planes: number; switchModel: string | null; portSpeedGbps: number };
}

// ---- Queries ------------------------------------------------------------------------------

export type Query =
  | { type: 'topology' }
  | { type: 'node.detail'; node: number | string }
  | { type: 'job.detail'; jobId: number }
  | { type: 'jobs' }
  | { type: 'series'; keys?: string[] }
  | { type: 'events'; limit?: number; minSeverity?: Severity; sourceKind?: EventSourceKind }
  | { type: 'plan'; job: JobSpec }
  | { type: 'stateHash' };

export interface GpuDetail {
  index: number;
  uuid: string;
  model: string;
  health: string;
  util: number;
  memUsedGB: number;
  memTotalGB: number;
  powerW: number;
  powerLimitW: number;
  tempC: number;
  hbmTempC: number;
  clockMHz: number;
  maxClockMHz: number;
  throttle: string[];
  eccCorrected: number;
  eccUncorrected: number;
  retiredRows: number;
  lastXid: number;
}

export interface NodeDetail {
  index: number;
  hostname: string;
  rack: string;
  hall: string;
  slotU: number;
  state: NodeStateName;
  faults: string[];
  platform: string;
  reference: string;
  cooling: string;
  job: number | null;
  powered: boolean;
  powerW: number;
  powerBreakdown: Record<string, number>;
  psu: { model: string; installed: number; healthy: number; required: number };
  fans: { installed: number; healthy: number; duty: number };
  inletC: number;
  cpu: { model: string; sockets: number; cores: number; util: number };
  memory: { totalGB: number; usedGB: number; speedMTs: number; type: string; dimms: number };
  nics: { rail: number; model: string; speedGbps: number; up: boolean; leaf: string | null; txGbps: number }[];
  storage: { model: string; count: number; capacityTB: number };
  gpus: GpuDetail[];
  stateSince: number;
  uptimeS: number;
  history: { util: number[]; tempC: number[]; powerW: number[]; intervalS: number };
}
