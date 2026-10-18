/**
 * Environment-agnostic engine host: owns a Simulation, runs the real-time loop and answers
 * protocol requests. Runs inside the Web Worker (worker.ts) or in-process as a fallback.
 */
import { Simulation } from '../sim/simulation';
import type { PerfStats } from '../sim/types';
import {
  snapshotTransferables,
  type ClientMessage,
  type ControlSettings,
  type WorkerMessage,
} from './protocol';

type Post = (msg: WorkerMessage, transfer?: Transferable[]) => void;

const LOOP_INTERVAL_MS = 50;
/** Maximum compute time per loop iteration before the simulation is declared lagging. */
const LOOP_BUDGET_MS = 30;
export const MAX_TIME_SCALE = 3600;

export class EngineHost {
  private sim: Simulation | null = null;
  private running = false;
  private timeScale = 1;
  private snapshotHz = 4;
  private accumulator = 0;
  private lastLoop = 0;
  private lastSnapshot = 0;
  private lastSeq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lagging = false;
  private window: { t: number; ticks: number }[] = [];

  constructor(private readonly post: Post) {}

  handle(msg: ClientMessage): void {
    try {
      const result = this.dispatch(msg);
      this.post({ kind: 'response', id: msg.id, ok: true, result });
    } catch (err) {
      this.post({
        kind: 'response',
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private dispatch(msg: ClientMessage): unknown {
    switch (msg.kind) {
      case 'init':
        this.sim = new Simulation(msg.spec, msg.options);
        return this.started(msg.control);
      case 'restore':
        this.sim = Simulation.restore(msg.state);
        return this.started(msg.control);
      case 'command':
        return this.require().execute(msg.command);
      case 'query':
        return this.require().query(msg.query);
      case 'control':
        this.applyControl(msg.control);
        this.pushSnapshot(true);
        return { running: this.running, timeScale: this.timeScale, snapshotHz: this.snapshotHz };
      case 'step': {
        const sim = this.require();
        const ms = sim.step(Math.max(1, Math.min(86_400, Math.floor(msg.ticks))));
        this.pushSnapshot(true);
        return { tick: sim.tick, ms };
      }
      case 'serialize':
        return this.require().serialize();
    }
  }

  private require(): Simulation {
    if (!this.sim) throw new Error('Simulation not initialised');
    return this.sim;
  }

  private started(control?: ControlSettings) {
    const sim = this.require();
    this.lastSeq = Math.max(0, sim.events.lastSeq - 200);
    this.accumulator = 0;
    this.applyControl(control ?? {});
    this.ensureLoop();
    this.pushSnapshot(true);
    return { topology: sim.query({ type: 'topology' }), tick: sim.tick, time: sim.time };
  }

  private applyControl(c: ControlSettings): void {
    if (c.running !== undefined) this.running = c.running;
    if (c.timeScale !== undefined) {
      if (!Number.isFinite(c.timeScale) || c.timeScale <= 0 || c.timeScale > MAX_TIME_SCALE) {
        throw new Error(`Time scale must be between 0 and ${MAX_TIME_SCALE}`);
      }
      this.timeScale = c.timeScale;
    }
    if (c.snapshotHz !== undefined) this.snapshotHz = Math.max(0.5, Math.min(20, c.snapshotHz));
    this.accumulator = 0;
  }

  private ensureLoop(): void {
    if (this.timer) return;
    this.lastLoop = now();
    const loop = () => {
      this.timer = setTimeout(loop, LOOP_INTERVAL_MS);
      try {
        this.tickLoop();
      } catch (err) {
        this.running = false;
        this.post({
          kind: 'fatal',
          error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
        });
      }
    };
    this.timer = setTimeout(loop, LOOP_INTERVAL_MS);
  }

  private tickLoop(): void {
    const sim = this.sim;
    const t = now();
    const real = Math.min(1000, t - this.lastLoop);
    this.lastLoop = t;
    if (!sim) return;
    let ticks = 0;
    if (this.running) {
      this.accumulator += (real / 1000) * this.timeScale;
      const start = now();
      while (this.accumulator >= sim.dt && now() - start < LOOP_BUDGET_MS) {
        sim.step(1);
        this.accumulator -= sim.dt;
        ticks++;
      }
      // Cannot keep up: drop the backlog instead of spiralling, and report it.
      this.lagging = this.accumulator >= sim.dt * 2;
      if (this.lagging) this.accumulator = 0;
    } else {
      this.lagging = false;
    }
    this.window.push({ t, ticks });
    while (this.window.length > 0 && t - this.window[0]!.t > 2000) this.window.shift();
    this.pushSnapshot(false);
  }

  private perf(): Partial<PerfStats> {
    const sim = this.sim;
    if (!sim || this.window.length < 2) return { lagging: this.lagging };
    const span = (this.window[this.window.length - 1]!.t - this.window[0]!.t) / 1000;
    const ticks = this.window.reduce((s, w) => s + w.ticks, 0);
    const tps = span > 0 ? ticks / span : 0;
    return { ticksPerSecond: tps, simSecondsPerSecond: tps * sim.dt, lagging: this.lagging };
  }

  private pushSnapshot(force: boolean): void {
    const sim = this.sim;
    if (!sim) return;
    const t = now();
    if (!force && t - this.lastSnapshot < 1000 / this.snapshotHz) return;
    this.lastSnapshot = t;
    const snapshot = sim.snapshot(
      this.perf(),
      { running: this.running, timeScale: this.timeScale },
      this.lastSeq,
    );
    if (snapshot.events.length > 0) this.lastSeq = snapshot.events[snapshot.events.length - 1]!.seq;
    this.post({ kind: 'snapshot', snapshot }, snapshotTransferables(snapshot));
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.sim = null;
  }
}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();
