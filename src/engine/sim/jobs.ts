/**
 * Job lifecycle: submission, topology-aware gang scheduling, progression of training and
 * inference workloads, checkpointing, failure handling and restart from checkpoint.
 *
 * Workloads drive the hardware: this module writes per-GPU utilisation, switching activity
 * and memory, and per-node CPU / NIC / NVLink / storage activity, which the physics phase
 * turns into power and heat.
 */
import { model } from '../../catalog';
import type { ResolvedNodeConfig } from '../model/resolve';
import type { Simulation } from './simulation';
import {
  GpuHealth,
  NodeState,
  type CommandResult,
  type InferenceJobSpec,
  type InferencePlan,
  type Job,
  type JobMetrics,
  type JobSpec,
  type TrainingJobSpec,
  type TrainingPlan,
} from './types';
import {
  inferenceTick,
  planInference,
  planTraining,
  trainingStep,
  type StepBreakdown,
} from './workload-model';

const NCCL_INIT_BASE_S = 45;
const NCCL_INIT_PER_LOG2_S = 12;
/** Collective watchdog: time until a hung all-reduce is detected and the job torn down. */
const FAILURE_DETECTION_S: [number, number] = [60, 180];
/** Effective fraction of aggregate storage bandwidth a single job achieves. */
const STORAGE_EFFICIENCY = 0.6;
const ASYNC_CKPT_BLOCKING = 0.15;

export function emptyMetrics(): JobMetrics {
  return {
    stepTimeS: 0,
    tokensPerSec: 0,
    mfu: 0,
    tflopsPerGpu: 0,
    commExposedFraction: 0,
    congestion: 1,
    clockFactor: 1,
    servedRps: 0,
    queueDepth: 0,
    ttftS: 0,
    tpotS: 0,
    batchPerReplica: 0,
    sloAttainment: 0,
  };
}

const isTraining = (job: Job): job is Job & { spec: TrainingJobSpec; plan: TrainingPlan } =>
  job.spec.kind === 'training';
const isInference = (job: Job): job is Job & { spec: InferenceJobSpec; plan: InferencePlan } =>
  job.spec.kind === 'inference';

function jobGpus(job: Job): number {
  if (isTraining(job)) return job.spec.gpus;
  const plan = job.plan as InferencePlan;
  return plan.replicas * plan.tp;
}

// ---- Submission ---------------------------------------------------------------------------

