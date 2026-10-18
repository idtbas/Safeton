/**
 * The simulation engine.
 *
 * A fixed-step, deterministic model of an AI data center. Each tick advances simulated time by
 * `dt` seconds and runs the phases below in a fixed order. Every random decision draws from a
 * single seeded generator, and all external influence arrives through typed commands applied
 * between ticks — so a seed plus the command journal fully determines the run.
 *
 *   1. node state machines (POST, boot, shutdown timers)
 *   2. remediation tickets (automated repair)
 *   3. stochastic component failures
 *   4. scheduling of pending jobs
 *   5. workload progression → per-GPU activity, memory, NIC/NVLink/storage traffic
 *   6. network utilisation and congestion
 *   7. electrical + thermal physics per GPU / node (power caps, fans, throttling)
 *   8. rack / hall / plant aggregation, PUE, energy
 *   9. telemetry sampling
 */
import type { PsuSpec } from '../../catalog';
import { Rng, hashBytes, hashString } from '../core/rng';
import { RingBuffer } from '../core/ringbuffer';
import {
  ambientTemperatureC,
  facilityPower,
  type FacilityPlantParams,
  type FacilityPower,
} from '../physics/facility';
import { gpuPowerW, powerLimitedClock, psuInputW } from '../physics/power';
import {
  AIR_MIN_DUTY,
  FAN_SLEW_PER_S,
  airResistance,
  fanTargetDuty,
  liquidResistance,
  thermalClock,
} from '../physics/thermal';
import { buildPlantParams, rdhxCapacityW, splitRackHeat } from '../model/plant';
import { nodePowerBreakdown } from '../model/resolve';
import type { InfraSpec } from '../model/spec';
import { expandTopology, type Topology } from '../model/topology';
import { executeCommand } from './commands';
import { EventLog } from './events';
import { processFailures, processTickets, type RepairTicket } from './failures';
import { advanceJobs, handleNodeLost, scheduleJobs } from './jobs';
import { updateNetwork } from './network';
import { buildNodeDetail, buildSnapshot, buildTopologyInfo, jobSummary } from './snapshot';
import {
  allocateRuntime,
  forEachArray,
  restoreRuntime,
  serializeRuntime,
  type RuntimeArrays,
  type SerializedArrays,
} from './state';
import {
  GpuHealth,
  NodeFault,
  NodeState,
  Throttle,
  type Command,
  type CommandResult,
  type EventSourceKind,
  type Job,
  type NodeStateCode,
  type PerfStats,
  type Query,
  type SeriesSample,
  type Severity,
  type Snapshot,
} from './types';
import { planInference, planTraining } from './workload-model';

export const SIM_STATE_FORMAT = 'safeton-sim-state';
export const SIM_STATE_VERSION = 1;

/** BMC / standby power of a powered-off node (W, assumption). */
export const STANDBY_W = 25;
export const SERIES_INTERVAL_S = 5;
export const SERIES_CAPACITY = 4320;
export const NODE_HISTORY_INTERVAL_S = 30;
export const NODE_HISTORY_LENGTH = 120;
/** Hall supply air rises ~40 K per 100 % cooling overload (assumption), τ = 300 s. */
const HALL_AIR_OVERLOAD_K = 40;
const HALL_AIR_TAU_S = 300;
const LIQUID_OVERLOAD_K = 25;
const LIQUID_TAU_S = 120;
const CHW_OVERLOAD_K = 20;
const CHW_TAU_S = 600;
/** Inlet hot-spot growth for room-air racks above 25 kW (°C per kW, assumption). */
const HOTSPOT_C_PER_KW = 0.15;

export const SERIES_KEYS = [
  'itPowerW',
  'facilityPowerW',
  'coolingPowerW',
  'pue',
  'gpuUtil',
  'gpuTempAvg',
  'gpuTempMax',
  'gpuPowerW',
  'hbmUsedGB',
  'fabricGbps',
  'storageGBs',
  'trainTokS',
  'inferTokS',
  'achievedPflops',
  'ambientC',
  'supplyAirC',
  'liquidSupplyC',
  'gpusAllocated',
  'nodesOnline',
  'throttledGpus',
] as const;
export type SeriesKey = (typeof SERIES_KEYS)[number];

export interface SimulationOptions {
  seed: number;
  /** Fixed time step in seconds. */
  dt?: number;
  failureRateMultiplier?: number;
  autoRemediation?: boolean;
  /** Initial node power state. */
  initialPower?: 'online' | 'offline';
}

export interface HallRuntime {
  supplyAirC: number;
  airSetpointC: number;
  airUnitsFailed: number;
  liquidSupplyC: number;
  liquidSetpointC: number;
  liquidUnitsFailed: number;
  itW: number;
  roomW: number;
  rdhxW: number;
  liquidW: number;
}

export interface PlantRuntime {
  chwSupplyC: number;
  chillersFailed: number;
}

export interface ClusterAggregates {
  gpusHealthy: number;
  gpusAllocated: number;
  gpuUtilAvg: number;
  gpuTempAvg: number;
  gpuTempMax: number;
  gpuPowerW: number;
  hbmUsedGB: number;
  throttledGpus: number;
  fabricTrafficGbps: number;
  storageReadGBs: number;
  storageWriteGBs: number;
  trainingTokensPerSec: number;
  inferenceTokensPerSec: number;
  /** Useful model FLOP/s delivered by running workloads (training 6N+attention, inference 2N). */
  achievedFlops: number;
  /** Sum over GPUs of Arrhenius-weighted failure propensity (for hazard sampling). */
  gpuHazardWeight: number;
}

export interface SimStateBlob {
  format: typeof SIM_STATE_FORMAT;
  version: number;
  savedAt: string;
  spec: InfraSpec;
  fingerprint: string;
  seed: number;
  dt: number;
  tick: number;
  time: number;
  rng: [number, number, number, number];
  failureRateMultiplier: number;
  autoRemediation: boolean;
  arrays: SerializedArrays;
  halls: HallRuntime[];
  plant: PlantRuntime;
  jobs: Job[];
  nextJobId: number;
  tickets: RepairTicket[];
  nextTicketId: number;
  events: { seq: number; events: Snapshot['events'] };
  series: {
    time: { capacity: number; values: Float64Array };
    data: Record<string, { capacity: number; values: Float64Array }>;
  };
  energy: { itWh: number; facilityWh: number; costEur: number };
  congestion: Record<number, number>;
  journal: { tick: number; command: Command }[];
}

