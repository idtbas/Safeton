/**
 * Analytical performance model for transformer training and inference.
 *
 * Training: 3D parallelism (tensor / pipeline / data) on top of the node's scale-up domain
 * (NVLink / Infinity Fabric) and the scale-out fabric. Step time is assembled from compute,
 * pipeline bubble and the exposed (non-overlapped) part of each communication pattern, so
 * MFU is an emergent result of hardware, topology and parallelism — not a configured number.
 *
 * Inference: memory-bandwidth-bound decode with continuous batching, compute-bound prefill,
 * KV-cache capacity limits and queueing under offered load.
 *
 * Formulas and assumptions: docs/SIMULATION-MODEL.md §5–6.
 */
import { model, type ModelArchSpec } from '../../catalog';
import type { ResolvedNodeConfig } from '../model/resolve';
import type { InferenceJobSpec, InferencePlan, Precision, TrainingJobSpec, TrainingPlan } from './types';

/**
 * End-to-end speed-up of FP8 training/inference (transformer-engine style: FP8 GEMMs, BF16
 * elsewhere) over BF16. Well below the 2× peak ratio because non-GEMM work does not speed up.
 */
export const FP8_SPEEDUP = 1.3;
/** Achievable NCCL bus bandwidth as a fraction of link rate. */
export const NVLINK_BUS_EFFICIENCY = 0.75;
export const NIC_BUS_EFFICIENCY = 0.85;
/** Fraction of TP communication not hidden behind compute. */
export const TP_EXPOSED = 0.6;
export const PP_EXPOSED = 0.3;
/** Fraction of the backward pass available to overlap bucketed gradient reduce-scatter. */
export const DP_OVERLAP = 0.8;
/** Per-doubling synchronisation / straggler overhead at scale. */
export const SYNC_OVERHEAD_PER_LOG2_NODE = 0.0035;
/** CUDA context, NCCL buffers, allocator reserve. */
export const RUNTIME_OVERHEAD_GB = 5;
export const FRAGMENTATION = 0.08;
export const HBM_USABLE = 0.97;
/** Checkpoint state per parameter: bf16 weights + fp32 master weights + Adam m, v. */
export const CHECKPOINT_BYTES_PER_PARAM = 14;

export type PlanResult<T> = { ok: true; plan: T } | { ok: false; code: string; message: string };

function peakTflops(cfg: ResolvedNodeConfig, precision: Precision): number {
  const bf16 = cfg.gpu.peak.bf16.dense.v;
  return precision === 'fp8' ? bf16 * FP8_SPEEDUP : bf16;
}

const nvlinkUniBytesPerS = (cfg: ResolvedNodeConfig) =>
  (cfg.gpu.interconnect.bandwidthGBs.v / 2) * 1e9 * NVLINK_BUS_EFFICIENCY;
const nicBytesPerS = (cfg: ResolvedNodeConfig, linkGbps: number) =>
  (Math.min(cfg.computeNic.portSpeedGbps, linkGbps || cfg.computeNic.portSpeedGbps) / 8) * 1e9 * NIC_BUS_EFFICIENCY;

interface TrainingCandidate {
  tp: number;
  pp: number;
  recompute: 'selective' | 'full';
}

function trainingMemory(m: ModelArchSpec, spec: TrainingJobSpec, c: TrainingCandidate, dp: number, micro: number) {
  const params = m.params.v;
  const paramsGpu = params / (c.tp * c.pp);
  const layersPerStage = Math.ceil(m.layers / c.pp);
  const sbh = spec.seqLen * m.hidden;
  const weights = paramsGpu * (spec.precision === 'fp8' ? 3 : 2);
  const grads = paramsGpu * 4;
  const optimizer = (paramsGpu * 12) / dp;
  const inflight = Math.min(c.pp, micro);
  const perLayer = c.recompute === 'full' ? 2 * sbh : 34 * sbh;
  let activations = (perLayer * layersPerStage * inflight) / c.tp;
  if (c.recompute === 'full') activations += (34 * sbh) / c.tp;
  const logits = (spec.seqLen * m.vocab * 4) / c.tp;
  activations += logits;
  const subtotal = weights + grads + optimizer + activations;
  const overhead = RUNTIME_OVERHEAD_GB * 1e9 + subtotal * FRAGMENTATION;
  const gb = (x: number) => x / 1e9;
  return {
    weights: gb(weights),
    grads: gb(grads),
    optimizer: gb(optimizer),
    activations: gb(activations),
    overhead: gb(overhead),
    total: gb(subtotal + overhead),
  };
}

