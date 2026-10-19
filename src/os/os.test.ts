import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Simulation, buildTemplate } from '../engine';
import { decodeJson, encodeJson } from './persistence/codec';
import { MIGRATIONS, Repository, migrate } from './persistence/repository';
import { MemoryDocumentStore, openDocumentStore } from './persistence/store';
import { SETTINGS_SCHEMA_VERSION, defaultSettings, mergeSettings, settingsSchema } from './settings/schema';
import { clampBounds, useWindowStore } from './windows/store';
import { useNotificationStore } from './notifications/store';

describe('settings schema', () => {
  it('fills every field from defaults', () => {
    const s = defaultSettings();
    expect(s.appearance.theme).toBe('dark');
    expect(s.simulation.seed).toBeTypeOf('number');
    expect(settingsSchema.parse({ appearance: { theme: 'light' } }).appearance.accent).toBe('cyan');
  });

  it('validates patches', () => {
    const s = defaultSettings();
    expect(mergeSettings(s, { simulation: { timeScale: 60 } }).simulation.timeScale).toBe(60);
    expect(() => mergeSettings(s, { simulation: { timeScale: -1 } })).toThrow();
  });
});

describe('codec', () => {
  it('round-trips typed arrays through JSON', () => {
    const value = { a: new Float32Array([1.5, -2, 3]), b: { c: new Uint16Array([7, 65535]) }, d: 'x' };
    const back = decodeJson(encodeJson(value)) as typeof value;
    expect(back.a).toBeInstanceOf(Float32Array);
    expect(Array.from(back.a)).toEqual([1.5, -2, 3]);
    expect(Array.from(back.b.c)).toEqual([7, 65535]);
    expect(back.d).toBe('x');
  });
});

describe('persistence repository', () => {
  beforeEach(async () => {
    const store = await openDocumentStore();
    await store.clear();
  });

  it('uses IndexedDB when available', async () => {
    expect((await openDocumentStore()).kind).toBe('indexeddb');
  });

  it('round-trips settings and simulation state', async () => {
    const repo = new Repository(await openDocumentStore());
    const settings = mergeSettings(defaultSettings(), { appearance: { theme: 'light' } });
    await repo.saveSettings(settings);
    expect((await repo.loadSettings()).value?.appearance.theme).toBe('light');

    const sim = new Simulation(buildTemplate('gpu-rack'), { seed: 5 });
    sim.step(120);
    await repo.saveSimState(sim.serialize());
    const loaded = (await repo.loadSimState()).value!;
    const restored = Simulation.restore(loaded);
    expect(restored.stateHash()).toBe(sim.stateHash());
  });

  it('quarantines corrupt documents instead of failing', async () => {
    const store = await openDocumentStore();
    await store.put('settings', 1, { appearance: { theme: 'neon' } });
    await store.put('sim-state', 1, { format: 'garbage' });
    const repo = new Repository(store);
    const s = await repo.loadSettings();
    expect(s.value).toBeNull();
    expect(s.issues[0]).toMatch(/quarantined/);
    expect((await repo.loadSimState()).value).toBeNull();
    expect((await store.listQuarantine()).length).toBe(2);
    expect(await store.get('settings')).toBeUndefined();
  });

  it('refuses documents from a newer schema and applies registered migrations', async () => {
    expect(() => migrate('settings', { key: 'settings', schemaVersion: 99, savedAt: '', data: {} })).toThrow(
      /newer/,
    );
    MIGRATIONS.meta[0] = (d) => ({ ...(d as object), migrated: true });
    expect(migrate('meta', { key: 'meta', schemaVersion: 0, savedAt: '', data: { a: 1 } })).toEqual({
      a: 1,
      migrated: true,
    });
    delete MIGRATIONS.meta[0];
  });

  it('exports and re-imports a validated bundle', async () => {
    const repo = new Repository(new MemoryDocumentStore());
    const spec = buildTemplate('cluster-256');
    await repo.saveInfra(spec);
    const sim = new Simulation(spec, { seed: 1 });
    sim.step(30);
    const text = await repo.exportBundle('test', sim.serialize());
    const bundle = repo.parseBundle(text);
    expect(bundle.infra?.id).toBe('cluster-256');
    expect(Simulation.restore(bundle.simState!).stateHash()).toBe(sim.stateHash());
    expect(() => repo.parseBundle('{"hello":1}')).toThrow(/Not a Safeton export/);
    expect(() => repo.parseBundle('not json')).toThrow(/JSON/);
  });
});

