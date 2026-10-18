/**
 * UI-side proxy for the simulation. Prefers a dedicated Web Worker; falls back to an
 * in-process host where workers are unavailable (tests, restricted environments).
 */
import type { InfraSpec } from '../model/spec';
import type { SimStateBlob, SimulationOptions } from '../sim/simulation';
import type { Command, CommandResult, Query, Snapshot } from '../sim/types';
import { EngineHost } from './host';
import type {
  ClientMessage,
  ClientRequest,
  ControlSettings,
  InitResult,
  QueryResultMap,
  RequestResultMap,
  WorkerMessage,
} from './protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export type EngineMode = 'worker' | 'in-process';

export class EngineClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private snapshotListeners = new Set<(s: Snapshot) => void>();
  private fatalListeners = new Set<(error: string) => void>();
  private worker: Worker | null = null;
  private host: EngineHost | null = null;
  readonly mode: EngineMode;

  constructor(opts: { preferWorker?: boolean } = {}) {
    const canWorker = opts.preferWorker !== false && typeof Worker !== 'undefined';
    if (canWorker) {
      try {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'safeton-engine' });
        this.worker.onmessage = (e: MessageEvent<WorkerMessage>) => this.receive(e.data);
        this.worker.onerror = (e) => this.fatal(`Engine worker error: ${e.message}`);
        this.mode = 'worker';
        return;
      } catch {
        this.worker = null;
      }
    }
    this.host = new EngineHost((msg) => queueMicrotask(() => this.receive(msg)));
    this.mode = 'in-process';
  }

  private receive(msg: WorkerMessage): void {
    switch (msg.kind) {
      case 'response': {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
        break;
      }
      case 'snapshot':
        for (const l of this.snapshotListeners) l(msg.snapshot);
        break;
      case 'fatal':
        this.fatal(msg.error);
        break;
    }
  }

  private fatal(error: string): void {
    for (const l of this.fatalListeners) l(error);
  }

  private request<K extends ClientRequest['kind']>(req: Extract<ClientRequest, { kind: K }>): Promise<RequestResultMap[K]> {
    const id = this.nextId++;
    const msg = { ...req, id } as ClientMessage;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      if (this.worker) this.worker.postMessage(msg);
      else this.host!.handle(structuredClone(msg));
    });
  }

  init(spec: InfraSpec, options: SimulationOptions, control?: ControlSettings): Promise<InitResult> {
    return this.request({ kind: 'init', spec, options, control });
  }

  restore(state: SimStateBlob, control?: ControlSettings): Promise<InitResult> {
    return this.request({ kind: 'restore', state, control });
  }

  command(command: Command): Promise<CommandResult> {
    return this.request({ kind: 'command', command });
  }

  query<Q extends Query>(query: Q): Promise<QueryResultMap[Q['type']]> {
    return this.request({ kind: 'query', query }) as Promise<QueryResultMap[Q['type']]>;
  }

  control(control: ControlSettings): Promise<ControlSettings> {
    return this.request({ kind: 'control', control });
  }

  step(ticks: number): Promise<{ tick: number; ms: number }> {
    return this.request({ kind: 'step', ticks });
  }

  serialize(): Promise<SimStateBlob> {
    return this.request({ kind: 'serialize' });
  }

  onSnapshot(listener: (s: Snapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onFatal(listener: (error: string) => void): () => void {
    this.fatalListeners.add(listener);
    return () => this.fatalListeners.delete(listener);
  }

  dispose(): void {
    this.worker?.terminate();
    this.host?.dispose();
    for (const p of this.pending.values()) p.reject(new Error('Engine disposed'));
    this.pending.clear();
  }
}