export function submitJob(sim: Simulation, spec: JobSpec): CommandResult {
  const cfg = sim.primaryConfig();
  if (!cfg) return { ok: false, error: { code: 'NO_NODES', message: 'The cluster has no compute nodes' } };
  if (!spec.name || spec.name.length > 64) {
    return { ok: false, error: { code: 'JOB_NAME_INVALID', message: 'Job name must be 1–64 characters' } };
  }
  const result =
    spec.kind === 'training'
      ? planTraining(spec, cfg, sim.topo.fabric.portSpeedGbps)
      : planInference(spec, cfg);
  if (!result.ok) return { ok: false, error: { code: result.code, message: result.message } };
  const plan = result.plan;
  const total = sim.topo.nodes.length;
  if (plan.nodes > total) {
    return {
      ok: false,
      error: {
        code: 'JOB_EXCEEDS_CLUSTER',
        message: `Job needs ${plan.nodes} nodes, the cluster has ${total}`,
      },
    };
  }
  if (spec.kind === 'training' && plan.nodes > 1 && sim.topo.fabric.tiers === 0) {
    return {
      ok: false,
      error: {
        code: 'JOB_NO_FABRIC',
        message: 'Multi-node training requires a backend fabric; this site has none',
      },
    };
  }
  if (spec.kind === 'training') {
    if (spec.totalTokens <= 0)
      return { ok: false, error: { code: 'JOB_TOKENS_INVALID', message: 'Token target must be positive' } };
    if (spec.checkpointIntervalMin < 1) {
      return {
        ok: false,
        error: { code: 'JOB_CKPT_INVALID', message: 'Checkpoint interval must be at least 1 minute' },
      };
    }
  } else if (spec.requestRate < 0) {
    return { ok: false, error: { code: 'JOB_RATE_INVALID', message: 'Request rate must be ≥ 0' } };
  }
  const id = sim.nextJobId++;
  const job: Job = {
    id,
    name: spec.name,
    user: spec.user ?? 'admin',
    priority: spec.priority ?? 0,
    spec: structuredClone(spec),
    state: 'pending',
    reason: 'Queued',
    submittedAt: sim.time,
    startedAt: null,
    endedAt: null,
    nodes: [],
    plan,
    phaseRemainingS: 0,
    nodeInitS: [],
    requeued: false,
    ckptWriteRemainingS: 0,
    ckptWriteGBs: 0,
    step: 0,
    stepFraction: 0,
    lastCheckpointStep: 0,
    sinceCheckpointS: 0,
    tokensDone: 0,
    restarts: 0,
    lostSteps: 0,
    productiveS: 0,
    allocatedS: 0,
    requestsServed: 0,
    queue: 0,
    metrics: emptyMetrics(),
  };
  sim.jobs.set(id, job);
  const what =
    spec.kind === 'training'
      ? `${spec.modelId} training on ${spec.gpus} GPUs (TP${(plan as TrainingPlan).tp}·PP${(plan as TrainingPlan).pp}·DP${(plan as TrainingPlan).dp}, ${(plan as TrainingPlan).memoryGB.total.toFixed(1)} GB/GPU)`
      : `${spec.modelId} inference, ${spec.replicas} × TP${spec.tp} replicas`;
  sim.emit('info', 'job', String(id), 'JOB_SUBMITTED', `Job ${id} "${spec.name}" submitted: ${what}`);
  return { ok: true, message: `Submitted job ${id}`, data: { jobId: id, plan } };
}

export function cancelJob(sim: Simulation, jobId: number): CommandResult {
  const job = sim.jobs.get(jobId);
  if (!job) return { ok: false, error: { code: 'JOB_NOT_FOUND', message: `Job ${jobId} not found` } };
  if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') {
    return { ok: false, error: { code: 'JOB_FINISHED', message: `Job ${jobId} already ${job.state}` } };
  }
  releaseNodes(sim, job);
  job.state = 'cancelled';
  job.reason = 'Cancelled by operator';
  job.endedAt = sim.time;
  sim.congestion.delete(jobId);
  sim.emit(
    'notice',
    'job',
    String(jobId),
    'JOB_CANCELLED',
    `Job ${jobId} cancelled (scancel), resources released`,
  );
  return { ok: true, message: `Cancelled job ${jobId}` };
}

function releaseNodes(sim: Simulation, job: Job): void {
  for (const i of job.nodes) if (sim.rt.nodes.job[i] === job.id) sim.rt.nodes.job[i] = -1;
  job.nodes = [];
  job.nodeInitS = [];
}

// ---- Scheduling ---------------------------------------------------------------------------

function selectNodes(sim: Simulation, candidates: number[], need: number): number[] {
  const groups = new Map<number, number[]>();
  for (const i of candidates) {
    const g = sim.topo.nodes[i]!.leafGroup;
    const list = groups.get(g);
    if (list) list.push(i);
    else groups.set(g, [i]);
  }
  // Best fit: the smallest leaf group that holds the whole job keeps traffic below the leaf.
  let best: number[] | null = null;
  for (const list of groups.values()) {
    if (list.length >= need && (!best || list.length < best.length)) best = list;
  }
  if (best) return best.slice(0, need);
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  const out: number[] = [];
  for (const [, list] of ordered) {
    for (const i of list) {
      out.push(i);
      if (out.length === need) return out;
    }
  }
  return out;
}