export class Simulation {
  readonly topo: Topology;
  readonly seed: number;
  readonly dt: number;
  readonly rng: Rng;
  readonly rt: RuntimeArrays;
  readonly plantParams: FacilityPlantParams;
  readonly rdhxCapW: number;
  readonly hostIndex: Map<string, number>;
  readonly switchIndex: Map<string, number>;
  readonly rackIndex: Map<string, number>;

  tick = 0;
  time: number;
  failureRateMultiplier: number;
  autoRemediation: boolean;
  ambientC = 0;

  halls: HallRuntime[];
  plant: PlantRuntime;
  jobs = new Map<number, Job>();
  nextJobId = 1001;
  tickets: RepairTicket[] = [];
  nextTicketId = 1;
  events: EventLog;
  /** Smoothed fabric congestion factor per job. */
  congestion = new Map<number, number>();
  /** GPU failure propensity per node (Arrhenius × load), recomputed by the physics phase. */
  readonly nodeHazard: Float64Array;
  /** Uncongested scale-out demand per GPU (Gb/s) of each running training job — recomputed every tick. */
  netDemand = new Map<number, number>();
  journal: { tick: number; command: Command }[] = [];

  facility!: FacilityPower;
  itW = 0;
  cluster: ClusterAggregates = emptyCluster();

  seriesTime = new RingBuffer(SERIES_CAPACITY);
  series: Record<SeriesKey, RingBuffer>;
  /** Per-node history [node * LEN + i] for util, max temp, power (not persisted). */
  readonly nodeHist: {
    util: Float32Array;
    temp: Float32Array;
    power: Float32Array;
    cursor: number;
    filled: number;
  };
  private pendingSamples: SeriesSample[] = [];
  private tickDurations = new Float64Array(120);
  private tickDurCursor = 0;
  private tickDurCount = 0;
  energy = { itWh: 0, facilityWh: 0, costEur: 0 };

  constructor(specOrTopo: InfraSpec | Topology, opts: SimulationOptions) {
    this.topo = 'nodes' in specOrTopo ? specOrTopo : expandTopology(specOrTopo);
    this.seed = opts.seed >>> 0;
    this.dt = opts.dt ?? 1;
    this.rng = new Rng(this.seed);
    this.failureRateMultiplier = opts.failureRateMultiplier ?? 1;
    this.autoRemediation = opts.autoRemediation ?? true;
    this.time = Date.parse(this.topo.spec.simulationStart);
    this.rt = allocateRuntime(this.topo);
    this.plantParams = buildPlantParams(this.topo);
    this.rdhxCapW = rdhxCapacityW();
    this.events = new EventLog();
    this.hostIndex = new Map(this.topo.nodes.map((n) => [n.hostname, n.idx]));
    this.switchIndex = new Map(this.topo.switches.map((s) => [s.name, s.idx]));
    this.rackIndex = new Map(this.topo.racks.map((r) => [r.name, r.idx]));
    this.series = Object.fromEntries(SERIES_KEYS.map((k) => [k, new RingBuffer(SERIES_CAPACITY)])) as Record<
      SeriesKey,
      RingBuffer
    >;
    const n = this.topo.nodes.length;
    this.nodeHazard = new Float64Array(n);
    this.nodeHist = {
      util: new Float32Array(n * NODE_HISTORY_LENGTH),
      temp: new Float32Array(n * NODE_HISTORY_LENGTH),
      power: new Float32Array(n * NODE_HISTORY_LENGTH),
      cursor: 0,
      filled: 0,
    };
    this.halls = this.topo.halls.map((h) => ({
      supplyAirC: h.spec.air.supplyC,
      airSetpointC: h.spec.air.supplyC,
      airUnitsFailed: 0,
      liquidSupplyC: h.spec.liquid?.supplyC ?? 0,
      liquidSetpointC: h.spec.liquid?.supplyC ?? 0,
      liquidUnitsFailed: 0,
      itW: 0,
      roomW: 0,
      rdhxW: 0,
      liquidW: 0,
    }));
    this.plant = { chwSupplyC: this.topo.spec.site.plant.chilledWaterSupplyC, chillersFailed: 0 };
    this.initialise(opts.initialPower ?? 'online');
  }

  // ---- Initialisation ---------------------------------------------------------------------

  private initialise(power: 'online' | 'offline'): void {
    const { nodes, gpus, switches, links, racks } = this.rt;
    // Manufacturing / thermal-interface variance per GPU (±6 %), seeded from the topology so
    // that it is a property of the "installed hardware", independent of the run seed.
    const hwRng = new Rng(hashString(`hardware:${this.topo.fingerprint}`));
    for (let g = 0; g < this.topo.gpuCount; g++) {
      gpus.rthVar[g] = 0.94 + 0.12 * hwRng.next();
      const cfg = this.topo.nodes[this.topo.gpuNode[g]!]!.cfg;
      gpus.powerLimitW[g] = cfg.gpuPowerLimitW;
    }
    switches.adminUp.fill(1);
    links.up.fill(1);
    nodes.job.fill(-1);
    this.ambientC = ambientTemperatureC(this.topo.spec.site.climate, this.time);
    for (const node of this.topo.nodes) {
      const i = node.idx;
      const hall = this.halls[node.hallIdx]!;
      const rack = this.topo.racks[node.rackIdx]!;
      const inlet = hall.supplyAirC + rack.inletOffsetC;
      nodes.inletC[i] = inlet;
      nodes.stateSince[i] = this.time;
      if (power === 'online') {
        nodes.state[i] = NodeState.Online;
        nodes.powered[i] = 1;
        nodes.upSince[i] = this.time - 86_400_000 * (3 + 20 * hwRng.next());
        nodes.bootCount[i] = 1;
        nodes.fanDuty[i] = AIR_MIN_DUTY;
      } else {
        nodes.state[i] = NodeState.Offline;
        nodes.powered[i] = 0;
      }
      const cfg = node.cfg;
      for (let g = 0; g < cfg.gpuCount; g++) {
        const gi = node.gpuStart + g;
        gpus.clock[gi] = 1;
        const ref = cfg.cooling === 'liquid' ? hall.liquidSupplyC + 1 : inlet;
        gpus.tempC[gi] = power === 'online' ? ref + cfg.gpu.power.idleW.v * 0.12 : ref;
      }
    }
    for (let r = 0; r < racks.inletC.length; r++) {
      racks.inletC[r] =
        this.halls[this.topo.racks[r]!.hallIdx]!.supplyAirC + this.topo.racks[r]!.inletOffsetC;
    }
    this.facility = facilityPower(this.plantParams, {
      itW: 0,
      roomAirHeatW: 0,
      rdhxHeatW: 0,
      liquidHeatW: 0,
      ambientC: this.ambientC,
    });
    // Settle the physics so the first snapshot shows a consistent idle state.
    this.updatePhysics();
    this.updateFacility();
  }

