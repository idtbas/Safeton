import { ObjectRing } from '../core/ringbuffer';
import { SEVERITY_RANK, type EventSourceKind, type Severity, type SimEvent } from './types';

/** Bounded, sequence-numbered event log. Consumers poll with `since(seq)`. */
export class EventLog {
  private ring: ObjectRing<SimEvent>;
  private seq = 0;

  constructor(capacity = 10_000) {
    this.ring = new ObjectRing<SimEvent>(capacity);
  }

  get lastSeq(): number {
    return this.seq;
  }

  emit(
    tick: number,
    time: number,
    severity: Severity,
    kind: EventSourceKind,
    id: string,
    code: string,
    message: string,
  ): SimEvent {
    const ev: SimEvent = { seq: ++this.seq, tick, time, severity, source: { kind, id }, code, message };
    this.ring.push(ev);
    return ev;
  }

  since(seq: number, limit = 2000): SimEvent[] {
    return this.ring.findLast((e) => e.seq > seq, limit);
  }

  query(opts: { limit?: number; minSeverity?: Severity; sourceKind?: EventSourceKind }): SimEvent[] {
    const min = opts.minSeverity ? SEVERITY_RANK[opts.minSeverity] : 0;
    return this.ring.findLast(
      (e) => SEVERITY_RANK[e.severity] >= min && (!opts.sourceKind || e.source.kind === opts.sourceKind),
      opts.limit ?? 500,
    );
  }

  all(): SimEvent[] {
    return this.ring.toArray();
  }

  serialize(limit = 2000): { seq: number; events: SimEvent[] } {
    const events = this.ring.toArray();
    return { seq: this.seq, events: events.slice(Math.max(0, events.length - limit)) };
  }

  static restore(state: { seq: number; events: SimEvent[] }, capacity = 10_000): EventLog {
    const log = new EventLog(capacity);
    for (const e of state.events) log.ring.push(e);
    log.seq = state.seq;
    return log;
  }
}