function initTimeS(sim: Simulation, job: Job, nodes: number): number {
  if (isTraining(job)) {
    let t = NCCL_INIT_BASE_S + NCCL_INIT_PER_LOG2_S * Math.log2(Math.max(1, nodes));
    if (job.requeued && job.lastCheckpointStep > 0)
      t += job.plan.checkpointGB / storageBandwidthGBs(sim, nodes, 'read');
    return t;
  }
  const plan = job.plan as InferencePlan;
  const perNodeGB = plan.weightsGBPerGpu * plan.tp * plan.replicasPerNode;
  return 40 + perNodeGB / Math.max(0.5, storageBandwidthGBs(sim, 1, 'read')) + 20;
}

/** Bandwidth a job spanning `nodes` nodes can achieve to shared storage (GB/s). */
export function storageBandwidthGBs(sim: Simulation, nodes: number, dir: 'read' | 'write'): number {
  const cfg = sim.primaryConfig()!;
  const nodeBw = (cfg.storageNicCount * cfg.storageNic.ports * cfg.storageNic.portSpeedGbps) / 8;
  let shared = 0;
  for (const s of sim.topo.storage) shared += dir === 'read' ? s.spec.readGBs.v : s.spec.writeGBs.v;
  if (shared === 0) {
    // No shared storage: local NVMe of every node in parallel.
    const drive = dir === 'read' ? cfg.dataDrive.seqReadGBs.v : cfg.dataDrive.seqWriteGBs.v;
    return Math.max(0.1, nodes * cfg.dataDriveCount * drive * STORAGE_EFFICIENCY);
  }
  return Math.max(0.1, Math.min(shared, nodes * nodeBw) * STORAGE_EFFICIENCY);
}

export function scheduleJobs(sim: Simulation): void {
  const pending: Job[] = [];
  const replacements: Job[] = [];
  for (const job of sim.jobs.values()) {
    if (job.state === 'pending') pending.push(job);
    else if (isInference(job) && job.state === 'running' && job.nodes.length < job.plan.nodes)
      replacements.push(job);
  }
  if (pending.length === 0 && replacements.length === 0) return;
  pending.sort((a, b) => b.priority - a.priority || a.submittedAt - b.submittedAt || a.id - b.id);
  replacements.sort((a, b) => a.id - b.id);

  const freeFor = (training: boolean) => {
    const out: number[] = [];
    for (let i = 0; i < sim.topo.nodes.length; i++) if (sim.isSchedulable(i, training)) out.push(i);
    return out;
  };

  for (const job of replacements) {
    const free = freeFor(false);
    const need = job.plan.nodes - job.nodes.length;
    const pick = selectNodes(sim, free, Math.min(need, free.length));
    if (pick.length === 0) continue;
    const init = initTimeS(sim, job, 1);
    for (const i of pick) {
      sim.rt.nodes.job[i] = job.id;
      job.nodes.push(i);
      job.nodeInitS.push(init);
    }
    sim.emit(
      'info',
      'scheduler',
      String(job.id),
      'JOB_REPLICA_RESCHEDULED',
      `Job ${job.id}: ${pick.length} replacement node(s) allocated (${pick.map((i) => sim.topo.nodes[i]!.hostname).join(', ')})`,
    );
  }

  for (const job of pending) {
    const training = isTraining(job);
    const need = job.plan.nodes;
    const free = freeFor(training);
    if (free.length < need) {
      job.reason = `Resources: ${need} node${need > 1 ? 's' : ''} required, ${free.length} available`;
      break; // strict priority/FIFO order — no backfill past a blocked head job
    }
    const pick = selectNodes(sim, free, need);
    const groups = new Set(pick.map((i) => sim.topo.nodes[i]!.leafGroup)).size;
    for (const i of pick) sim.rt.nodes.job[i] = job.id;
    job.nodes = pick;
    job.state = 'initializing';
    job.reason = null;
    job.startedAt ??= sim.time;
    job.phaseRemainingS = initTimeS(sim, job, pick.length);
    job.nodeInitS = pick.map(() => 0);
    const first = sim.topo.nodes[pick[0]!]!.hostname;
    const last = sim.topo.nodes[pick[pick.length - 1]!]!.hostname;
    sim.emit(
      'info',
      'scheduler',
      String(job.id),
      'JOB_SCHEDULED',
      `Job ${job.id} allocated ${pick.length} node${pick.length > 1 ? 's' : ''} (${jobGpus(job)} GPUs) ${pick.length > 1 ? `${first}…${last}` : first}${sim.topo.fabric.tiers > 1 ? ` across ${groups} leaf group${groups > 1 ? 's' : ''}` : ''}`,
    );
  }
}

