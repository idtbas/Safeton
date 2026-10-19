/**
 * First-run setup: data model, per-step validation and a pure reducer.
 *
 * The wizard is a state machine over 13 steps. Every transition goes through `setupReducer`,
 * which validates the current step before advancing and records completed steps. The draft is
 * persisted after every change, so a reload resumes exactly where the operator left off.
 */
import { z } from 'zod';
import { part, tryPart } from '../../catalog';
import {
  TEMPLATES,
  designInfrastructure,
  validateInfra,
  type DesignInput,
  type InfraSpec,
  type ValidationIssue,
  type ValidationReport,
} from '../../engine';
import { credentialSchema, ROLES, type Role, type StoredCredential } from '../auth/credentials';
import { defaultSettings, settingsSchema, type Settings } from '../settings/schema';

export const SETUP_STEPS = [
  'welcome',
  'region',
  'admin',
  'system',
  'appearance',
  'profile',
  'hardware',
  'network',
  'site',
  'monitoring',
  'operations',
  'summary',
  'initialize',
] as const;
export type SetupStepId = (typeof SETUP_STEPS)[number];
export const SETUP_DRAFT_VERSION = 1;

export interface SetupData {
  region: Settings['region'];
  admin: { displayName: string; username: string; role: Role; credential: StoredCredential | null };
  system: { hostname: string; siteName: string; siteCode: string; infraName: string };
  appearance: Settings['appearance'];
  infra: { templateId: string; climateId: string; design: DesignInput };
  monitoring: {
    snapshotHz: number;
    telemetryIntervalS: number;
    gpuTempWarnC: number;
    gpuTempCritC: number;
    hallSupplyWarnC: number;
    pueWarn: number;
    minSeverity: Settings['notifications']['minSeverity'];
    toasts: boolean;
  };
  operations: {
    sessionTimeoutMin: number;
    lockScreen: boolean;
    confirmCritical: boolean;
    failureRateMultiplier: number;
    autoRemediation: boolean;
    seed: number;
    startMode: 'warm' | 'cold';
    bootMinCapacity: number;
    timeScale: number;
  };
}

export interface SetupDraft {
  version: number;
  /** Index into SETUP_STEPS of the step being shown. */
  current: number;
  /** Indices of steps that passed validation. */
  completed: number[];
  data: SetupData;
}

export const setupDraftSchema = z.object({
  version: z.literal(SETUP_DRAFT_VERSION),
  current: z
    .number()
    .int()
    .min(0)
    .max(SETUP_STEPS.length - 1),
  completed: z.array(
    z
      .number()
      .int()
      .min(0)
      .max(SETUP_STEPS.length - 1),
  ),
  data: z.object({
    region: settingsSchema.shape.region,
    admin: z.object({
      displayName: z.string(),
      username: z.string(),
      role: z.enum(ROLES),
      credential: credentialSchema.nullable(),
    }),
    system: z.object({
      hostname: z.string(),
      siteName: z.string(),
      siteCode: z.string(),
      infraName: z.string(),
    }),
    appearance: settingsSchema.shape.appearance,
    infra: z.object({
      templateId: z.string(),
      climateId: z.string(),
      design: z.custom<DesignInput>((v) => !!v && typeof v === 'object'),
    }),
    monitoring: z.object({
      snapshotHz: z.number(),
      telemetryIntervalS: z.number(),
      gpuTempWarnC: z.number(),
      gpuTempCritC: z.number(),
      hallSupplyWarnC: z.number(),
      pueWarn: z.number(),
      minSeverity: z.enum(['notice', 'warning', 'error', 'critical']),
      toasts: z.boolean(),
    }),
    operations: z.object({
      sessionTimeoutMin: z.number(),
      lockScreen: z.boolean(),
      confirmCritical: z.boolean(),
      failureRateMultiplier: z.number(),
      autoRemediation: z.boolean(),
      seed: z.number(),
      startMode: z.enum(['warm', 'cold']),
      bootMinCapacity: z.number(),
      timeScale: z.number(),
    }),
  }),
});

// ---- Defaults ----------------------------------------------------------------------------

function detectLocale(): Settings['region']['locale'] {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'de-DE';
  if (lang.startsWith('de')) return 'de-DE';
  if (lang === 'en-GB') return 'en-GB';
  return lang.startsWith('en') ? 'en-US' : 'de-DE';
}

function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

export function templateDesign(templateId: string): DesignInput {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[2]!;
  return t.input();
}

