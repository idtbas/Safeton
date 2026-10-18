/** Read models: snapshots, node detail and static topology description. Never mutate state. */
import { hashString } from '../core/rng';
import { NODE_HISTORY_LENGTH, NODE_HISTORY_INTERVAL_S, type Simulation } from './simulation';
import {
  ACTIVE_JOB_STATES,
  GPU_HEALTH_NAMES,
  NODE_FAULT_NAMES,
  NODE_STATE_NAMES,
  NodeState,
  Throttle,
  type InferencePlan,
  type Job,
  type JobSummary,
  type NodeDetail,
  type PerfStats,
  type SeriesSample,
  type Snapshot,
  type TopologyInfo,
  type TrainingPlan,
} from './types';

export function jobSummary(_sim: Simulation, job: Job): JobSummary {
  const training = job.spec.kind === 'training';
  const plan = job.plan as TrainingPlan & InferencePlan;
  const gpus = training ? (job.spec as { gpus: number }).gpus : plan.replicas * plan.tp;
  const progress = training ? job.step / Math.max(1, plan.totalSteps) : 0;
  const stepS = job.metrics.stepTimeS || plan.nominalStepS;
  const etaS = training && job.state !== 'completed' ? (plan.totalSteps - job.step) * stepS : null;
  return {
    id: job.id,
    name: job.name,
    kind: job.spec.kind,
    user: job.user,
    state: job.state,
    reason: job.reason,
    modelId: job.spec.modelId,
    gpus,
    nodes: plan.nodes,
    progress,
    etaS,
    restarts: job.restarts,
    goodput: job.allocatedS > 0 ? job.productiveS / job.allocatedS : 0,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    metrics: { ...job.metrics },
  };
}

export function buildSnapshot(
  sim: Simulation,
  opts: { perf: PerfStats; running: boolean; timeScale: number; sinceSeq: number; samples: SeriesSample[] },
): Snapshot {
  const { nodes: n, racks: rk, switches: sw } = sim.rt;
  const topo = sim.topo;
  const nodesByState = new Array<number>(NODE_STATE_NAMES.length).fill(0);
  for (let i = 0; i < topo.nodes.length; i++) nodesByState[n.state[i]!]!++;

  const swUp = new Uint8Array(topo.switches.length);
  let switchesDown = 0;
  for (let s = 0; s < swUp.length; s++) {
    swUp[s] = sw.failed[s] === 0 && sw.adminUp[s] === 1 ? 1 : 0;
    if (!swUp[s]) switchesDown++;
  }
  let linksDown = 0;
  for (let l = 0; l < sim.rt.links.up.length; l++) if (!sim.rt.links.up[l]) linksDown++;

  const jobs = [...sim.jobs.values()];
  const active = jobs.filter((j) => j.state === 'pending' || ACTIVE_JOB_STATES.includes(j.state));
  const finished = jobs
    .filter((j) => !(j.state === 'pending' || ACTIVE_JOB_STATES.includes(j.state)))
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, 25);

  const f = sim.facility;
  const c = sim.cluster;
  const plantSpec = topo.spec.site.plant;
  let fabricCapacity = 0;
  for (let l = 0; l < topo.links.count; l++) if (topo.links.tier[l] === 0) fabricCapacity += topo.links.bandwidthGbps[l]!;

  return {
    tick: sim.tick,
    time: sim.time,
    dt: sim.dt,
    running: opts.running,
    timeScale: opts.timeScale,
    failureRateMultiplier: sim.failureRateMultiplier,
    autoRemediation: sim.autoRemediation,
    perf: opts.perf,
    facility: {
      ambientC: sim.ambientC,
      itPowerW: sim.itW,
      facilityPowerW: f.facilityW,
      coolingPowerW: f.coolingW,
      upsLossW: f.upsLossW,
      pue: f.pue,
      chillerCop: f.chillerCop,
      freeCoolingChilled: f.freeCoolingChilled,
      freeCoolingWarm: f.freeCoolingWarm,
      chilledWaterSupplyC: sim.plant.chwSupplyC,
      chillersHealthy: plantSpec.chillers - sim.plant.chillersFailed,
      chillersInstalled: plantSpec.chillers,
      energyMWh: sim.energy.facilityWh / 1e6,
      energyCostEur: sim.energy.costEur,
    },
    halls: topo.halls.map((h, i) => {
      const rt = sim.halls[i]!;
      return {
        id: h.id,
        name: h.name,
        itPowerW: rt.itW,
        roomAirHeatW: rt.roomW,
        rdhxHeatW: rt.rdhxW,
        liquidHeatW: rt.liquidW,
        supplyAirC: rt.supplyAirC,
        supplyAirSetpointC: rt.airSetpointC,
        airCapacityW: (h.spec.air.count - rt.airUnitsFailed) * h.airUnit.capacityKW.v * 1000,
        airUnitsHealthy: h.spec.air.count - rt.airUnitsFailed,
        airUnitsInstalled: h.spec.air.count,
        liquidSupplyC: h.liquidUnit ? rt.liquidSupplyC : null,
        liquidSupplySetpointC: h.liquidUnit ? rt.liquidSetpointC : null,
        liquidCapacityW: h.liquidUnit && h.spec.liquid ? (h.spec.liquid.count - rt.liquidUnitsFailed) * h.liquidUnit.capacityKW.v * 1000 : 0,
        liquidUnitsHealthy: h.spec.liquid ? h.spec.liquid.count - rt.liquidUnitsFailed : 0,
        liquidUnitsInstalled: h.spec.liquid?.count ?? 0,
      };
    }),
    cluster: {
      nodesTotal: topo.nodes.length,
      nodesByState,
      gpusTotal: topo.gpuCount,
      gpusHealthy: c.gpusHealthy,
      gpusAllocated: c.gpusAllocated,
      gpuUtilAvg: c.gpuUtilAvg,
      gpuTempAvg: c.gpuTempAvg,
      gpuTempMax: c.gpuTempMax,
      gpuPowerW: c.gpuPowerW,
      hbmUsedGB: c.hbmUsedGB,
      hbmTotalGB: topo.nodes.reduce((s, nd) => s + nd.cfg.gpuCount * nd.cfg.gpu.memory.capacityGB.v, 0),
      throttledGpus: c.throttledGpus,
      fabricTrafficGbps: c.fabricTrafficGbps,
      fabricCapacityGbps: fabricCapacity,
      switchesDown,
      linksDown,
      storageReadGBs: c.storageReadGBs,
      storageWriteGBs: c.storageWriteGBs,
      trainingTokensPerSec: c.trainingTokensPerSec,
      inferenceTokensPerSec: c.inferenceTokensPerSec,
      achievedPflops: c.achievedFlops / 1e15,
    },
    jobs: [...active, ...finished].map((j) => jobSummary(sim, j)),
    nodes: {
      state: n.state.slice(),
      faults: n.faults.slice(),
      job: n.job.slice(),
      powerW: n.wallW.slice(),
      gpuUtil: n.gpuUtilAvg.slice(),
      gpuTempMax: n.gpuTempMax.slice(),
      fanDuty: n.fanDuty.slice(),
      inletC: n.inletC.slice(),
      netGbps: n.netGbps.slice(),
    },
    racks: { powerW: rk.powerW.slice(), inletC: rk.inletC.slice(), liquidHeatW: rk.liquidHeatW.slice() },
    switches: { up: swUp, util: sw.util.slice(), powerW: sw.powerW.slice() },
    events: sim.events.since(opts.sinceSeq, 500),
    samples: opts.samples,
  };
}

