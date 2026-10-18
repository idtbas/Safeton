/**
 * Reactive mirror of the simulation for the UI: the latest snapshot, static topology, a
 * client-side telemetry window and the recent event stream. Written only by the kernel.
 */
import { create } from 'zustand';
import type { EngineMode, SimEvent, Snapshot, TopologyInfo } from '../../engine';

export const CLIENT_SERIES_CAPACITY = 1440;
export const CLIENT_EVENT_CAPACITY = 2000;

export type EngineStatus = 'idle' | 'booting' | 'ready' | 'error';

export interface EngineStoreState {
  status: EngineStatus;
  error: string | null;
  mode: EngineMode | null;
  topology: TopologyInfo | null;
  snapshot: Snapshot | null;
  events: SimEvent[];
  series: Record<string, number[]>;
  lastSavedAt: number | null;
  saveError: string | null;
  storageKind: 'indexeddb' | 'memory' | null;
}

export const useEngineStore = create<EngineStoreState>(() => ({
  status: 'idle',
  error: null,
  mode: null,
  topology: null,
  snapshot: null,
  events: [],
  series: { time: [] },
  lastSavedAt: null,
  saveError: null,
  storageKind: null,
}));

/** Folds a snapshot into the store (events and telemetry samples are appended). */
export function ingestSnapshot(snapshot: Snapshot): void {
  const s = useEngineStore.getState();
  let events = s.events;
  if (snapshot.events.length > 0) {
    events = events.concat(snapshot.events);
    if (events.length > CLIENT_EVENT_CAPACITY) events = events.slice(events.length - CLIENT_EVENT_CAPACITY);
  }
  let series = s.series;
  if (snapshot.samples.length > 0) {
    series = { ...series };
    const time = (series.time ?? []).slice();
    for (const sample of snapshot.samples) {
      time.push(sample.t);
      for (const [k, v] of Object.entries(sample.values)) {
        const arr = (series[k] ?? []).slice();
        arr.push(v);
        series[k] = arr;
      }
    }
    series.time = time;
    for (const k of Object.keys(series)) {
      const arr = series[k]!;
      if (arr.length > CLIENT_SERIES_CAPACITY) series[k] = arr.slice(arr.length - CLIENT_SERIES_CAPACITY);
    }
  }
  useEngineStore.setState({ snapshot, events, series });
}
