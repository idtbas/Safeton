/// <reference lib="webworker" />
/**
 * Web Worker entry: hosts the simulation off the UI thread.
 */
import { EngineHost } from './host';
import type { ClientMessage, WorkerMessage } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const host = new EngineHost((msg: WorkerMessage, transfer?: Transferable[]) => {
  self.postMessage(msg, transfer ?? []);
});

self.onmessage = (event: MessageEvent<ClientMessage>) => host.handle(event.data);
