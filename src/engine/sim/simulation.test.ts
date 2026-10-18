import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../model/templates';
import { Simulation } from './simulation';
import { GpuHealth, NodeState, type Command, type TrainingJobSpec } from './types';

const TRAIN_70B: TrainingJobSpec = {
  kind: 'training',
  name: 'llama70b',
  modelId: 'llama-3.1-70b',
  gpus: 256,
  precision: 'bf16',
  seqLen: 8192,
  globalBatch: 512,
  totalTokens: 1e12,
  checkpointIntervalMin: 10,
};

function cluster(seed = 1, failureRateMultiplier = 0) {
  return new Simulation(buildTemplate('cluster-256'), { seed, failureRateMultiplier });
}

function ok(sim: Simulation, cmd: Command) {
  const r = sim.execute(cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${r.error.message}`);
  return r;
}

describe('determinism', () => {
  const script = (sim: Simulation, splitAt?: number): Simulation => {
    let s = sim;
    ok(s, { type: 'job.submit', job: TRAIN_70B });
    for (let t = 0; t < 1500; t++) {
      if (t === splitAt) s = Simulation.restore(structuredClone(s.serialize()));
      if (t === 400) s.execute({ type: 'fault.inject', target: { kind: 'node-crash', node: 3 } });
      if (t === 800) s.execute({ type: 'node.drain', nodes: [7] });
      s.step(1);
    }
    return s;
  };

  it('reproduces identical state for the same seed and command sequence', () => {
    const a = script(cluster(42, 300));
    const b = script(cluster(42, 300));
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.events.lastSeq).toBe(b.events.lastSeq);
  });

  it('diverges for a different seed when randomness is involved', () => {
    expect(script(cluster(42, 300)).stateHash()).not.toBe(script(cluster(43, 300)).stateHash());
  });

  it('continues identically after serialize → restore mid-run', () => {
    const straight = script(cluster(7, 300));
    const resumed = script(cluster(7, 300), 650);
    expect(resumed.stateHash()).toBe(straight.stateHash());
  });

  it('rejects state from a different topology', () => {
    const blob = cluster().serialize();
    blob.fingerprint = 'tampered';
    expect(() => Simulation.restore(blob)).toThrow(/fingerprint/);
  });
});

describe('causal chain: workload → power → heat → cooling', () => {
  it('raises utilisation, power, temperature, memory and fabric traffic when training starts', () => {
    const sim = cluster();
    sim.step(120);
    const idle = sim.snapshot();
    ok(sim, { type: 'job.submit', job: TRAIN_70B });
    sim.step(900);
    const busy = sim.snapshot();
    expect(busy.jobs[0]!.state).toBe('running');
    expect(busy.cluster.gpuUtilAvg).toBeGreaterThan(0.9);
    expect(busy.cluster.gpuPowerW).toBeGreaterThan(idle.cluster.gpuPowerW * 5);
    expect(busy.facility.itPowerW).toBeGreaterThan(idle.facility.itPowerW * 3);
    expect(busy.cluster.gpuTempAvg).toBeGreaterThan(idle.cluster.gpuTempAvg + 25);
    expect(busy.cluster.hbmUsedGB).toBeGreaterThan(256 * 50);
    expect(busy.cluster.fabricTrafficGbps).toBeGreaterThan(1000);
    expect(busy.facility.coolingPowerW).toBeGreaterThan(idle.facility.coolingPowerW);
    // Per-node draw under training is in the realistic 7–10 kW band for HGX H100.
    const perNode = busy.nodes.powerW.reduce((s, v) => s + v, 0) / 32;
    expect(perNode).toBeGreaterThan(7000);
    expect(perNode).toBeLessThan(10_200);
  });

  it('keeps node energy balance: wall power = DC power / PSU efficiency, rack = Σ nodes + aux', () => {
    const sim = cluster();
    ok(sim, { type: 'job.submit', job: TRAIN_70B });
    sim.step(600);
    const { nodes, racks } = sim.rt;
    for (let i = 0; i < 32; i++) {
      expect(nodes.wallW[i]!).toBeGreaterThan(nodes.dcW[i]!);
      expect(nodes.dcW[i]! / nodes.wallW[i]!).toBeGreaterThan(0.9);
      expect(nodes.dcW[i]!).toBeGreaterThan(nodes.gpuW[i]!);
    }
    let itW = 0;
    for (const rack of sim.topo.racks) {
      let sum = 0;
      for (let k = 0; k < rack.nodeCount; k++) sum += nodes.wallW[rack.nodeStart + k]!;
      expect(racks.powerW[rack.idx]!).toBeGreaterThanOrEqual(sum * (1 - 1e-6)); // Float32 storage
      itW += racks.powerW[rack.idx]!;
    }
    expect(Math.abs(sim.itW - itW) / itW).toBeLessThan(1e-6);
    expect(sim.facility.facilityW).toBeGreaterThan(sim.itW);
  });

  it('throttles GPUs and slows the job when the chiller plant fails', () => {
    const sim = cluster();
    ok(sim, { type: 'job.submit', job: TRAIN_70B });
    sim.step(900);
    const before = sim.snapshot();
    const beforeJob = before.jobs[0]!.metrics;
    for (let k = 0; k < sim.topo.spec.site.plant.chillers; k++)
      ok(sim, { type: 'fault.inject', target: { kind: 'chiller' } });
    sim.step(2400);
    const snap = sim.snapshot();
    expect(snap.facility.chilledWaterSupplyC).toBeGreaterThan(before.facility.chilledWaterSupplyC + 10);
    expect(snap.halls[0]!.supplyAirC).toBeGreaterThan(before.halls[0]!.supplyAirC + 8);
    expect(snap.cluster.gpuTempMax).toBeGreaterThan(before.cluster.gpuTempMax + 5);
    const after = snap.jobs[0]!;
    // Either thermally throttled (slower steps) or tripped (job restarting / requeued).
    if (after.state === 'running') {
      expect(snap.cluster.throttledGpus).toBeGreaterThan(0);
      expect(after.metrics.clockFactor).toBeLessThan(beforeJob.clockFactor);
      expect(after.metrics.stepTimeS).toBeGreaterThan(beforeJob.stepTimeS);
    } else {
      expect(['restarting', 'pending', 'initializing']).toContain(after.state);
    }
  });

  it('caps GPU power with a power limit and reduces throughput accordingly', () => {
    const sim = cluster();
    ok(sim, { type: 'job.submit', job: TRAIN_70B });
    sim.step(600);
    const full = sim.snapshot();
    ok(sim, { type: 'node.setPowerLimit', nodes: 'all', watts: 450 });
    sim.step(120);
    const capped = sim.snapshot();
    expect(capped.cluster.gpuPowerW / 256).toBeLessThanOrEqual(451);
    expect(capped.jobs[0]!.metrics.tokensPerSec).toBeLessThan(full.jobs[0]!.metrics.tokensPerSec * 0.95);
  });
});

describe('workload accounting', () => {
  it('reports tokens/s consistent with model FLOPs and MFU', () => {
    const sim = cluster();
    ok(sim, { type: 'job.submit', job: TRAIN_70B });
    sim.step(600);
    const job = [...sim.jobs.values()][0]!;
    const m = job.metrics;
    const plan = job.plan as { modelFlopsPerToken: number };
    const peak = 256 * 989.4e12;
    expect((m.tokensPerSec * plan.modelFlopsPerToken) / peak).toBeCloseTo(m.mfu, 6);
    expect(m.mfu).toBeGreaterThan(0.3);
    expect(m.mfu).toBeLessThan(0.55);
  });

  it('checkpoints periodically and loses only post-checkpoint progress on failure', () => {
    const sim = cluster();
    ok(sim, { type: 'job.submit', job: { ...TRAIN_70B, checkpointIntervalMin: 5 } });
    sim.step(900);
    const job = [...sim.jobs.values()][0]!;
    expect(job.lastCheckpointStep).toBeGreaterThan(0);
    const ckpt = job.lastCheckpointStep;
    sim.step(60);
    const stepBefore = job.step;
    ok(sim, { type: 'fault.inject', target: { kind: 'gpu', node: job.nodes[0]!, gpu: 0, xid: 79 } });
    expect(job.state).toBe('restarting');
    expect(job.step).toBe(ckpt);
    expect(job.lostSteps).toBe(stepBefore - ckpt);
    expect(job.restarts).toBe(1);
  });

  it('keeps an unplaceable job pending with a resource reason', () => {
    const sim = cluster();
    ok(sim, { type: 'node.maintenance', nodes: [0], enter: true });
    ok(sim, { type: 'job.submit', job: TRAIN_70B });
    sim.step(5);
    const job = [...sim.jobs.values()][0]!;
    expect(job.state).toBe('pending');
    expect(job.reason).toMatch(/32 nodes required, 31 available/);
  });

  it('rejects jobs that do not fit in HBM with an OOM error', () => {
    const sim = new Simulation(buildTemplate('single-server'), { seed: 1 });
    const r = sim.execute({ type: 'job.submit', job: { ...TRAIN_70B, gpus: 8 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('JOB_OUT_OF_MEMORY');
  });

  it('serves inference load and saturates with queueing beyond capacity', () => {
    const sim = cluster();
    ok(sim, {
      type: 'job.submit',
      job: {
        kind: 'inference',
        name: 'chat',
        modelId: 'llama-3.1-70b',
        replicas: 2,
        tp: 4,
        precision: 'fp8',
        requestRate: 5,
        avgInputTokens: 1000,
        avgOutputTokens: 300,
      },
    });
    sim.step(300);
    const job = [...sim.jobs.values()][0]!;
    expect(job.state).toBe('running');
    expect(job.metrics.servedRps).toBeCloseTo(5, 1);
    expect(job.metrics.tpotS).toBeLessThan(0.1);
    ok(sim, { type: 'job.setRequestRate', jobId: job.id, requestRate: 500 });
    sim.step(120);
    expect(job.metrics.servedRps).toBeLessThan(500);
    expect(job.queue).toBeGreaterThan(1000);
    expect(job.metrics.sloAttainment).toBeLessThan(0.5);
  });
});

describe('failures and operations', () => {
  it('takes a crashed node out of the cluster and remediates it automatically', () => {
    const sim = cluster(3, 0);
    ok(sim, { type: 'fault.inject', target: { kind: 'node-crash', node: 4 } });
    expect(sim.rt.nodes.state[4]).toBe(NodeState.Failed);
    expect(sim.tickets.length).toBe(1);
    sim.step(6 * 3600);
    expect(sim.rt.nodes.state[4]).toBe(NodeState.Online);
    expect(sim.tickets.length).toBe(0);
  });

  it('degrades a node on PSU failure and asserts power brake without enough PSUs', () => {
    const sim = cluster(3, 0);
    sim.execute({ type: 'sim.setAutoRemediation', enabled: false });
    ok(sim, { type: 'fault.inject', target: { kind: 'psu', node: 2 } });
    sim.step(1);
    expect(sim.rt.nodes.state[2]).toBe(NodeState.Degraded);
    ok(sim, { type: 'fault.inject', target: { kind: 'psu', node: 2 } });
    ok(sim, { type: 'fault.inject', target: { kind: 'psu', node: 2 } });
    ok(sim, { type: 'fault.inject', target: { kind: 'psu', node: 2 } });
    sim.step(5);
    const detail = sim.query({ type: 'node.detail', node: 2 }) as {
      faults: string[];
      gpus: { throttle: string[] }[];
    };
    expect(detail.faults).toContain('power-brake');
    expect(detail.gpus[0]!.throttle).toContain('HW Power Brake Slowdown');
  });

  it('fails training jobs on a leaf switch failure and restores the rail after repair', () => {
    const sim = cluster(5, 0);
    sim.execute({ type: 'sim.setAutoRemediation', enabled: false });
    ok(sim, { type: 'job.submit', job: TRAIN_70B });
    sim.step(400);
    ok(sim, { type: 'fault.inject', target: { kind: 'switch', switch: 'ib-leaf-r3-001' } });
    const job = [...sim.jobs.values()][0]!;
    expect(job.state).toBe('restarting');
    expect(sim.railsUnavailable(0)).toBe(1);
    ok(sim, { type: 'switch.repair', switches: ['ib-leaf-r3-001'] });
    expect(sim.railsUnavailable(0)).toBe(0);
  });

  it('runs a full power cycle through POST and boot', () => {
    const sim = cluster(9, 0);
    ok(sim, { type: 'node.powerOff', nodes: [1] });
    expect(sim.rt.nodes.state[1]).toBe(NodeState.ShuttingDown);
    sim.step(60);
    expect(sim.rt.nodes.state[1]).toBe(NodeState.Offline);
    expect(sim.rt.nodes.wallW[1]).toBeLessThan(50);
    ok(sim, { type: 'node.powerOn', nodes: [1] });
    expect(sim.rt.nodes.state[1]).toBe(NodeState.Post);
    sim.step(400);
    expect([NodeState.Online, NodeState.Failed]).toContain(sim.rt.nodes.state[1]);
  });

  it('refuses to power off a busy node without force and clears reset-required GPUs on reboot', () => {
    const sim = cluster(11, 0);
    sim.execute({ type: 'sim.setAutoRemediation', enabled: false });
    ok(sim, { type: 'job.submit', job: TRAIN_70B });
    sim.step(5);
    const r = sim.execute({ type: 'node.powerOff', nodes: [0] });
    expect(r.ok).toBe(false);
    ok(sim, { type: 'fault.inject', target: { kind: 'gpu', node: 10, gpu: 2, xid: 48 } });
    const gi = sim.topo.nodes[10]!.gpuStart + 2;
    expect(sim.rt.gpus.health[gi]).toBe(GpuHealth.ResetRequired);
    ok(sim, { type: 'node.reboot', nodes: [10], force: true });
    sim.step(400);
    expect(sim.rt.gpus.health[gi]).toBe(GpuHealth.Ok);
    expect(sim.rt.gpus.retiredRows[gi]).toBe(1);
  });

  it('produces failures at roughly the configured AFR', () => {
    // 4 096 GPUs × 9 %/yr ≈ 369 GPU faults per year → ~1 per day.
    const sim = new Simulation(buildTemplate('enterprise-4096'), {
      seed: 99,
      failureRateMultiplier: 30,
      autoRemediation: true,
    });
    sim.step(86_400 / 4);
    const gpuFaults = sim.events.all().filter((e) => e.code.startsWith('GPU_XID_')).length;
    // 30× multiplier over 6 hours: expected ≈ 369 × 30 / 4 / 365 ≈ 7.6 (temperature-weighted, idle GPUs at 40 %).
    expect(gpuFaults).toBeGreaterThan(0);
    expect(gpuFaults).toBeLessThan(25);
  });
});
