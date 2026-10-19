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
  type InitResult,
  type SimulationOptions,
  type Snapshot,
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
import { accountSchema, loginBackoffMs, verifyPassword, type Account } from './auth/credentials';
import { useAlertStore } from './alerts';
import { t } from './i18n';
import { SETTINGS_SCHEMA_VERSION, defaultSettings, type Settings } from './settings/schema';
import {
  buildSetupSpec,
  toSettings,
  validateSetupInfra,
  type SetupData,
  type SetupDraft,
} from './setup/model';
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
  if (typeof document !== 'undefined') {
    applyAppearance(next);
    document.documentElement.lang = next.region.locale.slice(0, 2);
  }
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

// ---- Boot ----------------------------------------------------------------------------------

const BOOT_STEPS: { id: string; label: string; phase: 'core' | 'infra' }[] = [
  { id: 'storage', label: 'Mounting persistent storage', phase: 'core' },
  { id: 'settings', label: 'Loading system configuration', phase: 'core' },
  { id: 'catalog', label: 'Verifying hardware catalog', phase: 'core' },
  { id: 'account', label: 'Loading administrator directory', phase: 'core' },
  { id: 'engine', label: 'Starting simulation engine', phase: 'core' },
  { id: 'state', label: 'Restoring infrastructure state', phase: 'infra' },
  { id: 'telemetry', label: 'Attaching telemetry and event bus', phase: 'infra' },
];

const bootSteps: BootStep[] = BOOT_STEPS.map((s) => ({ id: s.id, label: s.label, status: 'pending' }));
const progressListeners = new Set<(steps: BootStep[]) => void>();

function emitProgress(): void {
  const copy = bootSteps.map((s) => ({ ...s }));
  for (const l of progressListeners) l(copy);
}

async function runStep<T>(id: string, fn: () => Promise<T> | T, detail?: (r: T) => string): Promise<T> {
  const step = bootSteps.find((s) => s.id === id)!;
  step.status = 'running';
  emitProgress();
  const t0 = performance.now();
  try {
    const r = await fn();
    step.status = 'done';
    step.ms = performance.now() - t0;
    if (detail) step.detail = detail(r);
    emitProgress();
    return r;
  } catch (err) {
    step.status = 'failed';
    step.detail = (err as Error).message;
    emitProgress();
    throw err;
  }
}

export interface CoreInfo {
  /** First run (or incomplete configuration): the setup assistant must run. */
  setupRequired: boolean;
  storageKind: 'indexeddb' | 'memory';
  engineMode: 'worker' | 'in-process';
  catalogItems: number;
  catalogVersion: string;
  account: Account | null;
}

let corePromise: Promise<CoreInfo> | null = null;
let infraPromise: Promise<InitResult> | null = null;
let account: Account | null = null;

/** Subscribes to boot step progress; the current list is delivered immediately. */
export function onBootProgress(listener: (steps: BootStep[]) => void): () => void {
  progressListeners.add(listener);
  listener(bootSteps.map((s) => ({ ...s })));
  return () => progressListeners.delete(listener);
}

/**
 * Phase 1 of the boot: storage, configuration, catalog, administrator directory and the engine
 * worker. Does not load any infrastructure — on first run the setup assistant runs next.
 */
export function bootCore(onProgress?: (steps: BootStep[]) => void): Promise<CoreInfo> {
  if (onProgress) onBootProgress(onProgress);
  corePromise ??= runCore();
  return corePromise;
}