export function createDraft(): SetupDraft {
  const s = defaultSettings();
  const locale = detectLocale();
  const templateId = 'cluster-256';
  return {
    version: SETUP_DRAFT_VERSION,
    current: 0,
    completed: [],
    data: {
      region: {
        ...s.region,
        locale,
        timeZone: detectTimeZone(),
        hourCycle: locale === 'en-US' ? 'h12' : 'h23',
        temperatureUnit: locale === 'en-US' ? 'F' : 'C',
      },
      admin: { displayName: '', username: '', role: 'infrastructure-admin', credential: null },
      system: {
        hostname: 'safeton-ops-01',
        siteName: 'Frankfurt Campus',
        siteCode: 'FRA1',
        infraName: 'GPU Cluster 256',
      },
      appearance: { ...s.appearance },
      infra: { templateId, climateId: 'frankfurt', design: templateDesign(templateId) },
      monitoring: {
        snapshotHz: s.simulation.snapshotHz,
        telemetryIntervalS: s.simulation.telemetryIntervalS,
        gpuTempWarnC: s.monitoring.gpuTempWarnC,
        gpuTempCritC: s.monitoring.gpuTempCritC,
        hallSupplyWarnC: s.monitoring.hallSupplyWarnC,
        pueWarn: s.monitoring.pueWarn,
        minSeverity: s.notifications.minSeverity,
        toasts: s.notifications.toasts,
      },
      operations: {
        sessionTimeoutMin: s.security.sessionTimeoutMin,
        lockScreen: s.security.lockScreen,
        confirmCritical: s.security.confirmCritical,
        failureRateMultiplier: s.simulation.failureRateMultiplier,
        autoRemediation: s.simulation.autoRemediation,
        seed: s.simulation.seed,
        startMode: s.simulation.startMode,
        bootMinCapacity: s.simulation.bootMinCapacity,
        timeScale: s.simulation.timeScale,
      },
    },
  };
}

// ---- Validation ---------------------------------------------------------------------------

/** Field → i18n message key. Empty object = valid. */
export type StepErrors = Partial<Record<string, string>>;

export const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
export const USERNAME_RE = /^[a-z_][a-z0-9_.-]{1,31}$/;
export const SITE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/;
const RESERVED_USERNAMES = new Set(['root', 'daemon', 'bin', 'sys', 'nobody', 'system']);

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const range = (errors: StepErrors, field: string, v: number, min: number, max: number) => {
  if (!Number.isFinite(v) || v < min || v > max) errors[field] = 'validation.range';
};

export function validateDesignInput(d: DesignInput, errors: StepErrors = {}): StepErrors {
  const sys = d.compute.system;
  if (sys.kind === 'platform') {
    const p = tryPart('platform', sys.platformId);
    if (!p) errors['hardware.platform'] = 'validation.required';
    range(errors, 'hardware.nodesPerRack', sys.nodesPerRack, 1, 16);
    const o = sys.overrides ?? {};
    if (p) {
      const gpu = part('gpu', p.gpu.id);
      if (o.gpuPowerLimitW !== undefined)
        range(
          errors,
          'hardware.gpuPowerLimitW',
          o.gpuPowerLimitW,
          gpu.power.minPowerLimitW.v,
          gpu.power.tdpW.v,
        );
      if (o.psuCount !== undefined) range(errors, 'hardware.psuCount', o.psuCount, 1, 12);
      if (o.dimmCount !== undefined) range(errors, 'hardware.dimmCount', o.dimmCount, 0, p.dimmSlots);
      if (o.dataDriveCount !== undefined)
        range(errors, 'hardware.dataDriveCount', o.dataDriveCount, 0, p.dataDriveBays);
    }
  } else if (!tryPart('rack-system', sys.rackSystemId)) {
    errors['hardware.platform'] = 'validation.required';
  }
  range(errors, 'hardware.racks', d.compute.racks, 1, 4096);
  range(errors, 'hardware.halls', d.halls, 1, 16);
  range(errors, 'hardware.racksPerRow', d.racksPerRow, 1, 64);
  range(errors, 'hardware.pduPerFeed', d.compute.pdu.perFeed, 1, 8);
  range(errors, 'network.oversubscription', d.fabric.oversubscription, 1, 8);
  range(errors, 'site.energyPrice', d.site.energyPriceEurPerKWh, 0, 2);
  range(errors, 'site.airSupplyC', d.airSupplyC ?? 24, 18, 27);
  range(errors, 'site.warmWaterSupplyC', d.warmWaterSupplyC ?? 32, 25, 40);
  range(errors, 'site.storageCount', d.storage.count, 0, 512);
  return errors;
}

