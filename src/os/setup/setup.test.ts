import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateInfra } from '../../engine';
import { hashPassword } from '../auth/credentials';
import { Repository } from '../persistence/repository';
import { MemoryDocumentStore, openDocumentStore } from '../persistence/store';
import { settingsSchema } from '../settings/schema';
import {
  SETUP_STEPS,
  buildSetupSpec,
  createDraft,
  reachableStep,
  setupReducer,
  stepForIssue,
  toSettings,
  validateSetupInfra,
  validateStep,
  type SetupData,
  type SetupState,
  type SetupStepId,
} from './model';

const idx = (s: SetupStepId) => SETUP_STEPS.indexOf(s);

async function completeData(): Promise<SetupData> {
  const d = createDraft().data;
  return {
    ...d,
    admin: {
      displayName: 'Ada Lovelace',
      username: 'ada',
      role: 'infrastructure-admin',
      credential: await hashPassword('Correct-Horse-42!', 1000),
    },
    system: {
      hostname: 'fra1-ops-01',
      siteName: 'Frankfurt Campus',
      siteCode: 'FRA1',
      infraName: 'GPU Cluster',
    },
  };
}

/** Advances through every step up to (excluding) `until`. */
function advance(state: SetupState, until: SetupStepId): SetupState {
  let s = state;
  while (SETUP_STEPS[s.draft.current] !== until) {
    const before = s.draft.current;
    s = setupReducer(s, { type: 'next' });
    if (s.draft.current === before)
      throw new Error(`blocked at ${SETUP_STEPS[before]}: ${JSON.stringify(s.errors)}`);
  }
  return s;
}

describe('setup validation', () => {
  it('validates administrator, hostname and site code', () => {
    const d = createDraft().data;
    expect(validateStep('admin', d)).toMatchObject({
      'admin.displayName': 'validation.required',
      'admin.username': 'validation.username',
      'admin.password': 'validation.passwordMissing',
    });
    expect(validateStep('admin', { ...d, admin: { ...d.admin, username: 'root' } })['admin.username']).toBe(
      'validation.reserved',
    );
    const sys = (patch: Partial<SetupData['system']>) =>
      validateStep('system', { ...d, system: { ...d.system, ...patch } });
    expect(sys({ hostname: 'Bad_Host' })['system.hostname']).toBe('validation.hostname');
    expect(sys({ hostname: '-leading' })['system.hostname']).toBe('validation.hostname');
    expect(sys({ hostname: 'a'.repeat(64) })['system.hostname']).toBe('validation.hostname');
    expect(sys({ hostname: 'ops-01.fra1.example' })).toEqual({});
    expect(sys({ siteCode: 'fra 1' })['system.siteCode']).toBe('validation.siteCode');
  });

  it('requires the critical GPU threshold above the warning threshold', () => {
    const d = createDraft().data;
    const e = validateStep('monitoring', { ...d, monitoring: { ...d.monitoring, gpuTempCritC: 80 } });
    expect(e['monitoring.gpuTempCritC']).toBe('validation.critAboveWarn');
  });

  it('flags out-of-range design parameters on the owning step', () => {
    const d = createDraft().data;
    const design = { ...d.infra.design, compute: { ...d.infra.design.compute, racks: 0 } };
    expect(validateStep('hardware', { ...d, infra: { ...d.infra, design } })['hardware.racks']).toBe(
      'validation.range',
    );
    expect(validateStep('network', { ...d, infra: { ...d.infra, design } })).toEqual({});
  });

  it('every template design validates without errors', () => {
    for (const s of ['single-server', 'gpu-rack', 'cluster-256', 'enterprise-4096', 'supercomputer-nvl72']) {
      const st = setupReducer(
        { draft: createDraft(), errors: {} },
        { type: 'selectTemplate', templateId: s },
      );
      expect(validateSetupInfra(st.draft.data).errors, s).toBe(0);
    }
  });
});