// ---- Failure handling ---------------------------------------------------------------------

/** Called when a node running `jobId` fails or is forcibly taken away. */
export function handleNodeLost(sim: Simulation, jobId: number, nodeIdx: number, reason: string): void {
  const job = sim.jobs.get(jobId);
  if (sim.rt.nodes.job[nodeIdx] === jobId) sim.rt.nodes.job[nodeIdx] = -1;
  if (!job) return;
  const pos = job.nodes.indexOf(nodeIdx);
  if (pos >= 0) {
    job.nodes.splice(pos, 1);
    job.nodeInitS.splice(pos, 1);
  }
  if (isInference(job)) {
    if (job.state === 'running' || job.state === 'initializing') {
      sim.emit(
        'warning',
        'job',
        String(jobId),
        'JOB_REPLICA_LOST',
        `Job ${jobId}: replicas on ${sim.topo.nodes[nodeIdx]!.hostname} lost — ${reason}`,
      );
    }
    return;
  }
  crashTrainingJob(sim, job, `${sim.topo.nodes[nodeIdx]!.hostname}: ${reason}`);
}

/** Training job hit a fatal error: hang until the watchdog fires, then requeue from checkpoint. */
export function crashTrainingJob(sim: Simulation, job: Job, reason: string): void {
  if (!isTraining(job)) return;
  if (job.state !== 'running' && job.state !== 'checkpointing' && job.state !== 'initializing') return;
  const lost = job.step - job.lastCheckpointStep;
  job.lostSteps += lost;
  job.productiveS = Math.max(
    0,
    job.productiveS -
      lost * (job.metrics.stepTimeS || job.plan.nominalStepS) -
      job.stepFraction * (job.metrics.stepTimeS || 0),
  );
  job.step = job.lastCheckpointStep;
  job.tokensDone = job.step * job.plan.tokensPerStep;
  job.stepFraction = 0;
  job.restarts++;
  job.state = 'restarting';
  job.ckptWriteRemainingS = 0;
  job.phaseRemainingS = sim.rng.range(FAILURE_DETECTION_S[0], FAILURE_DETECTION_S[1]);
  job.reason = reason;
  sim.emit(
    'error',
    'job',
    String(job.id),
    'JOB_FAILED_RANK',
    `Job ${job.id}: NCCL watchdog timeout — ${reason}. ${lost} step${lost === 1 ? '' : 's'} since checkpoint ${job.lastCheckpointStep} will be recomputed`,
  );
}

// ---- Progression --------------------------------------------------------------------------

function completeJob(sim: Simulation, job: Job): void {
  releaseNodes(sim, job);
  job.state = 'completed';
  job.endedAt = sim.time;
  job.reason = null;
  sim.congestion.delete(job.id);
  sim.emit(
    'notice',
    'job',
    String(job.id),
    'JOB_COMPLETED',
    `Job ${job.id} completed: ${(job.tokensDone / 1e9).toFixed(2)} B tokens, ${job.restarts} restart(s), goodput ${((100 * job.productiveS) / Math.max(1, job.allocatedS)).toFixed(1)} %`,
  );
}

interface GpuLoad {
  util: number;
  activity: number;
  memGB: number;
}