export interface TrainingDynamics {
  /** Slowest GPU clock fraction across the job (synchronous training runs at straggler speed). */
  clock: number;
  /** Fabric congestion factor ≥ 1 (bandwidth divisor). */
  congestion: number;
  /** Lowest per-node NIC availability (healthy rails / rails). */
  nicAvailability: number;
  /** DP ranks sharing an NVLink domain (hierarchical collectives). */
  domainSharing: number;
}

export interface StepBreakdown {
  stepS: number;
  computeS: number;
  pipelineS: number;
  exposedTpS: number;
  exposedPpS: number;
  exposedDpS: number;
  commExposedFraction: number;
  computeFraction: number;
  /** Bytes per GPU per step crossing the scale-out NIC. */
  nicBytesPerGpu: number;
  nvlinkBytesPerGpu: number;
  mfu: number;
}

export function trainingStep(
  plan: TrainingPlan,
  cfg: ResolvedNodeConfig,
  precision: Precision,
  linkGbps: number,
  dyn: TrainingDynamics,
): StepBreakdown {
  const gpus = plan.tp * plan.pp * plan.dp;
  const peak = peakTflops(cfg, precision) * 1e12;
  const eff = cfg.gpu.kernelEfficiency.v * Math.max(0.05, dyn.clock);
  const computeS = plan.hardwareFlopsPerStep / (gpus * peak * eff);
  const pipelineS = computeS * plan.stageImbalance * (1 + plan.bubbleFraction);

  const nvl = nvlinkUniBytesPerS(cfg);
  const nic = (nicBytesPerS(cfg, linkGbps) * Math.max(0.05, dyn.nicAvailability)) / Math.max(1, dyn.congestion);

  const tpOverNvlink = plan.tp <= cfg.scaleUpDomainGpus;
  const exposedTpS = TP_EXPOSED * (plan.tpBytesPerGpu / (tpOverNvlink ? nvl : nic));
  const ppInDomain = plan.tp * plan.pp <= cfg.scaleUpDomainGpus;
  const exposedPpS = PP_EXPOSED * (plan.ppBytesPerGpu / (ppInDomain ? nvl : nic));

  const k = Math.max(1, Math.min(plan.dp, dyn.domainSharing));
  const dpNicBytes = plan.dpBytesPerGpu / k;
  const dpNvlBytes = plan.dpBytesPerGpu - dpNicBytes;
  const dpS = dpNicBytes / nic + dpNvlBytes / nvl;
  const exposedDpS = Math.max(0, dpS - DP_OVERLAP * (2 / 3) * pipelineS);

  const sync = 1 + SYNC_OVERHEAD_PER_LOG2_NODE * Math.log2(Math.max(1, plan.nodes));
  const stepS = (pipelineS + exposedTpS + exposedPpS + exposedDpS) * sync + 0.015 * computeS;
  // MFU is reported against the dense peak of the training precision.
  const precisionPeak =
    (precision === 'fp8' && cfg.gpu.peak.fp8 ? cfg.gpu.peak.fp8.dense.v : cfg.gpu.peak.bf16.dense.v) * 1e12;
  return {
    stepS,
    computeS,
    pipelineS,
    exposedTpS,
    exposedPpS,
    exposedDpS,
    commExposedFraction: (exposedTpS + exposedPpS + exposedDpS) / stepS,
    computeFraction: computeS / stepS,
    nicBytesPerGpu: dpNicBytes + (ppInDomain ? 0 : plan.ppBytesPerGpu) + (tpOverNvlink ? 0 : plan.tpBytesPerGpu),
    nvlinkBytesPerGpu: (tpOverNvlink ? plan.tpBytesPerGpu : 0) + dpNvlBytes + (ppInDomain ? plan.ppBytesPerGpu : 0),
    mfu: plan.modelFlopsPerStep / (stepS * gpus * precisionPeak),
  };
}