  // ---- Public API -------------------------------------------------------------------------

  /** Advances the simulation by `count` ticks. Returns the wall time spent (ms). */
  step(count = 1): number {
    const start = now();
    for (let i = 0; i < count; i++) {
      const t0 = now();
      this.runTick();
      this.recordTickDuration(now() - t0);
    }
    return now() - start;
  }

  execute(command: Command): CommandResult {
    const result = executeCommand(this, command);
    if (result.ok) this.journal.push({ tick: this.tick, command });
    if (this.journal.length > 5000) this.journal.splice(0, this.journal.length - 5000);
    return result;
  }

  query(q: Query): unknown {
    switch (q.type) {
      case 'topology':
        return buildTopologyInfo(this);
      case 'node.detail': {
        const idx = this.resolveNode(q.node);
        return idx === null ? null : buildNodeDetail(this, idx);
      }
      case 'job.detail': {
        const job = this.jobs.get(q.jobId);
        return job ? structuredClone(job) : null;
      }
      case 'jobs':
        return [...this.jobs.values()].map((j) => jobSummary(this, j));
      case 'series': {
        const keys = (q.keys as SeriesKey[] | undefined) ?? [...SERIES_KEYS];
        const out: Record<string, number[]> = { time: Array.from(this.seriesTime.toArray()) };
        for (const k of keys) if (this.series[k]) out[k] = Array.from(this.series[k].toArray());
        return out;
      }
      case 'events':
        return this.events.query(q);
      case 'plan': {
        const cfg = this.primaryConfig();
        if (!cfg) return { ok: false, code: 'NO_NODES', message: 'No compute nodes' };
        return q.job.kind === 'training'
          ? planTraining(q.job, cfg, this.topo.fabric.portSpeedGbps)
          : planInference(q.job, cfg);
      }
      case 'stateHash':
        return this.stateHash();
    }
  }

  snapshot(
    perf?: Partial<PerfStats>,
    control?: { running: boolean; timeScale: number },
    sinceSeq = 0,
  ): Snapshot {
    const samples = this.pendingSamples;
    this.pendingSamples = [];
    return buildSnapshot(this, {
      perf: { ...this.perfStats(), ...perf },
      running: control?.running ?? false,
      timeScale: control?.timeScale ?? 1,
      sinceSeq,
      samples,
    });
  }

  perfStats(): PerfStats {
    const n = this.tickDurCount;
    if (n === 0)
      return { tickMsAvg: 0, tickMsP95: 0, ticksPerSecond: 0, simSecondsPerSecond: 0, lagging: false };
    const vals = Array.from(this.tickDurations.subarray(0, n)).sort((a, b) => a - b);
    const avg = vals.reduce((s, v) => s + v, 0) / n;
    return {
      tickMsAvg: avg,
      tickMsP95: vals[Math.min(n - 1, Math.floor(n * 0.95))]!,
      ticksPerSecond: 0,
      simSecondsPerSecond: 0,
      lagging: false,
    };
  }

  /** Deterministic fingerprint of the complete dynamic state. */
  stateHash(): string {
    let h = hashString(`${this.tick}:${this.time}:${this.rng.getState().join(',')}`);
    forEachArray(this.rt, (_name, arr) => {
      h = hashBytes(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), h);
    });
    const objects = JSON.stringify({
      halls: this.halls,
      plant: this.plant,
      jobs: [...this.jobs.values()],
      tickets: this.tickets,
      congestion: [...this.congestion.entries()],
      nextJobId: this.nextJobId,
      fr: this.failureRateMultiplier,
      ar: this.autoRemediation,
    });
    h = hashString(objects) ^ h;
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  serialize(): SimStateBlob {
    const series: SimStateBlob['series'] = { time: this.seriesTime.serialize(), data: {} };
    for (const k of SERIES_KEYS) series.data[k] = this.series[k].serialize();
    return {
      format: SIM_STATE_FORMAT,
      version: SIM_STATE_VERSION,
      savedAt: new Date().toISOString(),
      spec: this.topo.spec,
      fingerprint: this.topo.fingerprint,
      seed: this.seed,
      dt: this.dt,
      tick: this.tick,
      time: this.time,
      rng: this.rng.getState(),
      failureRateMultiplier: this.failureRateMultiplier,
      autoRemediation: this.autoRemediation,
      arrays: serializeRuntime(this.rt),
      halls: structuredClone(this.halls),
      plant: { ...this.plant },
      jobs: structuredClone([...this.jobs.values()]),
      nextJobId: this.nextJobId,
      tickets: structuredClone(this.tickets),
      nextTicketId: this.nextTicketId,
      events: this.events.serialize(),
      series,
      energy: { ...this.energy },
      congestion: Object.fromEntries(this.congestion),
      journal: this.journal.slice(-500),
    };
  }

  static restore(blob: SimStateBlob): Simulation {
    if (blob.format !== SIM_STATE_FORMAT) throw new Error('Not a Safeton simulation state');
    if (blob.version !== SIM_STATE_VERSION)
      throw new Error(`Unsupported simulation state version ${blob.version}`);
    const sim = new Simulation(blob.spec, {
      seed: blob.seed,
      dt: blob.dt,
      failureRateMultiplier: blob.failureRateMultiplier,
      autoRemediation: blob.autoRemediation,
    });
    if (sim.topo.fingerprint !== blob.fingerprint) {
      throw new Error(
        'Topology fingerprint mismatch — the saved state belongs to a different hardware catalog or spec',
      );
    }
    restoreRuntime(sim.rt, blob.arrays);
    sim.tick = blob.tick;
    sim.time = blob.time;
    sim.rng.setState(blob.rng);
    sim.halls = structuredClone(blob.halls);
    sim.plant = { ...blob.plant };
    sim.jobs = new Map(structuredClone(blob.jobs).map((j) => [j.id, j]));
    sim.nextJobId = blob.nextJobId;
    sim.tickets = structuredClone(blob.tickets);
    sim.nextTicketId = blob.nextTicketId;
    sim.events = EventLog.restore(blob.events);
    sim.seriesTime = RingBuffer.restore(blob.series.time);
    for (const k of SERIES_KEYS) {
      const s = blob.series.data[k];
      if (s) sim.series[k] = RingBuffer.restore(s);
    }
    sim.energy = { ...blob.energy };
    sim.congestion = new Map(Object.entries(blob.congestion).map(([k, v]) => [Number(k), v]));
    sim.journal = [...blob.journal];
    sim.ambientC = ambientTemperatureC(sim.topo.spec.site.climate, sim.time);
    // Recompute derived aggregates for the restored state without advancing time.
    sim.recomputeDerived();
    return sim;
  }