export function validateStep(step: SetupStepId, data: SetupData): StepErrors {
  const e: StepErrors = {};
  switch (step) {
    case 'region':
      if (!isValidTimeZone(data.region.timeZone)) e['region.timeZone'] = 'validation.timeZone';
      break;
    case 'admin':
      if (!data.admin.displayName.trim()) e['admin.displayName'] = 'validation.required';
      if (!USERNAME_RE.test(data.admin.username)) e['admin.username'] = 'validation.username';
      else if (RESERVED_USERNAMES.has(data.admin.username)) e['admin.username'] = 'validation.reserved';
      if (!data.admin.credential) e['admin.password'] = 'validation.passwordMissing';
      break;
    case 'system':
      if (!HOSTNAME_RE.test(data.system.hostname)) e['system.hostname'] = 'validation.hostname';
      if (!data.system.siteName.trim()) e['system.siteName'] = 'validation.required';
      if (!SITE_CODE_RE.test(data.system.siteCode)) e['system.siteCode'] = 'validation.siteCode';
      if (!data.system.infraName.trim()) e['system.infraName'] = 'validation.required';
      break;
    case 'profile':
      if (!TEMPLATES.some((t) => t.id === data.infra.templateId))
        e['profile.template'] = 'validation.required';
      break;
    case 'hardware':
    case 'network':
    case 'site': {
      const all = validateDesignInput(data.infra.design);
      for (const [k, v] of Object.entries(all)) if (k.startsWith(`${step}.`)) e[k] = v;
      break;
    }
    case 'monitoring': {
      const m = data.monitoring;
      range(e, 'monitoring.snapshotHz', m.snapshotHz, 1, 20);
      range(e, 'monitoring.telemetryIntervalS', m.telemetryIntervalS, 1, 60);
      range(e, 'monitoring.gpuTempWarnC', m.gpuTempWarnC, 50, 110);
      range(e, 'monitoring.pueWarn', m.pueWarn, 1, 3);
      range(e, 'monitoring.hallSupplyWarnC', m.hallSupplyWarnC, 15, 40);
      if (m.gpuTempCritC <= m.gpuTempWarnC) e['monitoring.gpuTempCritC'] = 'validation.critAboveWarn';
      break;
    }
    case 'operations': {
      const o = data.operations;
      range(e, 'operations.sessionTimeoutMin', o.sessionTimeoutMin, 0, 240);
      range(e, 'operations.failureRateMultiplier', o.failureRateMultiplier, 0, 1000);
      range(e, 'operations.bootMinCapacity', o.bootMinCapacity, 0, 1);
      range(e, 'operations.timeScale', o.timeScale, 0.1, 3600);
      if (!Number.isInteger(o.seed) || o.seed < 0 || o.seed > 4_294_967_295)
        e['operations.seed'] = 'validation.seed';
      break;
    }
    case 'summary': {
      for (const s of SETUP_STEPS.slice(1, 11)) Object.assign(e, validateStep(s, data));
      const report = validateSetupInfra(data);
      if (!report.ok) e['summary.infra'] = 'validation.infraErrors';
      break;
    }
    default:
      break;
  }
  return e;
}

// ---- Derivation ---------------------------------------------------------------------------

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'site';

/** Builds the full InfraSpec (facility sized around the IT design) from the setup data. */
export function buildSetupSpec(data: SetupData, start = new Date()): InfraSpec {
  const d = data.infra.design;
  return designInfrastructure({
    ...d,
    id: slug(`${data.system.siteCode}-${data.system.infraName}`),
    name: data.system.infraName,
    templateId: data.infra.templateId,
    site: { ...d.site, name: data.system.siteName, code: data.system.siteCode },
    simulationStart: new Date(Math.floor(start.getTime() / 60_000) * 60_000).toISOString(),
  });
}

let reportCache: { key: string; report: ValidationReport } | null = null;

/** validateInfra on the built spec, memoised on the design input. */
export function validateSetupInfra(data: SetupData): ValidationReport {
  const key = JSON.stringify([data.infra.design, data.system]);
  if (reportCache?.key === key) return reportCache.report;
  let report: ValidationReport;
  try {
    const errs = validateDesignInput(data.infra.design);
    if (Object.keys(errs).length > 0) {
      report = {
        ok: false,
        errors: 1,
        warnings: 0,
        issues: [
          {
            severity: 'error',
            code: 'DESIGN_OUT_OF_RANGE',
            path: Object.keys(errs)[0]!,
            message: 'Design parameters out of range',
          },
        ],
        topology: null,
        metrics: null,
      };
    } else {
      report = validateInfra(buildSetupSpec(data, new Date(Date.UTC(2026, 9, 19))));
    }
  } catch (err) {
    report = {
      ok: false,
      errors: 1,
      warnings: 0,
      issues: [{ severity: 'error', code: 'DESIGN_INVALID', path: '', message: (err as Error).message }],
      topology: null,
      metrics: null,
    };
  }
  reportCache = { key, report };
  return report;
}