function buildTrainingPlan(
  m: ModelArchSpec,
  spec: TrainingJobSpec,
  cfg: ResolvedNodeConfig,
  c: TrainingCandidate,
  linkGbps: number,
): TrainingPlan | null {
  const dp = spec.gpus / (c.tp * c.pp);
  if (!Number.isInteger(dp) || dp < 1) return null;
  if (spec.globalBatch % dp !== 0) return null;
  const micro = spec.globalBatch / dp;
  const layersPerStage = Math.ceil(m.layers / c.pp);
  const interleave = c.pp > 1 && layersPerStage % 2 === 0 ? 2 : 1;
  const bubbleFraction = c.pp > 1 ? (c.pp - 1) / (interleave * micro) : 0;
  // The slowest pipeline stage sets the pace: layers are split in whole units and the last
  // stage also carries the LM head (≈ vocab / (12·h) transformer layers of compute).
  const headLayers = m.vocab / (12 * m.hidden);
  const stageImbalance = c.pp > 1 ? (layersPerStage + headLayers) / ((m.layers + headLayers) / c.pp) : 1;

  const s = spec.seqLen;
  const h = m.hidden;
  const modelFlopsPerToken = 6 * m.activeParams.v + 12 * m.layers * h * s;
  const tokensPerStep = spec.globalBatch * s;
  const modelFlopsPerStep = tokensPerStep * modelFlopsPerToken;
  const hardwareFlopsPerStep = modelFlopsPerStep * (c.recompute === 'full' ? 4 / 3 : 1.03);

  const memory = trainingMemory(m, spec, c, dp, micro);
  const hbmGB = cfg.gpu.memory.capacityGB.v;
  if (memory.total > hbmGB * HBM_USABLE) return null;

  const actBytes = s * h * 2;
  const recomputeFactor = c.recompute === 'full' ? 1.5 : 1;
  const tpBytesPerGpu =
    c.tp > 1 ? 4 * layersPerStage * micro * ((2 * (c.tp - 1)) / c.tp) * actBytes * recomputeFactor : 0;
  const ppBytesPerGpu = c.pp > 1 ? (2 * micro * actBytes * interleave) / c.tp : 0;
  const paramsGpu = m.params.v / (c.tp * c.pp);
  const dpBytesPerGpu = dp > 1 ? ((2 * (dp - 1)) / dp) * paramsGpu * 2 : 0;
  const nodes = spec.gpus / cfg.gpuCount;

  const plan: TrainingPlan = {
    tp: c.tp,
    pp: c.pp,
    dp,
    interleave,
    microbatches: micro,
    recompute: c.recompute,
    bubbleFraction,
    stageImbalance,
    modelFlopsPerToken,
    hardwareFlopsPerStep,
    modelFlopsPerStep,
    tokensPerStep,
    totalSteps: Math.max(1, Math.ceil(spec.totalTokens / tokensPerStep)),
    memoryGB: memory,
    hbmGB,
    checkpointGB: (m.params.v * CHECKPOINT_BYTES_PER_PARAM) / 1e9,
    tpBytesPerGpu,
    ppBytesPerGpu,
    dpBytesPerGpu,
    nodes,
    nominalStepS: 0,
    nominalMfu: 0,
  };
  const step = trainingStep(plan, cfg, spec.precision, linkGbps, {
    clock: 1,
    congestion: 1,
    nicAvailability: 1,
    domainSharing: domainSharing(plan, cfg),
  });
  plan.nominalStepS = step.stepS;
  plan.nominalMfu = step.mfu;
  return plan;
}

/** DP ranks that can reduce over the scale-up domain before touching the NIC. */
export function domainSharing(plan: Pick<TrainingPlan, 'tp' | 'pp' | 'dp'>, cfg: ResolvedNodeConfig): number {
  return Math.max(1, Math.min(plan.dp, Math.floor(cfg.scaleUpDomainGpus / (plan.tp * plan.pp))));
}

const POW2 = [1, 2, 4, 8, 16, 32, 64];