function applyNodeLoad(
  sim: Simulation,
  i: number,
  load: GpuLoad,
  gpuCount: number,
  node: { cpu: number; mem: number; storage: number; net: number; nvlink: number },
): void {
  const n = sim.rt.nodes;
  const g = sim.rt.gpus;
  const info = sim.topo.nodes[i]!;
  for (let k = 0; k < Math.min(gpuCount, info.cfg.gpuCount); k++) {
    const gi = info.gpuStart + k;
    if (g.health[gi]! >= GpuHealth.ResetRequired) continue;
    g.util[gi] = load.util;
    g.activity[gi] = load.activity;
    g.memUsedGB[gi] = load.memGB;
  }
  n.cpuUtil[i] = node.cpu;
  n.memActivity[i] = node.mem;
  n.storageActivity[i] = node.storage;
  n.netActivity[i] = node.net;
  n.nvlinkActivity[i] = node.nvlink;
}

function jobDynamics(sim: Simulation, job: Job, cfg: ResolvedNodeConfig) {
  let clock = 1;
  let nicAvail = 1;
  const domains = new Set<number>();
  for (const i of job.nodes) {
    const node = sim.topo.nodes[i]!;
    domains.add(node.nvlDomain);
    for (let k = 0; k < node.cfg.gpuCount; k++) {
      const c = sim.rt.gpus.clock[node.gpuStart + k]!;
      if (c > 0 && c < clock) clock = c;
    }
    const rails = node.cfg.rails;
    if (rails > 0) nicAvail = Math.min(nicAvail, (rails - sim.railsUnavailable(i)) / rails);
  }
  const plan = job.plan as TrainingPlan;
  const avgGpusPerDomain = (job.nodes.length * cfg.gpuCount) / Math.max(1, domains.size);
  const domainSharing = Math.max(1, Math.min(plan.dp, Math.floor(avgGpusPerDomain / (plan.tp * plan.pp))));
  return { clock, nicAvailability: Math.max(0.05, nicAvail), domainSharing };
}

