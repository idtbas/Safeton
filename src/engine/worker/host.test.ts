import { afterEach, describe, expect, it } from 'vitest';
import { buildTemplate } from '../model/templates';
import { EngineClient } from './client';

describe('engine client / host protocol (in-process)', () => {
  let client: EngineClient | null = null;
  afterEach(() => {
    client?.dispose();
    client = null;
  });

  it('initialises, answers queries and executes commands', async () => {
    client = new EngineClient({ preferWorker: false });
    expect(client.mode).toBe('in-process');
    const init = await client.init(buildTemplate('gpu-rack'), { seed: 1 }, { running: false });
    expect(init.topology.gpuCount).toBe(32);
    const topo = await client.query({ type: 'topology' });
    expect(topo.nodes.length).toBe(4);
    const res = await client.command({ type: 'node.drain', nodes: [0] });
    expect(res.ok).toBe(true);
    const bad = await client.command({ type: 'node.drain', nodes: ['nope'] });
    expect(bad.ok).toBe(false);
    const step = await client.step(30);
    expect(step.tick).toBe(30);
    const detail = await client.query({ type: 'node.detail', node: 0 });
    expect(detail?.state).toBe('draining');
  });

  it('pushes snapshots and runs in real time when started', async () => {
    client = new EngineClient({ preferWorker: false });
    const snaps: number[] = [];
    client.onSnapshot((s) => snaps.push(s.tick));
    await client.init(
      buildTemplate('single-server'),
      { seed: 1 },
      { running: true, timeScale: 100, snapshotHz: 20 },
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(snaps.length).toBeGreaterThan(2);
    expect(snaps[snaps.length - 1]!).toBeGreaterThan(10);
  });

  it('rejects invalid control values and unknown state', async () => {
    client = new EngineClient({ preferWorker: false });
    await expect(client.query({ type: 'topology' })).rejects.toThrow(/not initialised/);
    await client.init(buildTemplate('single-server'), { seed: 1 }, { running: false });
    await expect(client.control({ timeScale: -5 })).rejects.toThrow(/Time scale/);
    const blob = await client.serialize();
    await expect(client.restore({ ...blob, format: 'x' as never })).rejects.toThrow(/Not a Safeton/);
  });
});