export function planTraining(spec: TrainingJobSpec, cfg: ResolvedNodeConfig, linkGbps: number): PlanResult<TrainingPlan> {
  let m: ModelArchSpec;
  try {
    m = model(spec.modelId);
  } catch {
    return { ok: false, code: 'JOB_UNKNOWN_MODEL', message: `Unknown model "${spec.modelId}"` };
  }
  if (!Number.isInteger(spec.gpus) || spec.gpus < 1 || spec.gpus % cfg.gpuCount !== 0) {
    return {
      ok: false,
      code: 'JOB_GPU_GRANULARITY',
      message: `Training jobs allocate whole nodes: GPU count must be a multiple of ${cfg.gpuCount} (got ${spec.gpus})`,
    };
  }
  if (spec.precision === 'fp8' && !cfg.gpu.peak.fp8) {
    return { ok: false, code: 'JOB_PRECISION_UNSUPPORTED', message: `${cfg.gpu.name} has no FP8 tensor cores` };
  }
  if (spec.seqLen < 128 || spec.seqLen > m.maxContext) {
    return { ok: false, code: 'JOB_SEQLEN_RANGE', message: `Sequence length must be 128–${m.maxContext} for ${m.name}` };
  }
  if (!Number.isInteger(spec.globalBatch) || spec.globalBatch < 1) {
    return { ok: false, code: 'JOB_BATCH_INVALID', message: 'Global batch must be a positive integer' };
  }

  const maxTp = Math.min(8, cfg.gpuCount, cfg.scaleUpDomainGpus, m.heads);
  const tps = spec.tp ? [spec.tp] : POW2.filter((x) => x <= maxTp);
  const pps = spec.pp ? [spec.pp] : POW2.filter((x) => x <= m.layers);
  const recomputes: ('selective' | 'full')[] =
    spec.recompute && spec.recompute !== 'auto' ? [spec.recompute] : ['selective', 'full'];

  if (spec.tp && (spec.tp > cfg.gpuCount || m.heads % spec.tp !== 0)) {
    return {
      ok: false,
      code: 'JOB_TP_INVALID',
      message: `Tensor parallel degree ${spec.tp} must divide the ${m.heads} attention heads and fit in one node (${cfg.gpuCount} GPUs)`,
    };
  }

  let best: TrainingPlan | null = null;
  let smallestMemory = Infinity;
  for (const tp of tps) {
    for (const pp of pps) {
      for (const recompute of recomputes) {
        const c = { tp, pp, recompute };
        const dp = spec.gpus / (tp * pp);
        if (Number.isInteger(dp) && dp >= 1 && spec.globalBatch % dp === 0) {
          const mem = trainingMemory(m, spec, c, dp, spec.globalBatch / dp).total;
          smallestMemory = Math.min(smallestMemory, mem);
        }
        const plan = buildTrainingPlan(m, spec, cfg, c, linkGbps);
        if (plan && (!best || plan.nominalStepS < best.nominalStepS)) best = plan;
      }
    }
  }
  if (!best) {
    if (smallestMemory === Infinity) {
      return {
        ok: false,
        code: 'JOB_PARALLELISM_INVALID',
        message: `No valid TP×PP×DP decomposition of ${spec.gpus} GPUs divides the global batch of ${spec.globalBatch}`,
      };
    }
    return {
      ok: false,
      code: 'JOB_OUT_OF_MEMORY',
      message: `CUDA out of memory: best layout needs ${smallestMemory.toFixed(1)} GB per GPU, ${cfg.gpu.name} has ${cfg.gpu.memory.capacityGB.v} GB. Add GPUs, reduce sequence length or enable full recompute`,
    };
  }
  return { ok: true, plan: best };
}

// ---- Inference ---------------------------------------------------------------------------

/** Fraction of tensor peak reached by prefill (attention + GEMM mix). */
export const PREFILL_EFFICIENCY = 0.55;
/** Fraction of tensor peak reachable by large-batch decode GEMMs. */
export const DECODE_COMPUTE_EFFICIENCY = 0.4;
export const DECODE_FRAMEWORK_OVERHEAD_S = 0.0025;
export const MAX_BATCH = 512;
export const INFERENCE_OVERHEAD_GB = 6;

export interface DecodeModel {
  /** Fixed part of a decode step (weights streaming + overheads), s. */
  a: number;
  /** Per-sequence KV streaming cost, s. */
  b: number;
  /** Per-sequence compute cost (compute-bound limit), s. */
  c: number;
}

export function decodeModel(plan: InferencePlan, cfg: ResolvedNodeConfig, spec: InferenceJobSpec): DecodeModel {
  const m = model(spec.modelId);
  const bw = cfg.gpu.memory.bandwidthGBs.v * 1e9 * cfg.gpu.hbmEfficiency.v;
  const ctx = spec.avgInputTokens + spec.avgOutputTokens / 2;
  const tpLatency = plan.tp > 1 ? 2 * m.layers * 6e-6 : 0;
  const peak = peakTflops(cfg, spec.precision === 'fp8' ? 'fp8' : 'bf16') * 1e12;
  return {
    a: (plan.weightsGBPerGpu * 1e9) / bw + tpLatency + DECODE_FRAMEWORK_OVERHEAD_S,
    b: (ctx * plan.kvBytesPerTokenPerGpu) / bw,
    c: (2 * m.activeParams.v) / (plan.tp * peak * DECODE_COMPUTE_EFFICIENCY),
  };
}