  // ---- Helpers used by the phase modules ---------------------------------------------------

  emit(severity: Severity, kind: EventSourceKind, id: string, code: string, message: string): void {
    this.events.emit(this.tick, this.time, severity, kind, id, code, message);
  }

  setNodeState(i: number, state: NodeStateCode, timerS = 0): void {
    this.rt.nodes.state[i] = state;
    this.rt.nodes.stateTimer[i] = timerS;
    this.rt.nodes.stateSince[i] = this.time;
  }

  resolveNode(ref: number | string): number | null {
    if (typeof ref === 'number') return ref >= 0 && ref < this.topo.nodes.length ? ref : null;
    return this.hostIndex.get(ref) ?? null;
  }

  primaryConfig() {
    return this.topo.nodes[0]?.cfg ?? null;
  }

  activePsus(i: number): number {
    return this.topo.nodes[i]!.cfg.psuCount - this.rt.nodes.psuFailed[i]!;
  }

  /** Node can accept new work. */
  isSchedulable(i: number, forTraining: boolean): boolean {
    const n = this.rt.nodes;
    const s = n.state[i];
    if (s !== NodeState.Online && s !== NodeState.Degraded) return false;
    if (n.drain[i] || n.job[i]! >= 0 || !n.powered[i]) return false;
    const f = n.faults[i]!;
    if (f & (NodeFault.Gpu | NodeFault.NvSwitch | NodeFault.Thermal)) return false;
    if (forTraining && f & NodeFault.Nic) return false;
    return true;
  }

  /** Recomputes the fault bitmask of a node from its component state. */
  refreshNodeFaults(i: number): void {
    const n = this.rt.nodes;
    const node = this.topo.nodes[i]!;
    const cfg = node.cfg;
    let f = n.faults[i]! & NodeFault.Thermal;
    for (let g = 0; g < cfg.gpuCount; g++) {
      if (this.rt.gpus.health[node.gpuStart + g]! >= GpuHealth.ResetRequired) f |= NodeFault.Gpu;
    }
    if (n.psuFailed[i]! > 0) f |= NodeFault.PsuRedundancy;
    if (cfg.psuCount - n.psuFailed[i]! < cfg.psuRequired) f |= NodeFault.PowerBrake;
    if (n.fanFailed[i]! > 0) f |= NodeFault.Fan;
    if (n.nicDownMask[i]! !== 0 || this.railsUnavailable(i) > 0) f |= NodeFault.Nic;
    if (n.dimmFault[i]) f |= NodeFault.Dimm;
    if (n.nvmeFault[i]) f |= NodeFault.Nvme;
    if (n.nvswitchFault[i]) f |= NodeFault.NvSwitch;
    n.faults[i] = f;
    const s = n.state[i];
    if (s === NodeState.Online && f !== 0) this.setNodeState(i, NodeState.Degraded);
    else if (s === NodeState.Degraded && f === 0) this.setNodeState(i, NodeState.Online);
  }

  /** Rails whose NIC or leaf switch is down. */
  railsUnavailable(i: number): number {
    const node = this.topo.nodes[i]!;
    const mr = this.topo.maxRails;
    let down = 0;
    for (let r = 0; r < node.cfg.rails; r++) {
      const leaf = this.topo.nodeLeaf[i * mr + r]!;
      const leafDown = leaf >= 0 && (this.rt.switches.failed[leaf] || !this.rt.switches.adminUp[leaf]);
      if (this.rt.nodes.nicDownMask[i]! & (1 << r) || leafDown) down++;
    }
    return down;
  }

  // ---- Tick -------------------------------------------------------------------------------

  private runTick(): void {
    this.tick++;
    this.time += this.dt * 1000;
    this.ambientC = ambientTemperatureC(this.topo.spec.site.climate, this.time);
    this.advanceNodeStates();
    processTickets(this);
    processFailures(this);
    scheduleJobs(this);
    advanceJobs(this);
    updateNetwork(this);
    this.updatePhysics();
    this.updateFacility();
    this.sampleTelemetry();
  }

  private advanceNodeStates(): void {
    const n = this.rt.nodes;
    const dt = this.dt;
    for (let i = 0; i < this.topo.nodes.length; i++) {
      const s = n.state[i]!;
      if (n.nicFlapTimer[i]! > 0) {
        n.nicFlapTimer[i] = Math.max(0, n.nicFlapTimer[i]! - dt);
        if (n.nicFlapTimer[i] === 0 && n.nicDownMask[i]) {
          n.nicDownMask[i] = 0;
          this.emit(
            'notice',
            'node',
            this.topo.nodes[i]!.hostname,
            'NIC_LINK_UP',
            'mlx5_core: port module event: link up (transceiver recovered)',
          );
          this.refreshNodeFaults(i);
        }
      }
      if (s !== NodeState.Post && s !== NodeState.Booting && s !== NodeState.ShuttingDown) continue;
      n.stateTimer[i] = n.stateTimer[i]! - dt;
      if (n.stateTimer[i]! > 0) continue;
      const node = this.topo.nodes[i]!;
      const host = node.hostname;
      if (s === NodeState.Post) {
        // A small fraction of power-on self tests fail (DIMM training, PCIe link training).
        if (this.rng.chance(0.004)) {
          n.dimmFault[i] = 1;
          this.setNodeState(i, NodeState.Failed);
          this.emit(
            'error',
            'node',
            host,
            'NODE_POST_FAILED',
            'POST failed: memory training error on DIMM channel (BMC SEL 0x0C)',
          );
          continue;
        }
        const boot = node.cfg.platform.boot.osBootSeconds.v * this.rng.range(0.9, 1.12);
        this.setNodeState(i, NodeState.Booting, boot);
        this.emit(
          'info',
          'node',
          host,
          'NODE_POST_OK',
          `POST complete — ${node.cfg.hostMemoryGB} GB memory, ${node.cfg.gpuCount} GPUs enumerated`,
        );
      } else if (s === NodeState.Booting) {
        n.upSince[i] = this.time;
        n.bootCount[i] = n.bootCount[i]! + 1;
        this.setNodeState(i, NodeState.Online);
        this.refreshNodeFaults(i);
        this.emit(
          'info',
          'node',
          host,
          'NODE_ONLINE',
          `Boot complete — GPU driver loaded, ${node.cfg.rails} fabric ports active, node registered with scheduler`,
        );
      } else {
        const next = n.afterShutdown[i]!;
        n.afterShutdown[i] = 0;
        n.powered[i] = 0;
        if (next === 1) {
          this.powerOnNode(i);
        } else if (next === 2) {
          this.setNodeState(i, NodeState.Maintenance);
          this.emit('notice', 'node', host, 'NODE_MAINTENANCE', 'Node powered off and placed in maintenance');
        } else {
          this.setNodeState(i, NodeState.Offline);
          this.emit(
            'info',
            'node',
            host,
            'NODE_POWERED_OFF',
            'Chassis power off (graceful shutdown complete)',
          );
        }
      }
    }
  }

