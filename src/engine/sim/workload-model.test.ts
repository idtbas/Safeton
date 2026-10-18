import { describe, expect, it } from 'vitest';
import { resolveNodeConfig } from '../model/resolve';
import { buildTemplate } from '../model/templates';
import { expandTopology } from '../model/topology';
import type { TrainingJobSpec, TrainingPlan } from './types';
import { inferenceTick, planInference, planTraining, trainingStep } from './workload-model';

const h100 = expandTopology(buildTemplate('cluster-256'));
const cfg = h100.nodes[0]!.cfg;
const base: TrainingJobSpec = {
  kind: 'training',
  name: 't',
  modelId: 'llama-3.1-70b',
  gpus: 256,
  precision: 'bf16',
  seqLen: 8192,
  globalBatch: 512,
  totalTokens: 1e12,
  checkpointIntervalMin: 30,
};

function plan(spec: Partial<TrainingJobSpec> = {}): TrainingPlan {
  const r = planTraining({ ...base, ...spec }, cfg, 400);
  if (!r.ok) throw new Error(r.message);
  return r.plan;
}

describe('training planner', () => {
  it('lands dense 70B training on H100 in the realistic MFU band', () => {
    const p = plan();
    expect(p.tp * p.pp * p.dp).toBe(256);
    expect(p.nominalMfu).toBeGreaterThan(0.38);
    expect(p.nominalMfu).toBeLessThan(0.55);
    expect(p.memoryGB.total).toBeLessThan(80 * 0.97);
  });

  it('computes FLOPs from 6N plus attention', () => {
    const p = plan();
    expect(p.modelFlopsPerToken).toBeCloseTo(6 * 70.6e9 + 12 * 80 * 8192 * 8192, -6);
    expect(p.tokensPerStep).toBe(512 * 8192);
  });

  it('honours explicit parallelism and reports invalid decompositions', () => {
    expect(plan({ tp: 8, pp: 4 }).dp).toBe(8);
    const r = planTraining({ ...base, tp: 8, pp: 4, globalBatch: 12 }, cfg, 400);
    expect(r.ok).toBe(false);
  });

  it('rejects FP8 on GPUs without FP8 tensor cores and whole-node violations', () => {
    const a100 = resolveNodeConfig({
      rackId: 'rack-42u-600',
      cooling: 'air',
      system: { kind: 'platform', platformId: 'hgx-a100-8gpu', nodesPerRack: 4 },
      pdu: { pduId: 'pdu-3ph-415v-60a', perFeed: 1, feeds: 2 },
    });
    const r = planTraining({ ...base, precision: 'fp8' }, a100, 200);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('JOB_PRECISION_UNSUPPORTED');
    const g = planTraining({ ...base, gpus: 100 }, cfg, 400);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.code).toBe('JOB_GPU_GRANULARITY');
  });

  it('becomes communication-bound when the fabric is throttled', () => {
    const p = plan({ tp: 8, pp: 1 });
    const fast = trainingStep(p, cfg, 'bf16', 400, {
      clock: 1,
      congestion: 1,
      nicAvailability: 1,
      domainSharing: 1,
    });
    const slow = trainingStep(p, cfg, 'bf16', 400, {
      clock: 1,
      congestion: 8,
      nicAvailability: 0.5,
      domainSharing: 1,
    });
    expect(slow.stepS).toBeGreaterThan(fast.stepS);
    expect(slow.commExposedFraction).toBeGreaterThan(fast.commExposedFraction);
  });

  it('runs at the speed of the slowest GPU', () => {
    const p = plan();
    const full = trainingStep(p, cfg, 'bf16', 400, {
      clock: 1,
      congestion: 1,
      nicAvailability: 1,
      domainSharing: 1,
    });
    const straggler = trainingStep(p, cfg, 'bf16', 400, {
      clock: 0.7,
      congestion: 1,
      nicAvailability: 1,
      domainSharing: 1,
    });
    expect(straggler.computeS / full.computeS).toBeCloseTo(1 / 0.7, 6);
  });

  it('uses NVLink for data-parallel reduction inside large scale-up domains (NVL72)', () => {
    const nvl = expandTopology(buildTemplate('supercomputer-nvl72')).nodes[0]!.cfg;
    const r = planTraining({ ...base, gpus: 288, globalBatch: 576, tp: 4, pp: 1 }, nvl, 400);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const shared = trainingStep(r.plan, nvl, 'bf16', 400, {
      clock: 1,
      congestion: 1,
      nicAvailability: 1,
      domainSharing: 18,
    });
    const flat = trainingStep(r.plan, nvl, 'bf16', 400, {
      clock: 1,
      congestion: 1,
      nicAvailability: 1,
      domainSharing: 1,
    });
    expect(shared.nicBytesPerGpu).toBeLessThan(flat.nicBytesPerGpu / 10);
  });

  it('advises when the global batch is too small for the scale', () => {
    const big = expandTopology(buildTemplate('hyperscale-32k')).nodes[0]!.cfg;
    const r = planTraining({ ...base, gpus: 16384 }, big, 800);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.notes.join(' ')).toMatch(/Pipeline bubble|Low efficiency/);
  });
});

describe('inference model', () => {
  const spec = {
    kind: 'inference' as const,
    name: 'i',
    modelId: 'llama-3.1-70b',
    replicas: 2,
    tp: 4,
    precision: 'fp8' as const,
    requestRate: 4,
    avgInputTokens: 1000,
    avgOutputTokens: 300,
  };

  it('derives weights and KV cache per GPU from the architecture', () => {
    const r = planInference(spec, cfg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.weightsGBPerGpu).toBeCloseTo(70.6 / 4, 2);
    // 2 · 80 layers · 8 KV heads · 128 dims · 1 byte, split over 4 GPUs
    expect(r.plan.kvBytesPerTokenPerGpu).toBe((2 * 80 * 8 * 128) / 4);
    expect(r.plan.minDecodeStepS).toBeGreaterThan(0.005);
    expect(r.plan.minDecodeStepS).toBeLessThan(0.02);
  });

  it('rejects models that do not fit', () => {
    const r = planInference({ ...spec, modelId: 'llama-3.1-405b', tp: 2, precision: 'bf16' }, cfg);
    expect(r.ok).toBe(false);
  });

  it('meets demand below capacity and queues above it', () => {
    const r = planInference(spec, cfg);
    if (!r.ok) throw new Error();
    const light = inferenceTick(spec, r.plan, cfg, 2, 1, 0, 1);
    expect(light.servedRps).toBeCloseTo(4, 3);
    expect(light.queue).toBe(0);
    expect(light.tpotS).toBeLessThan(0.05);
    const heavy = inferenceTick({ ...spec, requestRate: 400 }, r.plan, cfg, 2, 1, 0, 1);
    expect(heavy.servedRps).toBeLessThan(400);
    expect(heavy.queue).toBeGreaterThan(0);
    const down = inferenceTick(spec, r.plan, cfg, 0, 1, 0, 1);
    expect(down.servedRps).toBe(0);
    expect(down.queue).toBe(4);
  });
});