export function decodeStepS(d: DecodeModel, batch: number): number {
  return Math.max(d.a + d.b * batch, d.c * batch);
}

export function planInference(spec: InferenceJobSpec, cfg: ResolvedNodeConfig): PlanResult<InferencePlan> {
  let m: ModelArchSpec;
  try {
    m = model(spec.modelId);
  } catch {
    return { ok: false, code: 'JOB_UNKNOWN_MODEL', message: `Unknown model "${spec.modelId}"` };
  }
  if (!Number.isInteger(spec.tp) || spec.tp < 1 || spec.tp > cfg.gpuCount || cfg.gpuCount % spec.tp !== 0) {
    return {
      ok: false,
      code: 'JOB_TP_INVALID',
      message: `Tensor parallel degree must divide the ${cfg.gpuCount} GPUs of a node (got ${spec.tp})`,
    };
  }
  if (!Number.isInteger(spec.replicas) || spec.replicas < 1) {
    return { ok: false, code: 'JOB_REPLICAS_INVALID', message: 'Replica count must be a positive integer' };
  }
  if (spec.precision === 'fp8' && !cfg.gpu.peak.fp8) {
    return { ok: false, code: 'JOB_PRECISION_UNSUPPORTED', message: `${cfg.gpu.name} has no FP8 tensor cores` };
  }
  if (spec.avgInputTokens + spec.avgOutputTokens > m.maxContext) {
    return { ok: false, code: 'JOB_CONTEXT_RANGE', message: `Input + output tokens exceed the ${m.maxContext}-token context of ${m.name}` };
  }
  const bytesPerParam = spec.precision === 'fp8' ? 1 : 2;
  const weightsGBPerGpu = (m.params.v * bytesPerParam) / spec.tp / 1e9;
  const headDim = m.hidden / m.heads;
  const kvPerToken = 2 * m.layers * m.kvHeads * headDim * bytesPerParam;
  const kvBytesPerTokenPerGpu = kvPerToken / Math.min(spec.tp, m.kvHeads);
  const hbmGB = cfg.gpu.memory.capacityGB.v;
  const kvAvailGB = hbmGB * 0.92 - weightsGBPerGpu - INFERENCE_OVERHEAD_GB;
  const seqTokens = spec.avgInputTokens + spec.avgOutputTokens;
  if (kvAvailGB <= (seqTokens * kvBytesPerTokenPerGpu) / 1e9) {
    return {
      ok: false,
      code: 'JOB_OUT_OF_MEMORY',
      message: `Model weights need ${weightsGBPerGpu.toFixed(1)} GB per GPU at TP=${spec.tp}; no room for KV cache on ${hbmGB} GB HBM. Increase TP or use FP8`,
    };
  }
  const kvCapacityTokensPerReplica = Math.floor((kvAvailGB * 1e9) / kvBytesPerTokenPerGpu);
  const maxConcurrentPerReplica = Math.min(MAX_BATCH, Math.floor(kvCapacityTokensPerReplica / seqTokens));
  const replicasPerNode = cfg.gpuCount / spec.tp;
  const peak = peakTflops(cfg, spec.precision) * 1e12;
  const prefillSecondsPerRequest = (2 * m.activeParams.v * spec.avgInputTokens) / (spec.tp * peak * PREFILL_EFFICIENCY);
  const plan: InferencePlan = {
    tp: spec.tp,
    replicas: spec.replicas,
    nodes: Math.ceil(spec.replicas / replicasPerNode),
    replicasPerNode,
    weightsGBPerGpu,
    kvBytesPerTokenPerGpu,
    kvCapacityTokensPerReplica,
    maxConcurrentPerReplica,
    prefillSecondsPerRequest,
    minDecodeStepS: 0,
    maxThroughputTokS: 0,
  };
  const d = decodeModel(plan, cfg, spec);
  plan.minDecodeStepS = decodeStepS(d, 1);
  plan.maxThroughputTokS = (maxConcurrentPerReplica / decodeStepS(d, maxConcurrentPerReplica)) * spec.replicas;
  return { ok: true, plan };
}