  /** Starts power-on self test. GPU resets clear reset-required errors (row remaps applied). */
  powerOnNode(i: number): void {
    const n = this.rt.nodes;
    const node = this.topo.nodes[i]!;
    n.powered[i] = 1;
    n.faults[i] = n.faults[i]! & ~NodeFault.Thermal;
    for (let g = 0; g < node.cfg.gpuCount; g++) {
      const gi = node.gpuStart + g;
      const h = this.rt.gpus.health[gi]!;
      if (h === GpuHealth.ResetRequired || h === GpuHealth.Degraded) {
        if (this.rt.gpus.lastXid[gi] === 48 || this.rt.gpus.lastXid[gi] === 63) {
          this.rt.gpus.retiredRows[gi] = this.rt.gpus.retiredRows[gi]! + 1;
        }
        this.rt.gpus.health[gi] = GpuHealth.Ok;
      }
    }
    const post = node.cfg.platform.boot.postSeconds.v * this.rng.range(0.92, 1.15);
    this.setNodeState(i, NodeState.Post, post);
    this.emit(
      'info',
      'node',
      node.hostname,
      'NODE_POST_START',
      'Chassis power on — BIOS POST started (memory training)',
    );
  }

  // ---- Physics ----------------------------------------------------------------------------

  private updatePhysics(): void {
    const { nodes: n, gpus: g, racks: rk } = this.rt;
    const dt = this.dt;
    const topo = this.topo;
    const RESET = GpuHealth.ResetRequired;
    const POST = NodeState.Post;
    const BOOTING = NodeState.Booting;
    const SHUTTING = NodeState.ShuttingDown;
    const FAILED = NodeState.Failed;
    const T_POWERCAP = Throttle.PowerCap;
    const T_THERMAL = Throttle.ThermalSlowdown;
    const T_BRAKE = Throttle.PowerBrake | Throttle.HwSlowdown;
    const gHealth = g.health;
    const gTemp = g.tempC;
    const gAct = g.activity;
    const gUtil = g.util;
    const gPower = g.powerW;
    const gClock = g.clock;
    const gThr = g.throttle;
    const gLimit = g.powerLimitW;
    const gVar = g.rthVar;
    const gMem = g.memUsedGB;
    let gpusHealthy = 0;
    let utilSum = 0;
    let tempSum = 0;
    let tempMax = 0;
    let poweredGpus = 0;
    let gpuPowerSum = 0;
    let hbmUsed = 0;
    let throttled = 0;
    let hazard = 0;
    const nodeHazard = this.nodeHazard;

    for (let i = 0; i < topo.nodes.length; i++) {
      const node = topo.nodes[i]!;
      const cfg = node.cfg;
      const spec = cfg.gpu;
      const hall = this.halls[node.hallIdx]!;
      const rack = topo.racks[node.rackIdx]!;
      const inlet = hall.supplyAirC + rack.inletOffsetC + rk.hotspotC[node.rackIdx]!;
      n.inletC[i] = inlet;
      const liquid = cfg.cooling === 'liquid';
      const state = n.state[i]!;
      const powered = n.powered[i] === 1;
      const gpuCount = cfg.gpuCount;
      const start = node.gpuStart;
      const half = gpuCount / 2;
      const peakGpuW = gpuCount * cfg.gpuPowerLimitW;
      const loadFrac = peakGpuW > 0 ? n.gpuW[i]! / peakGpuW : 0;
      const fansHealthy = cfg.fanCount > 0 ? (cfg.fanCount - n.fanFailed[i]!) / cfg.fanCount : 1;
      const iface = liquid ? spec.thermal.liquid! : spec.thermal.air!;
      const heatCap = iface.heatCapacityJK.v;

      if (!powered) {
        // Unpowered: devices relax towards the coolant / inlet temperature.
        const ambientRef = liquid ? hall.liquidSupplyC : inlet;
        const rth = iface.rthKW.v * 3;
        const decay = Math.exp(-dt / (rth * heatCap));
        let maxT = 0;
        for (let k = 0; k < gpuCount; k++) {
          const gi = start + k;
          gPower[gi] = 0;
          gUtil[gi] = 0;
          gClock[gi] = 0;
          gThr[gi] = 0;
          gMem[gi] = 0;
          const T = ambientRef + (gTemp[gi]! - ambientRef) * decay;
          gTemp[gi] = T;
          if (T > maxT) maxT = T;
        }
        nodeHazard[i] = 0;
        n.fanDuty[i] = 0;
        n.gpuW[i] = 0;
        n.dcW[i] = STANDBY_W;
        n.wallW[i] = STANDBY_W;
        n.liquidHeatW[i] = 0;
        n.gpuUtilAvg[i] = 0;
        n.gpuTempMax[i] = maxT;
        n.energyWh[i] = n.energyWh[i]! + (STANDBY_W * dt) / 3600;
        continue;
      }

      // Per-node thermal path: one resistance scale and one decay factor for all GPUs
      // (per-GPU variance only shifts the steady state; its effect on τ is negligible).
      const rScale = liquid
        ? liquidResistance(iface.rthKW.v, 1)
        : airResistance(iface.rthKW.v, n.fanDuty[i]!, fansHealthy);
      const decay = Math.exp(-dt / (rScale * heatCap));
      const liquidRef = hall.liquidSupplyC + 1 + 5 * loadFrac;
      const refLow = liquid ? liquidRef : inlet;
      const refHigh = liquid ? liquidRef + 1.5 : inlet + 1 + 4 * loadFrac;
      const brake = cfg.psuCount - n.psuFailed[i]! < cfg.psuRequired;
      const idle = spec.power.idleW.v;
      const tdp = spec.power.tdpW.v;
      const slow = spec.thermal.slowdownC.v;
      const shut = spec.thermal.shutdownC.v;

      let gpuW = 0;
      let utilNode = 0;
      let maxT = 0;
      let actSum = 0;
      let tempNode = 0;
      for (let k = 0; k < gpuCount; k++) {
        const gi = start + k;
        const failed = gHealth[gi]! >= RESET;
        let T = gTemp[gi]!;
        const act = failed ? 0 : gAct[gi]!;
        const util = failed ? 0 : gUtil[gi]!;
        let clock = 0;
        let thr = 0;
        let P: number;
        if (failed) {
          P = idle * 0.6;
        } else {
          const pc = powerLimitedClock(idle, tdp, act, T, gLimit[gi]!);
          const tc = T > slow ? thermalClock(T, slow, shut) : 1;
          clock = pc < tc ? pc : tc;
          if (brake && clock > 0.5) clock = 0.5;
          if (pc < 0.999 && act > 0) thr |= T_POWERCAP;
          if (tc < 1) thr |= T_THERMAL;
          if (brake) thr |= T_BRAKE;
          P = gpuPowerW(idle, tdp, act, clock, T);
          gpusHealthy++;
        }
        const ref = k >= half ? refHigh : refLow;
        const tss = ref + P * rScale * gVar[gi]!;
        T = tss + (T - tss) * decay;
        gTemp[gi] = T;
        gPower[gi] = P;
        gClock[gi] = clock;
        gThr[gi] = thr;
        gUtil[gi] = util;
        gpuW += P;
        utilNode += util;
        actSum += act;
        tempNode += T;
        if (T > maxT) maxT = T;
        hbmUsed += gMem[gi]!;
        if (thr !== 0) throttled++;
      }
      poweredGpus += gpuCount;
      utilSum += utilNode;
      tempSum += tempNode;
      gpuPowerSum += gpuW;
      if (maxT > tempMax) tempMax = maxT;
      // Arrhenius acceleration (Ea = 0.5 eV, reference 70 °C) at the node's mean GPU temperature;
      // idle GPUs fail at 40 % of the loaded rate.
      const meanT = gpuCount > 0 ? tempNode / gpuCount : 0;
      const actMean = gpuCount > 0 ? actSum / gpuCount : 0;
      const h = gpuCount * Math.exp(5802 * (1 / 343.15 - 1 / (meanT + 273.15))) * (0.4 + 0.6 * actMean);
      nodeHazard[i] = h;
      hazard += h;

      // Thermal trip: any GPU at or above its shutdown temperature.
      if (maxT >= shut && state !== FAILED) this.thermalTrip(i, maxT);

      // Fans (firmware fan curve, slew limited). POST runs fans at full speed.
      let duty = n.fanDuty[i]!;
      const target =
        state === POST ? 1 : liquid ? Math.max(AIR_MIN_DUTY, fanTargetDuty(inlet + 25)) : fanTargetDuty(maxT);
      const step = FAN_SLEW_PER_S * dt;
      duty += Math.max(-step, Math.min(step, target - duty));
      duty = duty < AIR_MIN_DUTY ? AIR_MIN_DUTY : duty > 1 ? 1 : duty;
      n.fanDuty[i] = duty;

      const booting = state === POST || state === BOOTING;
      const cpuUtil = booting ? 0.45 : state === SHUTTING ? 0.25 : n.cpuUtil[i]!;
      const bd = nodePowerBreakdown(cfg, {
        gpuW,
        gpuActivity: actMean,
        cpuUtil,
        memActivity: n.memActivity[i]!,
        storageActivity: n.storageActivity[i]!,
        networkActivity: n.netActivity[i]!,
        nvlinkActivity: n.nvlinkActivity[i]!,
        fanDuty: duty,
        fansHealthy,
      });
      const wall = psuInputW(cfg.psu as PsuSpec, bd.dcW, Math.max(1, cfg.psuCount - n.psuFailed[i]!));
      n.gpuW[i] = gpuW;
      n.dcW[i] = bd.dcW;
      n.wallW[i] = wall;
      n.liquidHeatW[i] = bd.liquidHeatW;
      n.gpuUtilAvg[i] = gpuCount > 0 ? utilNode / gpuCount : 0;
      n.gpuTempMax[i] = maxT;
      n.energyWh[i] = n.energyWh[i]! + (wall * dt) / 3600;
    }

    const c = this.cluster;
    c.gpusHealthy = gpusHealthy;
    c.gpuUtilAvg = topo.gpuCount > 0 ? utilSum / topo.gpuCount : 0;
    c.gpuTempAvg = poweredGpus > 0 ? tempSum / poweredGpus : 0;
    c.gpuTempMax = tempMax;
    c.gpuPowerW = gpuPowerSum;
    c.hbmUsedGB = hbmUsed;
    c.throttledGpus = throttled;
    c.gpuHazardWeight = hazard;
  }