/** Wizard step that owns the spec field an issue points to. */
export function stepForIssue(issue: ValidationIssue): SetupStepId {
  const p = issue.path;
  if (p.startsWith('fabric') || issue.code.startsWith('NIC_')) return 'network';
  if (p.startsWith('site') || p.startsWith('storage')) return 'site';
  if (/^halls\[\d+\]\.(air|liquid)/.test(p) && issue.code !== 'LIQUID_LOOP_MISSING') return 'site';
  if (p.startsWith('network.')) return 'network';
  return 'hardware';
}

/** Projects the setup onto the persisted settings document. */
export function toSettings(data: SetupData, base: Settings = defaultSettings()): Settings {
  return settingsSchema.parse({
    ...base,
    appearance: data.appearance,
    region: data.region,
    simulation: {
      ...base.simulation,
      seed: data.operations.seed,
      timeScale: data.operations.timeScale,
      snapshotHz: data.monitoring.snapshotHz,
      telemetryIntervalS: data.monitoring.telemetryIntervalS,
      failureRateMultiplier: data.operations.failureRateMultiplier,
      autoRemediation: data.operations.autoRemediation,
      startMode: data.operations.startMode,
      bootMinCapacity: data.operations.bootMinCapacity,
      defaultTemplate: data.infra.templateId,
    },
    monitoring: {
      gpuTempWarnC: data.monitoring.gpuTempWarnC,
      gpuTempCritC: data.monitoring.gpuTempCritC,
      hallSupplyWarnC: data.monitoring.hallSupplyWarnC,
      pueWarn: data.monitoring.pueWarn,
    },
    notifications: {
      ...base.notifications,
      minSeverity: data.monitoring.minSeverity,
      toasts: data.monitoring.toasts,
    },
    security: {
      sessionTimeoutMin: data.operations.sessionTimeoutMin,
      lockScreen: data.operations.lockScreen,
      confirmCritical: data.operations.confirmCritical,
    },
    system: {
      hostname: data.system.hostname,
      operator: data.admin.username,
      operatorName: data.admin.displayName,
      setupComplete: true,
    },
  });
}

// ---- Reducer ------------------------------------------------------------------------------

export type SetupAction =
  | { type: 'update'; update: (data: SetupData) => SetupData }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; step: number }
  | { type: 'selectTemplate'; templateId: string };

export interface SetupState {
  draft: SetupDraft;
  errors: StepErrors;
}

/** Highest step index the operator may jump to (every earlier step completed). */
export function reachableStep(draft: SetupDraft): number {
  let i = 0;
  while (i < SETUP_STEPS.length - 1 && draft.completed.includes(i)) i++;
  return i;
}

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  const { draft } = state;
  switch (action.type) {
    case 'update': {
      const data = action.update(draft.data);
      return { draft: { ...draft, data }, errors: {} };
    }
    case 'selectTemplate': {
      if (action.templateId === draft.data.infra.templateId) return state;
      const design = templateDesign(action.templateId);
      const t = TEMPLATES.find((x) => x.id === action.templateId);
      const data: SetupData = {
        ...draft.data,
        infra: { ...draft.data.infra, templateId: action.templateId, design },
        system: { ...draft.data.system, infraName: t?.name ?? draft.data.system.infraName },
      };
      // Changing the profile invalidates the detail steps that depend on it.
      const dependent = ['hardware', 'network', 'site', 'summary'].map((s) =>
        SETUP_STEPS.indexOf(s as SetupStepId),
      );
      return {
        draft: { ...draft, data, completed: draft.completed.filter((c) => !dependent.includes(c)) },
        errors: {},
      };
    }
    case 'next': {
      const step = SETUP_STEPS[draft.current]!;
      const errors = validateStep(step, draft.data);
      if (Object.keys(errors).length > 0) return { draft, errors };
      const completed = draft.completed.includes(draft.current)
        ? draft.completed
        : [...draft.completed, draft.current].sort((a, b) => a - b);
      return {
        draft: { ...draft, completed, current: Math.min(SETUP_STEPS.length - 1, draft.current + 1) },
        errors: {},
      };
    }
    case 'back':
      return { draft: { ...draft, current: Math.max(0, draft.current - 1) }, errors: {} };
    case 'goto':
      if (action.step < 0 || action.step > reachableStep(draft)) return state;
      return { draft: { ...draft, current: action.step }, errors: {} };
  }
}