export interface InferenceTickResult {
  servedRps: number;
  queue: number;
  batch: number;
  tokensPerSec: number;
  ttftS: number;
  tpotS: number;
  prefillBusy: number;
  sloAttainment: number;
  /** Per-GPU utilisation / power intensity / memory for the serving GPUs. */
  util: number;
  intensity: number;
  memUsedGB: number;
}

/**
 * Advances one inference job by dt seconds.
 * @param healthyReplicas replicas whose GPUs are usable
 * @param clock slowest clock fraction among serving GPUs
 */
export function inferenceTick(
  spec: InferenceJobSpec,
  plan: InferencePlan,
  cfg: ResolvedNodeConfig,
  healthyReplicas: number,
  clock: number,
  queue: number,
  dt: number,
): InferenceTickResult {
  const d = decodeModel(plan, cfg, spec);
  const out = spec.avgOutputTokens;
  if (healthyReplicas <= 0) {
    const q = queue + spec.requestRate * dt;
    return {
      servedRps: 0,
      queue: q,
      batch: 0,
      tokensPerSec: 0,
      ttftS: Infinity,
      tpotS: 0,
      prefillBusy: 0,
      sloAttainment: 0,
      util: 0,
      intensity: 0,
      memUsedGB: 0,
    };
  }
  const cl = Math.max(0.05, clock);
  const lambda = spec.requestRate / healthyReplicas;
  const qPerReplica = queue / healthyReplicas;
  const prefillS = plan.prefillSecondsPerRequest / cl;
  const maxB = plan.maxConcurrentPerReplica;
  // Prefill steals time from decode (chunked prefill / mixed batches).
  const prefillDemand = lambda * prefillS;
  const decodeShareMin = 0.05;
  const capacityAt = (b: number) => b / (decodeStepS(d, b) / cl);
  // Capacity in requests/s accounting for prefill time per request.
  const fullDecodeTokS = capacityAt(maxB);
  const capacityRps = 1 / (prefillS + out / fullDecodeTokS);
  const wanted = lambda + qPerReplica / 30;
  const served = Math.min(capacityRps, wanted);
  const prefillBusy = Math.min(1 - decodeShareMin, served * prefillS);
  const f = 1 - prefillBusy;
  const tokS = served * out;
  // Solve B / t(B) · f · cl = tokS in the memory-bound region: B = D·a / (f·cl − D·b)
  let batch: number;
  const D = tokS;
  const denom = f * cl - D * d.b;
  if (D <= 0) batch = 0;
  else if (denom <= 0) batch = maxB;
  else batch = Math.min(maxB, (D * d.a) / denom);
  if (batch > 0 && d.c * batch > d.a + d.b * batch) {
    // Compute-bound region: t = c·B → throughput is f·cl/c regardless of B.
    batch = Math.min(maxB, Math.max(batch, (D * d.c) / Math.max(1e-9, f * cl)));
  }
  const tpotS = batch > 0 ? decodeStepS(d, Math.max(1, batch)) / cl / f : decodeStepS(d, 1) / cl;
  const newQ = Math.max(0, qPerReplica + (lambda - served) * dt);
  const wait = newQ / Math.max(served, 1e-6);
  const ttftS = prefillS / Math.max(0.05, 1 - Math.min(0.95, prefillDemand)) + wait + 0.04;
  const sloAttainment =
    Math.max(0, Math.min(1, 1 - Math.max(0, ttftS / 2 - 1))) * (tpotS <= 0.1 ? 1 : 0.1 / tpotS);
  const busy = batch > 0 || prefillBusy > 0;
  const util = busy ? Math.min(0.98, 0.35 + 0.6 * Math.min(1, batch / 16) + prefillBusy) : 0;
  const intensity = 0.9 * prefillBusy + (0.42 + 0.33 * Math.sqrt(Math.min(1, batch / Math.max(1, maxB)))) * f;
  const ctx = spec.avgInputTokens + out / 2;
  const memUsedGB = plan.weightsGBPerGpu + (batch * ctx * plan.kvBytesPerTokenPerGpu) / 1e9 + INFERENCE_OVERHEAD_GB;
  return {
    servedRps: served * healthyReplicas,
    queue: newQ * healthyReplicas,
    batch,
    tokensPerSec: tokS * healthyReplicas,
    ttftS,
    tpotS,
    prefillBusy,
    sloAttainment,
    util,
    intensity: Math.min(1, intensity),
    memUsedGB,
  };
}