  private thermalTrip(i: number, maxT: number): void {
    const node = this.topo.nodes[i]!;
    const n = this.rt.nodes;
    n.faults[i] = n.faults[i]! | NodeFault.Thermal;
    for (let k = 0; k < node.cfg.gpuCount; k++) {
      const gi = node.gpuStart + k;
      if (
        this.rt.gpus.tempC[gi]! >= node.cfg.gpu.thermal.shutdownC.v &&
        this.rt.gpus.health[gi]! < GpuHealth.ResetRequired
      ) {
        this.rt.gpus.health[gi] = GpuHealth.ResetRequired;
        this.rt.gpus.lastXid[gi] = 79;
      }
    }
    this.failNode(
      i,
      `Thermal trip: GPU at ${maxT.toFixed(1)} °C ≥ shutdown threshold — BMC emergency power off`,
      true,
      'thermal',
    );
  }

  /**
   * Marks a node failed, crashing any job on it. `powerOff` reflects whether the BMC cut
   * power (thermal trip, power loss) or the node is hung.
   */
  failNode(
    i: number,
    reason: string,
    powerOff: boolean,
    cause: 'crash' | 'thermal' | 'power' | 'hardware',
  ): void {
    const node = this.topo.nodes[i]!;
    const n = this.rt.nodes;
    if (n.state[i] === NodeState.Failed) return;
    this.setNodeState(i, NodeState.Failed);
    if (powerOff) n.powered[i] = 0;
    this.emit('critical', 'node', node.hostname, 'NODE_FAILED', reason);
    const job = n.job[i]!;
    if (job >= 0) this.onNodeLostByJob(job, i, reason);
    if (this.autoRemediation) {
      const hours = cause === 'thermal' ? 0.5 : cause === 'crash' ? 0.25 : 4;
      this.openTicket(
        'node',
        i,
        hours,
        cause === 'hardware' ? 'Hardware replacement (RMA)' : 'Reboot and health check',
      );
    }
  }

