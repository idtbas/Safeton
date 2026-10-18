/**
 * Typed message protocol between the UI thread and the simulation worker.
 * Requests carry an id and receive exactly one response; snapshots are pushed unsolicited.
 */
import type { InfraSpec } from '../model/spec';
import type { SimStateBlob, SimulationOptions } from '../sim/simulation';
import type {
  Command,
  CommandResult,
  InferencePlan,
  Job,
  JobSummary,
  NodeDetail,
  Query,
  SimEvent,
  Snapshot,
  TopologyInfo,
  TrainingPlan,
} from '../sim/types';

export interface ControlSettings {
  running?: boolean;
  /** Simulated seconds per real second. */
  timeScale?: number;
  /** Snapshot pushes per second. */
  snapshotHz?: number;
}

export type ClientRequest =
  | { kind: 'init'; spec: InfraSpec; options: SimulationOptions; control?: ControlSettings }
  | { kind: 'restore'; state: SimStateBlob; control?: ControlSettings }
  | { kind: 'command'; command: Command }
  | { kind: 'query'; query: Query }
  | { kind: 'control'; control: ControlSettings }
  | { kind: 'step'; ticks: number }
  | { kind: 'serialize' };

export type ClientMessage = ClientRequest & { id: number };

export interface InitResult {
  topology: TopologyInfo;
  tick: number;
  time: number;
}

export type PlanQueryResult =
  | { ok: true; plan: TrainingPlan | InferencePlan }
  | { ok: false; code: string; message: string };

export interface QueryResultMap {
  topology: TopologyInfo;
  'node.detail': NodeDetail | null;
  'job.detail': Job | null;
  jobs: JobSummary[];
  series: Record<string, number[]>;
  events: SimEvent[];
  plan: PlanQueryResult;
  stateHash: string;
}

export interface RequestResultMap {
  init: InitResult;
  restore: InitResult;
  command: CommandResult;
  query: unknown;
  control: ControlSettings;
  step: { tick: number; ms: number };
  serialize: SimStateBlob;
}

export type WorkerMessage =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: string }
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'fatal'; error: string };

/** Collects the ArrayBuffers of a snapshot so they can be transferred instead of copied. */
export function snapshotTransferables(s: Snapshot): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const group of [s.nodes, s.racks, s.switches] as unknown as Record<string, ArrayBufferView>[]) {
    for (const arr of Object.values(group)) out.push(arr.buffer as ArrayBuffer);
  }
  return out;
}
