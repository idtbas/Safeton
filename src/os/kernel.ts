/**
 * OS kernel: wires persistence, settings, the simulation engine, telemetry and notifications
 * together. All lifecycle operations (boot, save, reset, import/export) live here so every
 * UI surface — and later the terminal — triggers the exact same code paths.
 */
import { CATALOG, CATALOG_VERSION } from '../catalog';
import {
  EngineClient,
  SEVERITY_RANK,
  buildTemplate,
  validateInfra,
  type Command,
  type CommandResult,
  type ControlSettings,
  type InfraSpec,
  type Query,
  type QueryResultMap,
  type SimEvent,
} from '../engine';
import { registerBuiltinApps } from '../apps';
import { ingestSnapshot, useEngineStore } from './engine/store';
import { useNotificationStore } from './notifications/store';
import { Repository } from './persistence/repository';
import { openDocumentStore } from './persistence/store';
import { defaultSettings, type Settings } from './settings/schema';
import { applyAppearance, useSettingsStore } from './settings/store';

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

export type BootStepStatus = 'pending' | 'running' | 'done' | 'failed';
export interface BootStep {
  id: string;
  label: string;
  status: BootStepStatus;
  detail?: string;
  ms?: number;
}

interface KernelState {
  repo: Repository;
  client: EngineClient;
  autosaveTimer: ReturnType<typeof setInterval> | null;
  unsubscribers: (() => void)[];
}

let kernel: KernelState | null = null;
let bootPromise: Promise<void> | null = null;

function requireKernel(): KernelState {
  if (!kernel) throw new Error('Kernel not booted');
  return kernel;
}

const humanize = (code: string) =>
  code
    .toLowerCase()
    .split('_')
    .map((w) =>
      w === 'gpu' || w === 'nic' || w === 'psu' || w === 'xid' || w === 'cdu' || w === 'crah'
        ? w.toUpperCase()
        : w,
    )
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());

function forwardEvents(events: SimEvent[], settings: Settings): void {
  const min = SEVERITY_RANK[settings.notifications.minSeverity];
  const relevant = events.filter((e) => SEVERITY_RANK[e.severity] >= min);
  if (relevant.length === 0) return;
  const push = useNotificationStore.getState().push;
  if (relevant.length > 5) {
    const worst = relevant.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a));
    push({
      severity: worst.severity,
      title: `${relevant.length} infrastructure events`,
      body: `Latest: ${worst.source.id} — ${worst.message}`,
      source: 'event-bus',
      simTime: worst.time,
    });
    return;
  }
  for (const e of relevant) {
    push({
      severity: e.severity,
      title: humanize(e.code),
      body: e.message,
      source: `${e.source.kind}:${e.source.id}`,
      simTime: e.time,
    });
  }
}

function applySettingsSideEffects(next: Settings, prev: Settings | null): void {
  if (typeof document !== 'undefined') applyAppearance(next);
  useNotificationStore.getState().configure({
    minToastSeverity: next.notifications.minSeverity,
    toastsEnabled: next.notifications.toasts,
    doNotDisturb: next.notifications.doNotDisturb,
  });
  if (!kernel || !prev) return;
  const { client } = kernel;
  const s = next.simulation;
  const p = prev.simulation;
  if (s.failureRateMultiplier !== p.failureRateMultiplier) {
    void client.command({ type: 'sim.setFailureRate', multiplier: s.failureRateMultiplier });
  }
  if (s.autoRemediation !== p.autoRemediation) {
    void client.command({ type: 'sim.setAutoRemediation', enabled: s.autoRemediation });
  }
  if (s.snapshotHz !== p.snapshotHz) void client.control({ snapshotHz: s.snapshotHz });
  if (s.autoSaveIntervalS !== p.autoSaveIntervalS) scheduleAutosave(s.autoSaveIntervalS);
}

function scheduleAutosave(intervalS: number): void {
  const k = requireKernel();
  if (k.autosaveTimer) clearInterval(k.autosaveTimer);
  k.autosaveTimer = setInterval(() => void saveNow(), intervalS * 1000);
}

async function seedSeries(): Promise<void> {
  const series = await requireKernel().client.query({ type: 'series' });
  useEngineStore.setState({ series });
}

/**
 * Boots the OS core. Safe to call more than once (subsequent calls return the first boot).
 * `onProgress` receives the boot step list as it advances — the stage 2 boot screen renders it.
 */
export function bootKernel(onProgress?: (steps: BootStep[]) => void): Promise<void> {
  bootPromise ??= runBoot(onProgress);
  return bootPromise;
}