  openTicket(kind: RepairTicket['kind'], target: number, meanHours: number, action: string): void {
    if (this.tickets.some((t) => t.kind === kind && t.target === target)) return;
    // Exponentially distributed time-to-repair around the mean, at least 10 minutes.
    const hours = Math.max(1 / 6, -Math.log(1 - this.rng.next() * 0.999) * meanHours);
    this.tickets.push({ id: this.nextTicketId++, kind, target, due: this.time + hours * 3_600_000, action });
  }

  onNodeLostByJob(jobId: number, nodeIdx: number, reason: string): void {
    handleNodeLost(this, jobId, nodeIdx, reason);
  }

  // ---- Facility ---------------------------------------------------------------------------

  private updateFacility(): void {
    const { nodes: n, racks: rk, switches: sw } = this.rt;
    const topo = this.topo;
    const dt = this.dt;
    for (const h of this.halls) {
      h.itW = 0;
      h.roomW = 0;
      h.rdhxW = 0;
      h.liquidW = 0;
    }
    let itW = 0;
    for (const rack of topo.racks) {
      let power = 0;
      let liquid = 0;
      for (let k = 0; k < rack.nodeCount; k++) {
        const i = rack.nodeStart + k;
        power += n.wallW[i]!;
        liquid += n.liquidHeatW[i]!;
      }
      let aux = rack.auxIdleW;
      if (rack.kind === 'network') {
        aux = 0;
        for (const s of rack.switchIdx) aux += sw.powerW[s]!;
      } else if (rack.rackSystem) {
        // NVLink switch trays draw more under all-reduce traffic; idle when trays are off.
        let act = 0;
        for (let k = 0; k < rack.nodeCount; k++) act += n.nvlinkActivity[rack.nodeStart + k]!;
        act /= Math.max(1, rack.nodeCount);
        aux = rack.auxIdleW + (rack.auxPeakW - rack.auxIdleW) * act;
        liquid += aux * 0.85;
      } else if (rack.kind === 'storage') {
        aux =
          rack.auxIdleW + (rack.auxPeakW - rack.auxIdleW) * Math.min(1, this.cluster.storageWriteGBs / 50);
      }
      power += aux;
      const split = splitRackHeat(rack.cooling, power, liquid, this.rdhxCapW);
      rk.powerW[rack.idx] = power;
      rk.roomHeatW[rack.idx] = split.roomAirW;
      rk.rdhxHeatW[rack.idx] = split.rdhxW;
      rk.liquidHeatW[rack.idx] = split.liquidW;
      const hall = this.halls[rack.hallIdx]!;
      hall.itW += power;
      hall.roomW += split.roomAirW;
      hall.rdhxW += split.rdhxW;
      hall.liquidW += split.liquidW;
      itW += power;
      rk.inletC[rack.idx] = hall.supplyAirC + rack.inletOffsetC + rk.hotspotC[rack.idx]!;
      // Room-air racks above ~25 kW develop inlet hot spots from hot-aisle recirculation.
      const target =
        rack.cooling === 'air' ? Math.max(0, (split.roomAirW - 25_000) / 1000) * HOTSPOT_C_PER_KW : 0;
      rk.hotspotC[rack.idx] =
        rk.hotspotC[rack.idx]! + (target - rk.hotspotC[rack.idx]!) * (1 - Math.exp(-dt / 120));
    }

    // Chilled-water plant
    const plantSpec = topo.spec.site.plant;
    const chillerCapW =
      Math.max(0, plantSpec.chillers - this.plant.chillersFailed) *
      this.plantParams.chiller.capacityKW.v *
      1000;
    let chilledLoad = 0;
    let liquidTotal = 0;
    for (const h of this.halls) {
      chilledLoad += h.roomW + h.rdhxW;
      liquidTotal += h.liquidW;
    }
    if (!plantSpec.dryCoolerId) chilledLoad += liquidTotal;
    const chwOver = chillerCapW > 0 ? Math.max(0, chilledLoad / chillerCapW - 1) : chilledLoad > 0 ? 1.5 : 0;
    const chwTarget = plantSpec.chilledWaterSupplyC + Math.min(30, chwOver * CHW_OVERLOAD_K);
    this.plant.chwSupplyC += (chwTarget - this.plant.chwSupplyC) * (1 - Math.exp(-dt / CHW_TAU_S));
    const chwRise = this.plant.chwSupplyC - plantSpec.chilledWaterSupplyC;

    topo.halls.forEach((hallInfo, idx) => {
      const h = this.halls[idx]!;
      const unitW = hallInfo.airUnit.capacityKW.v * 1000;
      const capW = Math.max(0, hallInfo.spec.air.count - h.airUnitsFailed) * unitW;
      const over = capW > 0 ? Math.max(0, h.roomW / capW - 1) : h.roomW > 0 ? 1 : 0;
      const airTarget = h.airSetpointC + Math.min(25, over * HALL_AIR_OVERLOAD_K) + chwRise * 0.8;
      h.supplyAirC += (airTarget - h.supplyAirC) * (1 - Math.exp(-dt / HALL_AIR_TAU_S));
      if (hallInfo.liquidUnit && hallInfo.spec.liquid) {
        const lcap =
          Math.max(0, hallInfo.spec.liquid.count - h.liquidUnitsFailed) *
          hallInfo.liquidUnit.capacityKW.v *
          1000;
        const lover = lcap > 0 ? Math.max(0, h.liquidW / lcap - 1) : h.liquidW > 0 ? 1.2 : 0;
        // Warm-water loops above the dry-cooler limit depend on chiller assist.
        const assist = this.ambientC > plantSpec.warmWaterSupplyC - 1 ? chwRise * 0.5 : 0;
        const lTarget = h.liquidSetpointC + Math.min(30, lover * LIQUID_OVERLOAD_K) + assist;
        h.liquidSupplyC += (lTarget - h.liquidSupplyC) * (1 - Math.exp(-dt / LIQUID_TAU_S));
      }
    });

    let roomW = 0;
    let rdhxW = 0;
    for (const h of this.halls) {
      roomW += h.roomW;
      rdhxW += h.rdhxW;
    }
    this.itW = itW;
    this.facility = facilityPower(this.plantParams, {
      itW,
      roomAirHeatW: roomW,
      rdhxHeatW: rdhxW,
      liquidHeatW: liquidTotal,
      ambientC: this.ambientC,
    });
    const itWh = (itW * dt) / 3600;
    const facWh = (this.facility.facilityW * dt) / 3600;
    this.energy.itWh += itWh;
    this.energy.facilityWh += facWh;
    this.energy.costEur += (facWh / 1000) * topo.spec.site.energyPriceEurPerKWh;
  }