async function runCore(): Promise<CoreInfo> {
  useEngineStore.setState({ status: 'booting', error: null });
  const notify = useNotificationStore.getState().push;
  try {
    registerBuiltinApps();
    const store = await runStep('storage', openDocumentStore, (s) =>
      s.kind === 'indexeddb' ? 'IndexedDB (safeton v1)' : 'volatile memory (storage unavailable)',
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

    const settings = await runStep(
      'settings',
      async () => {
        const res = await repo.loadSettings();
        for (const issue of res.issues)
          notify({ severity: 'warning', title: 'Configuration recovered', body: issue, source: 'kernel' });
        return res.value ?? defaultSettings();
      },
      (s) => `${s.system.hostname} · ${s.region.locale} · schema v${SETTINGS_SCHEMA_VERSION}`,
    );
    useSettingsStore.getState().replace(settings);
    applySettingsSideEffects(settings, null);

    const catalogItems = await runStep(
      'catalog',
      () => Object.values(CATALOG).reduce((n, list) => n + list.length, 0),
      (n) => `${n} component definitions (catalog ${CATALOG_VERSION})`,
    );

    account = await runStep(
      'account',
      async () => (await repo.loadAccount()).value,
      (a) => (a ? `1 administrator (${a.username})` : 'no administrator configured'),
    );

    const client = await runStep(
      'engine',
      () => new EngineClient(),
      (c) => (c.mode === 'worker' ? 'dedicated worker thread' : 'in-process (worker unavailable)'),
    );
    kernel = { repo, client, autosaveTimer: null, unsubscribers: [] };
    useEngineStore.setState({ mode: client.mode });
    attachSettingsPersistence();

    return {
      setupRequired: !settings.system.setupComplete || !account,
      storageKind: store.kind,
      engineMode: client.mode,
      catalogItems,
      catalogVersion: CATALOG_VERSION,
      account,
    };
  } catch (err) {
    useEngineStore.setState({ status: 'error', error: (err as Error).message });
    throw err;
  }
}

function controlFromSettings(settings: Settings): ControlSettings {
  return {
    running: settings.simulation.startRunning,
    timeScale: settings.simulation.timeScale,
    snapshotHz: settings.simulation.snapshotHz,
  };
}

function engineOptions(settings: Settings, initialPower: 'online' | 'offline' = 'online'): SimulationOptions {
  return {
    seed: settings.simulation.seed,
    failureRateMultiplier: settings.simulation.failureRateMultiplier,
    autoRemediation: settings.simulation.autoRemediation,
    seriesIntervalS: settings.simulation.telemetryIntervalS,
    initialPower,
  };
}

/**
 * Phase 2 of the boot: restore the saved simulation (or initialise the stored / default
 * infrastructure) and attach telemetry. A cold start applies when the infrastructure is
 * commissioned without saved state: every node then starts powered off and runs through POST.
 */
export function startInfrastructure(onProgress?: (steps: BootStep[]) => void): Promise<InitResult> {
  if (onProgress) onBootProgress(onProgress);
  infraPromise ??= (async () => {
    await bootCore();
    return runInfra();
  })();
  return infraPromise;
}

async function runInfra(): Promise<InitResult> {
  const { repo, client } = requireKernel();
  const notify = useNotificationStore.getState().push;
  const settings = useSettingsStore.getState().settings;
  const control = controlFromSettings(settings);
  try {
    const init = await runStep(
      'state',
      async () => {
        const saved = await repo.loadSimState();
        for (const issue of saved.issues)
          notify({ severity: 'warning', title: 'Simulation state recovered', body: issue, source: 'kernel' });
        if (saved.value) {
          try {
            return await client.restore(saved.value, control);
          } catch (err) {
            await repo.store.quarantine('sim-state', null, (err as Error).message);
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
        const power = settings.simulation.startMode === 'cold' ? 'offline' : 'online';
        const result = await client.init(spec, engineOptions(settings, power), control);
        if (power === 'offline') await client.command({ type: 'node.powerOn', nodes: 'all' });
        return result;
      },
      (r) => `${r.topology.spec.name}: ${r.topology.nodes.length} nodes, ${r.topology.gpuCount} GPUs`,
    );
    useEngineStore.setState({ topology: init.topology });

    await runStep(
      'telemetry',
      async () => {
        const k = requireKernel();
        k.unsubscribers.push(
          client.onSnapshot((snap) => {
            ingestSnapshot(snap);
            const current = useSettingsStore.getState().settings;
            if (snap.events.length) forwardEvents(snap.events, current);
            evaluateThresholds(snap, current);
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
        return init;
      },
      (r) =>
        `snapshot ${settings.simulation.snapshotHz} Hz · telemetry every ${settings.simulation.telemetryIntervalS} s · ${r.topology.switches.length} switches`,
    );

    useEngineStore.setState({ status: 'ready' });
    return init;
  } catch (err) {
    useEngineStore.setState({ status: 'error', error: (err as Error).message });
    throw err;
  }
}

let settingsAttached = false;
function attachSettingsPersistence(): void {
  if (settingsAttached) return;
  settingsAttached = true;
  const k = requireKernel();
  k.unsubscribers.push(
    useSettingsStore.subscribe((state, prev) => {
      if (state.settings === prev.settings) return;
      applySettingsSideEffects(state.settings, prev.settings);
      void k.repo.saveSettings(state.settings);
    }),
  );
}

/**
 * Full boot (core + infrastructure). Used by the internal Engineering Preview; the shell runs
 * the two phases separately so the setup assistant can sit between them.
 */
export async function bootKernel(onProgress?: (steps: BootStep[]) => void): Promise<void> {
  await bootCore(onProgress);
  await startInfrastructure();
}

// ---- Setup, accounts and sessions -------------------------------------------------------------

export function currentAccount(): Account | null {
  return account;
}

export async function loadSetupDraft(): Promise<SetupDraft | null> {
  const res = await requireKernel().repo.loadSetupDraft();
  return res.value;
}

export function saveSetupDraft(draft: SetupDraft): Promise<void> {
  return requireKernel().repo.saveSetupDraft(draft);
}

export type SetupTask = 'settings' | 'account' | 'infra' | 'engine' | 'handover';

/**
 * Commits a completed setup: settings, administrator account and infrastructure specification
 * are persisted, the draft is discarded and the infrastructure phase of the boot starts.
 */
export async function completeSetup(
  data: SetupData,
  onTask?: (task: SetupTask, status: 'running' | 'done') => void,
): Promise<InitResult> {
  const { repo } = requireKernel();
  const step = async <T>(task: SetupTask, fn: () => Promise<T>): Promise<T> => {
    onTask?.(task, 'running');
    const r = await fn();
    onTask?.(task, 'done');
    return r;
  };
  const report = validateSetupInfra(data);
  if (!report.ok)
    throw new Error(report.issues.find((i) => i.severity === 'error')?.message ?? 'Invalid design');
  if (!data.admin.credential) throw new Error('Administrator credential missing');

  const settings = toSettings(data, useSettingsStore.getState().settings);
  await step('settings', async () => {
    await repo.saveSettings(settings);
    useSettingsStore.getState().replace(settings);
  });
  await step('account', async () => {
    account = accountSchema.parse({
      username: data.admin.username,
      displayName: data.admin.displayName,
      role: data.admin.role,
      credential: data.admin.credential,
      createdAt: new Date().toISOString(),
    });
    await repo.saveAccount(account);
  });
  await step('infra', async () => {
    await repo.store.delete('sim-state');
    await repo.saveInfra(buildSetupSpec(data));
  });
  const init = await step('engine', () => startInfrastructure());
  await step('handover', async () => {
    await repo.clearSetupDraft();
    await saveNow();
  });
  return init;
}

const failedLogins = { count: 0, until: 0 };

/** Remaining lock-out before another login attempt is accepted (ms). */
export function loginLockoutMs(): number {
  return Math.max(0, failedLogins.until - Date.now());
}

export type LoginResult =
  { ok: true; account: Account } | { ok: false; reason: 'invalid' | 'lockout'; waitMs: number };

/** Verifies credentials against the stored administrator (PBKDF2, constant-time compare). */
export async function authenticate(username: string, password: string): Promise<LoginResult> {
  const wait = loginLockoutMs();
  if (wait > 0) return { ok: false, reason: 'lockout', waitMs: wait };
  const acc = account;
  const ok =
    !!acc &&
    acc.username === username.trim().toLowerCase() &&
    (await verifyPassword(password, acc.credential));
  if (ok && acc) {
    failedLogins.count = 0;
    failedLogins.until = 0;
    return { ok: true, account: acc };
  }
  failedLogins.count++;
  const delay = loginBackoffMs(failedLogins.count);
  failedLogins.until = Date.now() + delay;
  return { ok: false, reason: 'invalid', waitMs: delay };
}

/** Wipes everything (settings, account, infrastructure, state) and restarts into setup. */
export async function resetAndReconfigure(): Promise<void> {
  await factoryReset();
}

// ---- Threshold monitoring ---------------------------------------------------------------------

function evaluateThresholds(snap: Snapshot, settings: Settings): void {
  const m = settings.monitoring;
  const topo = useEngineStore.getState().topology;
  const designIt = topo ? topo.racks.reduce((s, r) => s + r.designPeakW, 0) : 0;
  const temp = snap.cluster.gpuTempMax;
  const tempLevel = temp >= m.gpuTempCritC ? 'critical' : temp >= m.gpuTempWarnC ? 'warning' : null;
  const tempLimit = tempLevel === 'critical' ? m.gpuTempCritC : m.gpuTempWarnC;
  updateAlert(
    'gpu-temp',
    tempLevel,
    () =>
      tempLevel === 'critical'
        ? t('alert.gpuTemp.crit', { limit: `${tempLimit} °C` })
        : t('alert.gpuTemp.warn', { limit: `${tempLimit} °C` }),
    () => t('alert.gpuTemp.body', { value: `${temp.toFixed(1)} °C`, count: snap.cluster.throttledGpus }),
    temp < m.gpuTempWarnC - 2,
  );
  const hot = snap.halls.reduce<(typeof snap.halls)[number] | null>(
    (worst, h) => (!worst || h.supplyAirC > worst.supplyAirC ? h : worst),
    null,
  );
  updateAlert(
    'hall-supply',
    hot && hot.supplyAirC > m.hallSupplyWarnC ? 'warning' : null,
    () => t('alert.hallSupply', { limit: `${m.hallSupplyWarnC} °C` }),
    () =>
      t('alert.hallSupply.body', { hall: hot?.name ?? '', value: `${hot?.supplyAirC.toFixed(1) ?? '–'} °C` }),
    !hot || hot.supplyAirC < m.hallSupplyWarnC - 1,
  );
  // PUE is only meaningful with substantial IT load.
  const loaded = designIt > 0 && snap.facility.itPowerW > designIt * 0.3;
  updateAlert(
    'pue',
    loaded && snap.facility.pue > m.pueWarn ? 'warning' : null,
    () => t('alert.pue', { limit: m.pueWarn.toFixed(2) }),
    () =>
      t('alert.pue.body', {
        value: snap.facility.pue.toFixed(3),
        ambient: `${snap.facility.ambientC.toFixed(1)} °C`,
      }),
    !loaded || snap.facility.pue < m.pueWarn - 0.02,
  );
}

function updateAlert(
  id: string,
  level: 'warning' | 'critical' | null,
  title: () => string,
  body: () => string,
  cleared: boolean,
): void {
  const store = useAlertStore.getState();
  const active = store.alerts[id];
  if (level && (!active || active.level !== level)) {
    const alert = { id, level, title: title(), body: body(), since: Date.now() };
    store.set(id, alert);
    useNotificationStore
      .getState()
      .push({ severity: level, title: alert.title, body: alert.body, source: 'monitor' });
  } else if (active && level) {
    store.set(id, { ...active, body: body() });
  } else if (active && !level && cleared) {
    store.set(id, null);
    useNotificationStore
      .getState()
      .push({
        severity: 'notice',
        title: t('alert.cleared', { title: active.title }),
        body: body(),
        source: 'monitor',
      });
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
  const init = await client.init(spec, engineOptions(settings), controlFromSettings(settings));
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
          engineOptions(settings),
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
  const k = kernel;
  if (k) {
    if (k.autosaveTimer) clearInterval(k.autosaveTimer);
    k.autosaveTimer = null;
    for (const u of k.unsubscribers) u();
    k.client.dispose();
    await k.repo.factoryReset();
  } else {
    await (await openDocumentStore()).clear();
  }
  if (typeof location !== 'undefined') location.reload();
}

export function storageKind(): 'indexeddb' | 'memory' | null {
  return kernel?.repo.store.kind ?? null;
}

/** Direct engine control without touching persisted settings (e.g. accelerated cold boot). */
export async function controlEngine(control: ControlSettings): Promise<ControlSettings> {
  return requireKernel().client.control(control);
}