async function runBoot(onProgress?: (steps: BootStep[]) => void): Promise<void> {
  const steps: BootStep[] = [
    { id: 'storage', label: 'Mounting persistent storage', status: 'pending' },
    { id: 'settings', label: 'Loading system configuration', status: 'pending' },
    { id: 'catalog', label: 'Verifying hardware catalog', status: 'pending' },
    { id: 'engine', label: 'Starting simulation engine', status: 'pending' },
    { id: 'state', label: 'Restoring infrastructure state', status: 'pending' },
    { id: 'telemetry', label: 'Attaching telemetry and event bus', status: 'pending' },
  ];
  const run = async <T>(id: string, fn: () => Promise<T> | T, detail?: (r: T) => string): Promise<T> => {
    const step = steps.find((s) => s.id === id)!;
    step.status = 'running';
    onProgress?.([...steps]);
    const t0 = performance.now();
    try {
      const r = await fn();
      step.status = 'done';
      step.ms = performance.now() - t0;
      if (detail) step.detail = detail(r);
      onProgress?.([...steps]);
      return r;
    } catch (err) {
      step.status = 'failed';
      step.detail = (err as Error).message;
      onProgress?.([...steps]);
      throw err;
    }
  };

  useEngineStore.setState({ status: 'booting', error: null });
  const notify = useNotificationStore.getState().push;
  try {
    registerBuiltinApps();
    const store = await run('storage', openDocumentStore, (s) =>
      s.kind === 'indexeddb' ? 'IndexedDB' : 'volatile memory (storage unavailable)',
    );
    const repo = new Repository(store);
    useEngineStore.setState({ storageKind: store.kind });
    if (store.kind === 'memory') {
      notify({
        severity: 'warning',
        title: 'Persistent storage unavailable',
        body: 'Browser storage is blocked; changes will not survive a reload.',
        source: 'kernel',
      });
    }

    const settings = await run(
      'settings',
      async () => {
        const res = await repo.loadSettings();
        for (const issue of res.issues)
          notify({ severity: 'warning', title: 'Configuration recovered', body: issue, source: 'kernel' });
        return res.value ?? defaultSettings();
      },
      (s) => `${s.system.hostname} · ${s.region.locale}`,
    );
    useSettingsStore.getState().replace(settings);
    applySettingsSideEffects(settings, null);

    await run(
      'catalog',
      () => {
        const items = Object.values(CATALOG).reduce((n, list) => n + list.length, 0);
        return items;
      },
      (n) => `${n} component definitions (catalog ${CATALOG_VERSION})`,
    );

    const client = await run(
      'engine',
      () => new EngineClient(),
      (c) => (c.mode === 'worker' ? 'dedicated worker thread' : 'in-process (worker unavailable)'),
    );
    kernel = { repo, client, autosaveTimer: null, unsubscribers: [] };
    useEngineStore.setState({ mode: client.mode });

    const control: ControlSettings = {
      running: settings.simulation.startRunning,
      timeScale: settings.simulation.timeScale,
      snapshotHz: settings.simulation.snapshotHz,
    };
    const init = await run(
      'state',
      async () => {
        const saved = await repo.loadSimState();
        for (const issue of saved.issues)
          notify({ severity: 'warning', title: 'Simulation state recovered', body: issue, source: 'kernel' });
        if (saved.value) {
          try {
            return await client.restore(saved.value, control);
          } catch (err) {
            await store.quarantine('sim-state', null, (err as Error).message);
            notify({
              severity: 'error',
              title: 'Saved state could not be restored',
              body: (err as Error).message,
              source: 'kernel',
            });
          }
        }
        const infra = await repo.loadInfra();
        for (const issue of infra.issues)
          notify({
            severity: 'warning',
            title: 'Infrastructure configuration recovered',
            body: issue,
            source: 'kernel',
          });
        const spec = infra.value ?? buildTemplate(settings.simulation.defaultTemplate);
        if (!infra.value) await repo.saveInfra(spec);
        return client.init(
          spec,
          {
            seed: settings.simulation.seed,
            failureRateMultiplier: settings.simulation.failureRateMultiplier,
            autoRemediation: settings.simulation.autoRemediation,
          },
          control,
        );
      },
      (r) => `${r.topology.spec.name}: ${r.topology.nodes.length} nodes, ${r.topology.gpuCount} GPUs`,
    );
    useEngineStore.setState({ topology: init.topology });

    await run('telemetry', async () => {
      const k = requireKernel();
      k.unsubscribers.push(
        client.onSnapshot((snap) => {
          ingestSnapshot(snap);
          if (snap.events.length) forwardEvents(snap.events, useSettingsStore.getState().settings);
        }),
        client.onFatal((error) => {
          useEngineStore.setState({ status: 'error', error });
          notify({
            severity: 'critical',
            title: 'Simulation engine fault',
            body: error.split('\n')[0] ?? error,
            source: 'kernel',
          });
        }),
        useSettingsStore.subscribe((state, prev) => {
          if (state.settings === prev.settings) return;
          applySettingsSideEffects(state.settings, prev.settings);
          void repo.saveSettings(state.settings);
        }),
      );
      await seedSeries();
      scheduleAutosave(settings.simulation.autoSaveIntervalS);
      if (typeof window !== 'undefined') {
        const flush = () => void saveNow();
        const onVisibility = () => {
          if (document.visibilityState === 'hidden') flush();
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', onVisibility);
        k.unsubscribers.push(
          () => window.removeEventListener('pagehide', flush),
          () => document.removeEventListener('visibilitychange', onVisibility),
        );
      }
    });

    useEngineStore.setState({ status: 'ready' });
  } catch (err) {
    useEngineStore.setState({ status: 'error', error: (err as Error).message });
    throw err;
  }
}

// ---- Operations ---------------------------------------------------------------------------

export function command(cmd: Command): Promise<CommandResult> {
  return requireKernel().client.command(cmd);
}

export function query<Q extends Query>(q: Q): Promise<QueryResultMap[Q['type']]> {
  return requireKernel().client.query(q);
}

export async function setRunning(running: boolean): Promise<void> {
  await requireKernel().client.control({ running });
}

export async function setTimeScale(timeScale: number): Promise<void> {
  await requireKernel().client.control({ timeScale });
  useSettingsStore.getState().update({ simulation: { timeScale } });
}

export async function stepSimulation(ticks: number): Promise<void> {
  await requireKernel().client.step(ticks);
}

let saving: Promise<void> | null = null;
export function saveNow(): Promise<void> {
  if (!kernel) return Promise.resolve();
  saving ??= (async () => {
    const { repo, client } = requireKernel();
    try {
      const state = await client.serialize();
      await repo.saveSimState(state);
      await repo.saveInfra(state.spec);
      useEngineStore.setState({ lastSavedAt: Date.now(), saveError: null });
    } catch (err) {
      useEngineStore.setState({ saveError: (err as Error).message });
    } finally {
      saving = null;
    }
  })();
  return saving;
}

/** Replaces the running infrastructure with a new (validated) specification. */
export async function loadInfrastructure(
  spec: InfraSpec,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const report = validateInfra(spec);
  if (!report.ok) {
    return {
      ok: false,
      message: `${report.errors} validation error(s): ${report.issues.find((i) => i.severity === 'error')?.message ?? ''}`,
    };
  }
  const { repo, client } = requireKernel();
  const settings = useSettingsStore.getState().settings;
  const init = await client.init(
    spec,
    {
      seed: settings.simulation.seed,
      failureRateMultiplier: settings.simulation.failureRateMultiplier,
      autoRemediation: settings.simulation.autoRemediation,
    },
    {
      running: settings.simulation.startRunning,
      timeScale: settings.simulation.timeScale,
      snapshotHz: settings.simulation.snapshotHz,
    },
  );
  useEngineStore.setState({ topology: init.topology, events: [], series: { time: [] } });
  await seedSeries();
  await repo.saveInfra(spec);
  await saveNow();
  useNotificationStore.getState().push({
    severity: 'notice',
    title: 'Infrastructure loaded',
    body: `${spec.name}: ${init.topology.nodes.length} nodes, ${init.topology.gpuCount} GPUs`,
    source: 'kernel',
  });
  return { ok: true };
}

export async function exportSystem(): Promise<string> {
  const { repo, client } = requireKernel();
  const state = await client.serialize();
  return repo.exportBundle(APP_VERSION, state);
}

/** Validates an export file, persists it and re-initialises the engine from it. */
export async function importSystem(
  text: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const { repo, client } = requireKernel();
  let bundle;
  try {
    bundle = repo.parseBundle(text);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  await repo.importBundle(bundle);
  if (bundle.settings) useSettingsStore.getState().replace(bundle.settings);
  const settings = useSettingsStore.getState().settings;
  const control = {
    running: settings.simulation.startRunning,
    timeScale: settings.simulation.timeScale,
    snapshotHz: settings.simulation.snapshotHz,
  };
  try {
    const init = bundle.simState
      ? await client.restore(bundle.simState, control)
      : await client.init(
          bundle.infra ?? buildTemplate(settings.simulation.defaultTemplate),
          { seed: settings.simulation.seed },
          control,
        );
    useEngineStore.setState({ topology: init.topology, events: [], series: { time: [] } });
    await seedSeries();
  } catch (err) {
    return {
      ok: false,
      message: `Import stored, but the engine rejected the state: ${(err as Error).message}`,
    };
  }
  return { ok: true, message: `Imported export from ${bundle.exportedAt}` };
}

/** Clears simulation state and infrastructure and loads the default template. */
export async function resetSimulation(templateId?: string): Promise<void> {
  const { repo } = requireKernel();
  await repo.clearSimulation();
  const id = templateId ?? useSettingsStore.getState().settings.simulation.defaultTemplate;
  await loadInfrastructure(buildTemplate(id));
}

/** Wipes all persisted data (settings included) and reloads the page. */
export async function factoryReset(): Promise<void> {
  const k = requireKernel();
  if (k.autosaveTimer) clearInterval(k.autosaveTimer);
  k.autosaveTimer = null;
  for (const u of k.unsubscribers) u();
  k.client.dispose();
  await k.repo.factoryReset();
  if (typeof location !== 'undefined') location.reload();
}

export function storageKind(): 'indexeddb' | 'memory' | null {
  return kernel?.repo.store.kind ?? null;
}