export function advanceJobs(sim: Simulation): void {
  const n = sim.rt.nodes;
  const g = sim.rt.gpus;
  const dt = sim.dt;
  const topo = sim.topo;
  const mr = Math.max(1, topo.maxRails);

  // Reset to idle; running jobs overwrite below.
  for (let i = 0; i < topo.nodes.length; i++) {
    const node = topo.nodes[i]!;
    const powered = n.powered[i] === 1;
    for (let k = 0; k < node.cfg.gpuCount; k++) {
      const gi = node.gpuStart + k;
      g.util[gi] = 0;
      g.activity[gi] = 0;
      g.memUsedGB[gi] = powered && g.health[gi]! < GpuHealth.ResetRequired ? 0.6 : 0;
    }
    n.cpuUtil[i] = powered ? 0.02 : 0;
    n.memActivity[i] = 0.02;
    n.storageActivity[i] = 0;
    n.netActivity[i] = 0;
    n.nvlinkActivity[i] = 0;
    n.netGbps[i] = 0;
    n.storageGBs[i] = 0;
  }
  n.railGbps.fill(0);
  sim.netDemand.clear();

  const c = sim.cluster;
  c.trainingTokensPerSec = 0;
  c.inferenceTokensPerSec = 0;
  c.gpusAllocated = 0;
  c.storageReadGBs = 0;
  c.storageWriteGBs = 0;
  c.achievedFlops = 0;

  const cfg = sim.primaryConfig();
  if (!cfg) return;
  const linkGbps = topo.fabric.portSpeedGbps;
  const nicBytesPerS =
    (Math.min(cfg.computeNic.portSpeedGbps, linkGbps || cfg.computeNic.portSpeedGbps) / 8) * 1e9;
  const nvlBytesPerS = (cfg.gpu.interconnect.bandwidthGBs.v / 2) * 1e9;
  const checkpointing = [...sim.jobs.values()].filter(
    (j) => j.state === 'checkpointing' || j.ckptWriteRemainingS > 0,
  ).length;

  const ordered = [...sim.jobs.values()].sort((a, b) => a.id - b.id);
  for (const job of ordered) {
    if (
      job.state === 'pending' ||
      job.state === 'completed' ||
      job.state === 'failed' ||
      job.state === 'cancelled'
    )
      continue;
    job.allocatedS += dt;
    c.gpusAllocated += job.nodes.length * cfg.gpuCount;

    if (isTraining(job)) {
      const plan = job.plan;
      const memGB = plan.memoryGB.total;
      if (job.state === 'initializing') {
        job.phaseRemainingS -= dt;
        for (const i of job.nodes) {
          applyNodeLoad(sim, i, { util: 0.04, activity: 0.02, memGB: memGB * 0.35 }, cfg.gpuCount, {
            cpu: 0.35,
            mem: 0.3,
            storage: job.requeued ? 0.8 : 0.1,
            net: 0.02,
            nvlink: 0,
          });
        }
        if (job.requeued && job.lastCheckpointStep > 0)
          c.storageReadGBs += storageBandwidthGBs(sim, job.nodes.length, 'read');
        if (job.phaseRemainingS <= 0) {
          job.state = 'running';
          const resumed = job.requeued && job.lastCheckpointStep > 0;
          job.requeued = false;
          sim.emit(
            'info',
            'job',
            String(job.id),
            'JOB_RUNNING',
            `Job ${job.id}: NCCL initialised (${job.spec.gpus} ranks, TP${plan.tp}·PP${plan.pp}·DP${plan.dp})${resumed ? `, resumed from checkpoint step ${job.lastCheckpointStep}` : ', training started'}`,
          );
        }
        continue;
      }
      if (job.state === 'restarting') {
        job.phaseRemainingS -= dt;
        // Ranks spin in the hung collective: 100 % "utilisation", little power.
        for (const i of job.nodes)
          applyNodeLoad(sim, i, { util: 1, activity: 0.12, memGB }, cfg.gpuCount, {
            cpu: 0.05,
            mem: 0.05,
            storage: 0,
            net: 0,
            nvlink: 0,
          });
        if (job.phaseRemainingS <= 0) {
          releaseNodes(sim, job);
          job.state = 'pending';
          job.requeued = true;
          job.reason = `Requeued after failure (restart #${job.restarts}, from step ${job.lastCheckpointStep})`;
          sim.congestion.delete(job.id);
          sim.emit(
            'notice',
            'job',
            String(job.id),
            'JOB_REQUEUED',
            `Job ${job.id} torn down and requeued — will resume from checkpoint step ${job.lastCheckpointStep}`,
          );
        }
        continue;
      }

      const dyn = jobDynamics(sim, job, cfg);
      const congestion = sim.congestion.get(job.id) ?? 1;
      const sb: StepBreakdown = trainingStep(plan, cfg, job.spec.precision, linkGbps, { ...dyn, congestion });
      const demand = trainingStep(plan, cfg, job.spec.precision, linkGbps, { ...dyn, congestion: 1 });
      sim.netDemand.set(job.id, (demand.nicBytesPerGpu * 8) / demand.stepS / 1e9);

      const bgWrite = job.ckptWriteRemainingS > 0;
      if (bgWrite) {
        job.ckptWriteRemainingS = Math.max(0, job.ckptWriteRemainingS - dt);
        c.storageWriteGBs += job.ckptWriteGBs;
      }

      if (job.state === 'checkpointing') {
        job.phaseRemainingS -= dt;
        for (const i of job.nodes)
          applyNodeLoad(sim, i, { util: 0.12, activity: 0.06, memGB }, cfg.gpuCount, {
            cpu: 0.4,
            mem: 0.6,
            storage: 1,
            net: 0.05,
            nvlink: 0,
          });
        if (!bgWrite) c.storageWriteGBs += job.ckptWriteGBs;
        for (const i of job.nodes) n.storageGBs[i] = job.ckptWriteGBs / Math.max(1, job.nodes.length);
        if (job.phaseRemainingS <= 0) {
          job.state = 'running';
          job.lastCheckpointStep = job.step;
          job.sinceCheckpointS = 0;
          sim.emit(
            'info',
            'job',
            String(job.id),
            'JOB_CHECKPOINT_SAVED',
            `Job ${job.id}: checkpoint step ${job.step} saved (${plan.checkpointGB >= 1000 ? `${(plan.checkpointGB / 1000).toFixed(2)} TB` : `${plan.checkpointGB.toFixed(0)} GB`} at ${job.ckptWriteGBs.toFixed(1)} GB/s)`,
          );
        }
        continue;
      }

      // Running
      job.stepFraction += dt / sb.stepS;
      const whole = Math.floor(job.stepFraction);
      if (whole > 0) {
        job.stepFraction -= whole;
        job.step = Math.min(plan.totalSteps, job.step + whole);
        job.tokensDone = job.step * plan.tokensPerStep;
      }
      job.sinceCheckpointS += dt;
      job.productiveS += dt;
      const tokS = plan.tokensPerStep / sb.stepS;
      c.trainingTokensPerSec += tokS;
      c.achievedFlops += plan.modelFlopsPerStep / sb.stepS;
      job.metrics = {
        ...job.metrics,
        stepTimeS: sb.stepS,
        tokensPerSec: tokS,
        mfu: sb.mfu,
        tflopsPerGpu: plan.modelFlopsPerStep / sb.stepS / job.spec.gpus / 1e12,
        commExposedFraction: sb.commExposedFraction,
        congestion,
        clockFactor: dyn.clock,
      };
      const activity = 0.97 * (0.55 + 0.45 * sb.computeFraction);
      const nicGbpsPerGpu = (sb.nicBytesPerGpu * 8) / sb.stepS / 1e9;
      const netAct = Math.min(1, sb.nicBytesPerGpu / sb.stepS / nicBytesPerS);
      const nvlAct = Math.min(1, sb.nvlinkBytesPerGpu / sb.stepS / nvlBytesPerS);
      const readGBs = (plan.tokensPerStep * 4) / sb.stepS / 1e9;
      c.storageReadGBs += readGBs;
      for (const i of job.nodes) {
        applyNodeLoad(sim, i, { util: 0.97, activity, memGB: memGB * 0.98 }, cfg.gpuCount, {
          cpu: 0.18,
          mem: 0.35,
          storage: bgWrite ? 0.8 : 0.05,
          net: netAct,
          nvlink: nvlAct,
        });
        const node = topo.nodes[i]!;
        for (let k = 0; k < node.cfg.gpuCount; k++) {
          const rail = node.cfg.rails > 0 ? k % node.cfg.rails : 0;
          n.railGbps[i * mr + rail] = n.railGbps[i * mr + rail]! + nicGbpsPerGpu;
        }
        n.netGbps[i] = nicGbpsPerGpu * node.cfg.gpuCount;
        n.storageGBs[i] = readGBs / job.nodes.length + (bgWrite ? job.ckptWriteGBs / job.nodes.length : 0);
      }

      if (job.step >= plan.totalSteps) {
        completeJob(sim, job);
        continue;
      }
      if (job.sinceCheckpointS >= job.spec.checkpointIntervalMin * 60 && job.ckptWriteRemainingS <= 0) {
        const bw = storageBandwidthGBs(sim, job.nodes.length, 'write') / (checkpointing + 1);
        const full = plan.checkpointGB / bw;
        job.ckptWriteGBs = bw;
        if (job.spec.asyncCheckpoint) {
          job.phaseRemainingS = Math.max(3, full * ASYNC_CKPT_BLOCKING);
          job.ckptWriteRemainingS = full;
        } else {
          job.phaseRemainingS = full;
        }
        job.state = 'checkpointing';
      }
      continue;
    }

    if (isInference(job)) {
      const plan = job.plan;
      const spec = job.spec;
      let readyNodes = 0;
      let clock = 1;
      for (let p = 0; p < job.nodes.length; p++) {
        const i = job.nodes[p]!;
        if (job.state === 'running' && job.nodeInitS[p]! > 0) {
          job.nodeInitS[p] = Math.max(0, job.nodeInitS[p]! - dt);
          applyNodeLoad(
            sim,
            i,
            { util: 0.03, activity: 0.02, memGB: plan.weightsGBPerGpu * 0.5 },
            cfg.gpuCount,
            { cpu: 0.3, mem: 0.3, storage: 0.8, net: 0.01, nvlink: 0 },
          );
          continue;
        }
        const s = n.state[i];
        if (
          n.powered[i] &&
          (s === NodeState.Online || s === NodeState.Degraded || s === NodeState.Draining)
        ) {
          readyNodes++;
          const node = topo.nodes[i]!;
          for (let k = 0; k < node.cfg.gpuCount; k++) {
            const cl = g.clock[node.gpuStart + k]!;
            if (cl > 0 && cl < clock) clock = cl;
          }
        }
      }
      if (job.state === 'initializing') {
        job.phaseRemainingS -= dt;
        for (const i of job.nodes) {
          applyNodeLoad(
            sim,
            i,
            { util: 0.03, activity: 0.02, memGB: plan.weightsGBPerGpu * 0.5 },
            cfg.gpuCount,
            { cpu: 0.3, mem: 0.3, storage: 0.8, net: 0.01, nvlink: 0 },
          );
        }
        if (job.phaseRemainingS <= 0) {
          job.state = 'running';
          sim.emit(
            'info',
            'job',
            String(job.id),
            'JOB_RUNNING',
            `Job ${job.id}: inference endpoint ready — ${plan.replicas} replica(s) of ${spec.modelId}, TP${plan.tp}, ${spec.precision.toUpperCase()}`,
          );
        }
        continue;
      }
      const healthyReplicas = Math.min(plan.replicas, readyNodes * plan.replicasPerNode);
      const r = inferenceTick(spec, plan, cfg, healthyReplicas, clock, job.queue, dt);
      job.queue = r.queue;
      job.requestsServed += r.servedRps * dt;
      if (healthyReplicas > 0) job.productiveS += dt;
      c.inferenceTokensPerSec += r.tokensPerSec;
      const active = model(spec.modelId).activeParams.v;
      c.achievedFlops += 2 * active * (r.tokensPerSec + r.servedRps * spec.avgInputTokens);
      job.metrics = {
        ...job.metrics,
        tokensPerSec: r.tokensPerSec,
        servedRps: r.servedRps,
        queueDepth: r.queue,
        ttftS: Number.isFinite(r.ttftS) ? r.ttftS : 0,
        tpotS: r.tpotS,
        batchPerReplica: r.batch,
        sloAttainment: r.sloAttainment,
        clockFactor: clock,
        congestion: 1,
      };
      let replicasLeft = healthyReplicas;
      for (let p = 0; p < job.nodes.length; p++) {
        const i = job.nodes[p]!;
        if (job.nodeInitS[p]! > 0) continue;
        const onNode = Math.min(plan.replicasPerNode, replicasLeft);
        replicasLeft -= onNode;
        const gpusUsed = onNode * plan.tp;
        if (gpusUsed === 0) continue;
        applyNodeLoad(
          sim,
          i,
          { util: r.util, activity: r.util * r.intensity, memGB: r.memUsedGB },
          gpusUsed,
          {
            cpu: 0.12 + 0.2 * r.util,
            mem: 0.2,
            storage: 0.01,
            net: 0.02,
            nvlink: plan.tp > 1 ? 0.15 * r.util : 0,
          },
        );
        n.netGbps[i] =
          ((r.servedRps / Math.max(1, healthyReplicas)) *
            onNode *
            (spec.avgInputTokens + spec.avgOutputTokens) *
            4 *
            8) /
          1e9;
      }
    }
  }
}