function uuidFor(seed: string): string {
  const h = (s: string) => hashString(s).toString(16).padStart(8, '0');
  const a = h(seed);
  const b = h(`${seed}:1`);
  const c = h(`${seed}:2`);
  const d = h(`${seed}:3`);
  return `GPU-${a}-${b.slice(0, 4)}-${b.slice(4, 8)}-${c.slice(0, 4)}-${c.slice(4)}${d}`;
}

export function buildNodeDetail(sim: Simulation, i: number): NodeDetail {
  const node = sim.topo.nodes[i]!;
  const cfg = node.cfg;
  const n = sim.rt.nodes;
  const g = sim.rt.gpus;
  const rack = sim.topo.racks[node.rackIdx]!;
  const hall = sim.topo.halls[node.hallIdx]!;
  const mr = Math.max(1, sim.topo.maxRails);
  const powered = n.powered[i] === 1;
  const gpus = [];
  for (let k = 0; k < cfg.gpuCount; k++) {
    const gi = node.gpuStart + k;
    const thr = g.throttle[gi]!;
    const throttle: string[] = [];
    if (thr & Throttle.PowerCap) throttle.push('SW Power Cap');
    if (thr & Throttle.ThermalSlowdown) throttle.push('SW Thermal Slowdown');
    if (thr & Throttle.HwSlowdown) throttle.push('HW Slowdown');
    if (thr & Throttle.PowerBrake) throttle.push('HW Power Brake Slowdown');
    gpus.push({
      index: k,
      uuid: uuidFor(`${node.hostname}:${k}`),
      model: cfg.gpu.name,
      health: GPU_HEALTH_NAMES[g.health[gi]!] ?? 'unknown',
      util: g.util[gi]!,
      memUsedGB: g.memUsedGB[gi]!,
      memTotalGB: cfg.gpu.memory.capacityGB.v,
      powerW: g.powerW[gi]!,
      powerLimitW: g.powerLimitW[gi]!,
      tempC: g.tempC[gi]!,
      hbmTempC: powered ? g.tempC[gi]! + 4 + 3 * g.util[gi]! : g.tempC[gi]!,
      clockMHz: Math.round(cfg.gpu.boostClockMHz.v * g.clock[gi]!),
      maxClockMHz: cfg.gpu.boostClockMHz.v,
      throttle,
      eccCorrected: g.eccSbe[gi]!,
      eccUncorrected: g.eccDbe[gi]!,
      retiredRows: g.retiredRows[gi]!,
      lastXid: g.lastXid[gi]!,
    });
  }
  const nics = [];
  for (let r = 0; r < cfg.rails; r++) {
    const leaf = sim.topo.nodeLeaf[i * mr + r]!;
    nics.push({
      rail: r,
      model: cfg.computeNic.name,
      speedGbps: cfg.computeNic.portSpeedGbps,
      up: powered && (n.nicDownMask[i]! & (1 << r)) === 0 && (leaf < 0 || (sim.rt.switches.failed[leaf] === 0 && sim.rt.switches.adminUp[leaf] === 1)),
      leaf: leaf >= 0 ? sim.topo.switches[leaf]!.name : null,
      txGbps: n.railGbps[i * mr + r]!,
    });
  }
  const faults: string[] = [];
  for (const [bit, name] of Object.entries(NODE_FAULT_NAMES)) if (n.faults[i]! & Number(bit)) faults.push(name);

  const h = sim.nodeHist;
  const len = h.filled;
  const series = (arr: Float32Array) => {
    const out: number[] = [];
    for (let k = 0; k < len; k++) {
      const idx = (h.cursor - len + k + NODE_HISTORY_LENGTH) % NODE_HISTORY_LENGTH;
      out.push(arr[i * NODE_HISTORY_LENGTH + idx]!);
    }
    return out;
  };
  const fansHealthy = cfg.fanCount - n.fanFailed[i]!;
  const memUsed = powered ? cfg.hostMemoryGB * (0.04 + 0.3 * n.memActivity[i]!) : 0;
  return {
    index: i,
    hostname: node.hostname,
    rack: rack.name,
    hall: hall.name,
    slotU: node.slotU,
    state: NODE_STATE_NAMES[n.state[i]!]!,
    faults,
    platform: cfg.platform.name,
    reference: cfg.platform.reference,
    cooling: cfg.cooling,
    job: n.job[i]! >= 0 ? n.job[i]! : null,
    powered,
    powerW: n.wallW[i]!,
    powerBreakdown: {
      gpu: n.gpuW[i]!,
      rest: Math.max(0, n.dcW[i]! - n.gpuW[i]!),
      conversionLoss: Math.max(0, n.wallW[i]! - n.dcW[i]!),
    },
    psu: { model: cfg.psu.name, installed: cfg.psuCount, healthy: cfg.psuCount - n.psuFailed[i]!, required: cfg.psuRequired },
    fans: { installed: cfg.fanCount, healthy: fansHealthy, duty: n.fanDuty[i]! },
    inletC: n.inletC[i]!,
    cpu: { model: cfg.cpu.name, sockets: cfg.cpuCount, cores: cfg.cpuCount * cfg.cpu.cores, util: powered ? n.cpuUtil[i]! : 0 },
    memory: {
      totalGB: cfg.hostMemoryGB,
      usedGB: memUsed,
      speedMTs: cfg.memorySpeedMTs,
      type: cfg.dimm ? cfg.dimm.type : cfg.cpu.memory.type,
      dimms: cfg.dimmCount,
    },
    nics,
    storage: { model: cfg.dataDrive.name, count: cfg.dataDriveCount, capacityTB: cfg.dataDrive.capacityTB * cfg.dataDriveCount },
    gpus,
    stateSince: n.stateSince[i]!,
    uptimeS: powered && n.state[i] !== NodeState.Post && n.state[i] !== NodeState.Booting ? (sim.time - n.upSince[i]!) / 1000 : 0,
    history: { util: series(h.util), tempC: series(h.temp), powerW: series(h.power), intervalS: NODE_HISTORY_INTERVAL_S },
  };
}