describe('setup reducer', () => {
  it('blocks on invalid steps and records completed steps', async () => {
    let s: SetupState = { draft: createDraft(), errors: {} };
    s = setupReducer(s, { type: 'next' });
    s = setupReducer(s, { type: 'next' });
    expect(SETUP_STEPS[s.draft.current]).toBe('admin');
    const blocked = setupReducer(s, { type: 'next' });
    expect(blocked.draft.current).toBe(idx('admin'));
    expect(Object.keys(blocked.errors)).toContain('admin.username');

    const data = await completeData();
    s = setupReducer(s, { type: 'update', update: () => data });
    s = advance(s, 'summary');
    expect(s.draft.completed).toEqual(SETUP_STEPS.slice(0, idx('summary')).map((_, i) => i));
    expect(reachableStep(s.draft)).toBe(idx('summary'));
  });

  it('only jumps to reachable steps', () => {
    const s: SetupState = { draft: createDraft(), errors: {} };
    expect(setupReducer(s, { type: 'goto', step: idx('summary') })).toBe(s);
    const after = setupReducer(s, { type: 'next' });
    expect(setupReducer(after, { type: 'goto', step: 0 }).draft.current).toBe(0);
  });

  it('changing the profile resets the design and un-completes dependent steps', async () => {
    let s: SetupState = { draft: { ...createDraft(), data: await completeData() }, errors: {} };
    s = advance(s, 'summary');
    s = setupReducer(s, { type: 'goto', step: idx('profile') });
    s = setupReducer(s, { type: 'selectTemplate', templateId: 'single-server' });
    expect(s.draft.data.infra.design.compute.racks).toBe(1);
    expect(s.draft.data.infra.climateId).toBe('munich');
    for (const step of ['hardware', 'network', 'site', 'summary'] as const)
      expect(s.draft.completed).not.toContain(idx(step));
    expect(reachableStep(s.draft)).toBe(idx('hardware'));
  });

  it('blocks the summary while the engineering validation reports errors', async () => {
    const data = await completeData();
    const sys = data.infra.design.compute.system;
    if (sys.kind !== 'platform') throw new Error('expected platform');
    const bad: SetupData = {
      ...data,
      infra: {
        ...data.infra,
        design: {
          ...data.infra.design,
          compute: { ...data.infra.design.compute, system: { ...sys, nodesPerRack: 8 } },
        },
      },
    };
    const report = validateSetupInfra(bad);
    expect(report.ok).toBe(false);
    const issue = report.issues.find((i) => i.severity === 'error')!;
    expect(stepForIssue(issue)).toBe('hardware');
    expect(validateStep('summary', bad)['summary.infra']).toBe('validation.infraErrors');

    let s: SetupState = { draft: { ...createDraft(), data: bad }, errors: {} };
    s = advance(s, 'summary');
    const blocked = setupReducer(s, { type: 'next' });
    expect(blocked.draft.current).toBe(idx('summary'));
    expect(blocked.errors['summary.infra']).toBe('validation.infraErrors');

    s = setupReducer({ draft: { ...s.draft, data }, errors: {} }, { type: 'next' });
    expect(SETUP_STEPS[s.draft.current]).toBe('initialize');
  });
});

describe('setup persistence and projection', () => {
  beforeEach(async () => {
    await (await openDocumentStore()).clear();
  });

  it('resumes a draft after a reload at the step where it was left', async () => {
    let s: SetupState = { draft: { ...createDraft(), data: await completeData() }, errors: {} };
    s = advance(s, 'network');
    s = setupReducer(s, {
      type: 'update',
      update: (d) => ({ ...d, infra: { ...d.infra, design: { ...d.infra.design, halls: 2 } } }),
    });
    await new Repository(await openDocumentStore()).saveSetupDraft(s.draft);

    // "Reload": a fresh store connection and repository.
    const loaded = (await new Repository(await openDocumentStore()).loadSetupDraft()).value!;
    expect(loaded).toEqual(s.draft);
    expect(SETUP_STEPS[loaded.current]).toBe('network');
    expect(loaded.data.infra.design.halls).toBe(2);
    const resumed = advance({ draft: loaded, errors: {} }, 'summary');
    expect(SETUP_STEPS[resumed.draft.current]).toBe('summary');
  });

  it('quarantines a corrupt draft instead of failing', async () => {
    const store = new MemoryDocumentStore();
    await store.put('setup', 1, { current: 'nope' });
    const res = await new Repository(store).loadSetupDraft();
    expect(res.value).toBeNull();
    expect(res.issues[0]).toMatch(/quarantined/);
  });

  it('projects the setup onto valid settings and a valid infrastructure', async () => {
    const data = await completeData();
    data.operations.startMode = 'cold';
    data.monitoring.telemetryIntervalS = 10;
    const settings = toSettings(data);
    expect(settingsSchema.parse(settings)).toEqual(settings);
    expect(settings.system).toMatchObject({
      setupComplete: true,
      operator: 'ada',
      operatorName: 'Ada Lovelace',
    });
    expect(settings.simulation).toMatchObject({ startMode: 'cold', telemetryIntervalS: 10 });
    const spec = buildSetupSpec(data, new Date('2026-10-19T08:15:42Z'));
    expect(spec.site).toMatchObject({ name: 'Frankfurt Campus', code: 'FRA1' });
    expect(spec.simulationStart).toBe('2026-10-19T08:15:00.000Z');
    expect(spec.id).toBe('fra1-gpu-cluster');
    expect(validateInfra(spec).ok).toBe(true);
  });
});