describe('window manager', () => {
  beforeEach(() => {
    useWindowStore.getState().closeAll();
    useWindowStore.getState().setViewport(1200, 800);
  });

  it('opens, focuses and stacks windows', () => {
    const wm = useWindowStore.getState();
    const a = wm.open('a', { title: 'A' });
    const b = useWindowStore.getState().open('b', { title: 'B' });
    let s = useWindowStore.getState();
    expect(s.focusedId).toBe(b);
    expect(s.windows[b]!.z).toBeGreaterThan(s.windows[a]!.z);
    s.focus(a);
    s = useWindowStore.getState();
    expect(s.focusedId).toBe(a);
    expect(s.windows[a]!.z).toBeGreaterThan(s.windows[b]!.z);
  });

  it('reuses singleton windows', () => {
    const wm = useWindowStore.getState();
    const a = wm.open('settings', { singleton: true });
    const b = useWindowStore.getState().open('settings', { singleton: true });
    expect(a).toBe(b);
    expect(useWindowStore.getState().order.length).toBe(1);
  });

  it('keeps title bars reachable and respects minimum sizes', () => {
    const id = useWindowStore.getState().open('a', { size: { w: 400, h: 300 }, minSize: { w: 300, h: 200 } });
    useWindowStore.getState().move(id, 5000, -400);
    let w = useWindowStore.getState().windows[id]!;
    expect(w.x).toBeLessThanOrEqual(1200 - 96);
    expect(w.y).toBe(0);
    useWindowStore.getState().resize(id, { w: 10, h: 10 });
    w = useWindowStore.getState().windows[id]!;
    expect(w.w).toBe(300);
    expect(w.h).toBe(200);
    expect(clampBounds({ x: -1000, y: 0, w: 400, h: 300 }, { w: 1200, h: 800 }, { w: 100, h: 100 }).x).toBe(
      96 - 400,
    );
  });

  it('maximises and restores, minimises and refocuses', () => {
    const a = useWindowStore.getState().open('a', { size: { w: 400, h: 300 } });
    const b = useWindowStore.getState().open('b', { size: { w: 400, h: 300 } });
    useWindowStore.getState().toggleMaximize(b);
    let w = useWindowStore.getState().windows[b]!;
    expect([w.x, w.y, w.w, w.h]).toEqual([0, 0, 1200, 800]);
    useWindowStore.getState().toggleMaximize(b);
    expect(useWindowStore.getState().windows[b]!.w).toBe(400);
    useWindowStore.getState().minimize(b);
    expect(useWindowStore.getState().focusedId).toBe(a);
    useWindowStore.getState().close(a);
    w = useWindowStore.getState().windows[b]!;
    expect(w.minimized).toBe(true);
    expect(useWindowStore.getState().order).toEqual([b]);
  });
});

describe('notifications', () => {
  it('filters toasts by severity and do-not-disturb but keeps the history', () => {
    const n = useNotificationStore.getState();
    n.clear();
    n.configure({ minToastSeverity: 'warning', toastsEnabled: true, doNotDisturb: false });
    n.push({ severity: 'info', title: 'x', body: '' });
    n.push({ severity: 'error', title: 'y', body: '' });
    let s = useNotificationStore.getState();
    expect(s.items.length).toBe(2);
    expect(s.toasts.length).toBe(1);
    s.configure({ doNotDisturb: true });
    s.push({ severity: 'error', title: 'z', body: '' });
    s.push({ severity: 'critical', title: 'c', body: '' });
    s = useNotificationStore.getState();
    expect(s.toasts.length).toBe(2);
    s.markAllRead();
    expect(useNotificationStore.getState().items.every((i) => i.read)).toBe(true);
  });
});

describe('settings migration v1 → v2', () => {
  it('upgrades a stored v1 document, keeping existing values', async () => {
    const store = new MemoryDocumentStore();
    const v1 = {
      appearance: { theme: 'light', accent: 'violet' },
      region: { locale: 'en-GB' },
      simulation: { seed: 7, timeScale: 60 },
      system: { hostname: 'legacy-01', operator: 'ops', setupComplete: true },
    };
    await store.put('settings', 1, v1);
    const { value, issues } = await new Repository(store).loadSettings();
    expect(issues).toEqual([]);
    expect(value!.appearance).toMatchObject({ theme: 'light', accent: 'violet' });
    expect(value!.simulation).toMatchObject({
      seed: 7,
      timeScale: 60,
      telemetryIntervalS: 5,
      startMode: 'warm',
    });
    expect(value!.monitoring).toEqual({
      gpuTempWarnC: 85,
      gpuTempCritC: 90,
      hallSupplyWarnC: 27,
      pueWarn: 1.4,
    });
    expect(value!.security).toEqual({ sessionTimeoutMin: 30, lockScreen: true, confirmCritical: true });
    expect(value!.system).toMatchObject({ hostname: 'legacy-01', setupComplete: true, operatorName: '' });
  });

  it('upgrades v2 → v3 with the desktop defaults', async () => {
    const store = new MemoryDocumentStore();
    await store.put('settings', 2, { appearance: { theme: 'light' }, system: { setupComplete: true } });
    const { value } = await new Repository(store).loadSettings();
    expect(value!.appearance.theme).toBe('light');
    expect(value!.desktop).toMatchObject({ wallpaper: 'nebula', showIcons: true, dockMagnify: true });
    expect(value!.desktop.dockApps).toContain('settings');
  });

  it('registers a migration for every settings version below the current one', () => {
    for (let v = 1; v < SETTINGS_SCHEMA_VERSION; v++) expect(MIGRATIONS.settings[v]).toBeTypeOf('function');
  });

  it('writes settings with the current schema version', async () => {
    const store = new MemoryDocumentStore();
    await new Repository(store).saveSettings(defaultSettings());
    expect((await store.get('settings'))!.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });
});