export function buildTopologyInfo(sim: Simulation): TopologyInfo {
  const topo = sim.topo;
  return {
    spec: topo.spec,
    fingerprint: topo.fingerprint,
    halls: topo.halls.map((h) => ({ id: h.id, name: h.name, racks: [...h.rackIdx] })),
    racks: topo.racks.map((r) => ({
      name: r.name,
      hall: r.hallIdx,
      row: r.rowId,
      kind: r.kind,
      cooling: r.cooling,
      nodeStart: r.nodeStart,
      nodeCount: r.nodeCount,
      switches: [...r.switchIdx],
      designPeakW: r.designPeakW,
    })),
    nodes: topo.nodes.map((nd) => ({
      hostname: nd.hostname,
      rack: nd.rackIdx,
      platform: nd.cfg.platform.name,
      gpus: nd.cfg.gpuCount,
      gpuModel: nd.cfg.gpu.name,
      leafGroup: nd.leafGroup,
      nvlDomain: nd.nvlDomain,
    })),
    switches: topo.switches.map((s) => ({ name: s.name, tier: s.tier, plane: s.plane, model: s.spec.name, rack: s.rackIdx })),
    storage: topo.storage.map((s) => ({ name: s.name, model: s.spec.name, rack: s.rackIdx })),
    gpuCount: topo.gpuCount,
    fabric: {
      topology: topo.fabric.topology,
      tiers: topo.fabric.tiers,
      planes: topo.fabric.planes,
      switchModel: topo.fabric.switchSpec?.name ?? null,
      portSpeedGbps: topo.fabric.portSpeedGbps,
    },
  };
}
