/**
 * Benchmark body (bundled by scripts/bench.ts so it runs as production-like ESM, without the
 * module-interop overhead of on-the-fly TypeScript loaders).
 */
import { TEMPLATES, buildTemplate } from '../src/engine/model/templates';
import { Simulation } from '../src/engine/sim/simulation';

interface Row {
  template: string;
  gpus: number;
  nodes: number;
  scenario: string;
  msPerTick: number;
  p95: number;
  maxRealtimeX: number;
  snapshotMs: number;
  serializeMs: number;
}

function measure(sim: Simulation, ticks: number): { mean: number; p95: number } {
  const samples: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    sim.step(1);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    mean: samples.reduce((s, v) => s + v, 0) / samples.length,
    p95: samples[Math.floor(samples.length * 0.95)]!,
  };
}

const only = process.argv[2];
const rows: Row[] = [];
for (const t of TEMPLATES) {
  if (only && t.id !== only) continue;
  for (const scenario of ['idle', 'loaded'] as const) {
    const sim = new Simulation(buildTemplate(t.id), { seed: 1 });
    const gpus = sim.topo.gpuCount;
    const perNode = sim.topo.nodes[0]!.cfg.gpuCount;
    if (scenario === 'loaded') {
      const trainGpus = Math.max(perNode, Math.floor((gpus * 0.75) / perNode) * perNode);
      const model = gpus >= 2048 ? 'llama-3.1-405b' : gpus >= 64 ? 'llama-3.1-70b' : 'llama-3.1-8b';
      const batch = trainGpus * 2;
      const r = sim.execute({
        type: 'job.submit',
        job: {
          kind: 'training',
          name: 'bench',
          modelId: model,
          gpus: trainGpus,
          precision: 'bf16',
          seqLen: 8192,
          globalBatch: batch,
          totalTokens: 1e13,
          checkpointIntervalMin: 30,
        },
      });
      if (!r.ok) console.warn(`${t.id}: ${r.error.message}`);
      sim.execute({ type: 'sim.setFailureRate', multiplier: 50 });
      sim.step(300);
    } else {
      sim.step(30);
    }
    const ticks = gpus > 10_000 ? 300 : 1000;
    const m = measure(sim, ticks);
    let t0 = performance.now();
    sim.snapshot();
    const snapshotMs = performance.now() - t0;
    t0 = performance.now();
    sim.serialize();
    const serializeMs = performance.now() - t0;
    rows.push({
      template: t.id,
      gpus,
      nodes: sim.topo.nodes.length,
      scenario,
      msPerTick: m.mean,
      p95: m.p95,
      // The worker spends at most ~60 % of wall time stepping (30 ms budget per 50 ms loop).
      maxRealtimeX: (0.6 * 1000) / m.mean,
      snapshotMs,
      serializeMs,
    });
  }
}

const fmt = (v: number, d = 2) => v.toFixed(d).padStart(9);
console.log(`Node ${process.version} · ${new Date().toISOString()}`);
console.log(
  'template              GPUs  nodes  scenario  ms/tick    p95 ms  max ×realtime  snapshot ms  serialize ms',
);
for (const r of rows) {
  console.log(
    `${r.template.padEnd(20)}${String(r.gpus).padStart(6)}${String(r.nodes).padStart(7)}  ${r.scenario.padEnd(8)}${fmt(r.msPerTick, 3)}${fmt(r.p95, 3)}${fmt(r.maxRealtimeX, 0)}    ${fmt(r.snapshotMs)}   ${fmt(r.serializeMs)}`,
  );
}