  // ---- Telemetry --------------------------------------------------------------------------

  private sampleTelemetry(): void {
    const t = this.tick * this.dt;
    if (Math.floor(t / SERIES_INTERVAL_S) !== Math.floor((t - this.dt) / SERIES_INTERVAL_S)) {
      const values = this.currentSeriesValues();
      this.seriesTime.push(this.time);
      for (const k of SERIES_KEYS) this.series[k].push(values[k]);
      this.pendingSamples.push({ t: this.time, values });
      if (this.pendingSamples.length > 200) this.pendingSamples.shift();
    }
    if (Math.floor(t / NODE_HISTORY_INTERVAL_S) !== Math.floor((t - this.dt) / NODE_HISTORY_INTERVAL_S)) {
      const h = this.nodeHist;
      const n = this.rt.nodes;
      for (let i = 0; i < this.topo.nodes.length; i++) {
        const o = i * NODE_HISTORY_LENGTH + h.cursor;
        h.util[o] = n.gpuUtilAvg[i]!;
        h.temp[o] = n.gpuTempMax[i]!;
        h.power[o] = n.wallW[i]!;
      }
      h.cursor = (h.cursor + 1) % NODE_HISTORY_LENGTH;
      h.filled = Math.min(NODE_HISTORY_LENGTH, h.filled + 1);
    }
  }

  currentSeriesValues(): Record<SeriesKey, number> {
    const c = this.cluster;
    const n = this.rt.nodes;
    let online = 0;
    for (let i = 0; i < this.topo.nodes.length; i++) {
      const s = n.state[i];
      if (s === NodeState.Online || s === NodeState.Degraded || s === NodeState.Draining) online++;
    }
    const supply = this.halls.reduce((s, h) => s + h.supplyAirC, 0) / Math.max(1, this.halls.length);
    const liquidHalls = this.topo.halls.filter((h) => h.liquidUnit);
    const liquidSupply =
      liquidHalls.length > 0
        ? liquidHalls.reduce((s, h) => s + this.halls[h.idx]!.liquidSupplyC, 0) / liquidHalls.length
        : 0;
    return {
      itPowerW: this.itW,
      facilityPowerW: this.facility.facilityW,
      coolingPowerW: this.facility.coolingW,
      pue: this.facility.pue,
      gpuUtil: c.gpuUtilAvg,
      gpuTempAvg: c.gpuTempAvg,
      gpuTempMax: c.gpuTempMax,
      gpuPowerW: c.gpuPowerW,
      hbmUsedGB: c.hbmUsedGB,
      fabricGbps: c.fabricTrafficGbps,
      storageGBs: c.storageReadGBs + c.storageWriteGBs,
      trainTokS: c.trainingTokensPerSec,
      inferTokS: c.inferenceTokensPerSec,
      achievedPflops: c.achievedFlops / 1e15,
      ambientC: this.ambientC,
      supplyAirC: supply,
      liquidSupplyC: liquidSupply,
      gpusAllocated: c.gpusAllocated,
      nodesOnline: online,
      throttledGpus: c.throttledGpus,
    };
  }

  private recordTickDuration(ms: number): void {
    this.tickDurations[this.tickDurCursor] = ms;
    this.tickDurCursor = (this.tickDurCursor + 1) % this.tickDurations.length;
    this.tickDurCount = Math.min(this.tickDurations.length, this.tickDurCount + 1);
  }

  /** Recomputes aggregates after a restore without advancing time or consuming randomness. */
  private recomputeDerived(): void {
    // Re-running the physics would advance temperatures; derive aggregates from stored state only.
    const c = this.cluster;
    const g = this.rt.gpus;
    let util = 0;
    let temp = 0;
    let max = 0;
    let power = 0;
    let hbm = 0;
    let healthy = 0;
    let poweredGpus = 0;
    for (let i = 0; i < this.topo.gpuCount; i++) {
      if (!this.rt.nodes.powered[this.topo.gpuNode[i]!]) continue;
      poweredGpus++;
      util += g.util[i]!;
      temp += g.tempC[i]!;
      max = Math.max(max, g.tempC[i]!);
      power += g.powerW[i]!;
      hbm += g.memUsedGB[i]!;
      if (g.health[i]! < GpuHealth.ResetRequired) healthy++;
    }
    c.gpuUtilAvg = this.topo.gpuCount > 0 ? util / this.topo.gpuCount : 0;
    c.gpuTempAvg = poweredGpus > 0 ? temp / poweredGpus : 0;
    c.gpuTempMax = max;
    c.gpuPowerW = power;
    c.hbmUsedGB = hbm;
    c.gpusHealthy = healthy;
    let itW = 0;
    for (let r = 0; r < this.topo.racks.length; r++) itW += this.rt.racks.powerW[r]!;
    let room = 0;
    let rdhx = 0;
    let liquid = 0;
    for (const h of this.halls) {
      room += h.roomW;
      rdhx += h.rdhxW;
      liquid += h.liquidW;
    }
    this.itW = itW;
    this.facility = facilityPower(this.plantParams, {
      itW,
      roomAirHeatW: room,
      rdhxHeatW: rdhx,
      liquidHeatW: liquid,
      ambientC: this.ambientC,
    });
  }
}

function emptyCluster(): ClusterAggregates {
  return {
    gpusHealthy: 0,
    gpusAllocated: 0,
    gpuUtilAvg: 0,
    gpuTempAvg: 0,
    gpuTempMax: 0,
    gpuPowerW: 0,
    hbmUsedGB: 0,
    throttledGpus: 0,
    fabricTrafficGbps: 0,
    storageReadGBs: 0,
    storageWriteGBs: 0,
    trainingTokensPerSec: 0,
    inferenceTokensPerSec: 0,
    achievedFlops: 0,
    gpuHazardWeight: 0,
  };
}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();
