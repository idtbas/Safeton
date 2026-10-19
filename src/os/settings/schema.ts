/**
 * System settings schema. Every field has a default, so partially stored or older settings
 * documents always parse into a complete, valid settings object.
 */
import { z } from 'zod';

export const SETTINGS_SCHEMA_VERSION = 2;

export const ACCENTS = {
  cyan: { hue: 195, label: 'Cyan' },
  blue: { hue: 235, label: 'Cobalt' },
  violet: { hue: 285, label: 'Violet' },
  green: { hue: 155, label: 'Emerald' },
  amber: { hue: 70, label: 'Amber' },
  graphite: { hue: 250, label: 'Graphite' },
} as const;
export type AccentName = keyof typeof ACCENTS;

export const settingsSchema = z.object({
  appearance: z
    .object({
      theme: z.enum(['dark', 'light', 'system']).default('dark'),
      accent: z.enum(Object.keys(ACCENTS) as [AccentName, ...AccentName[]]).default('cyan'),
      density: z.enum(['compact', 'comfortable']).default('compact'),
      fontScale: z.number().min(0.85).max(1.25).default(1),
      reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
    })
    .prefault({}),
  region: z
    .object({
      locale: z.enum(['de-DE', 'en-US', 'en-GB']).default('de-DE'),
      timeZone: z.string().default('Europe/Berlin'),
      temperatureUnit: z.enum(['C', 'F']).default('C'),
      hourCycle: z.enum(['h23', 'h12']).default('h23'),
    })
    .prefault({}),
  simulation: z
    .object({
      seed: z.number().int().min(0).max(4_294_967_295).default(20261019),
      timeScale: z.number().min(0.1).max(3600).default(10),
      snapshotHz: z.number().min(1).max(20).default(4),
      failureRateMultiplier: z.number().min(0).max(1000).default(1),
      autoRemediation: z.boolean().default(true),
      autoSaveIntervalS: z.number().int().min(5).max(600).default(20),
      startRunning: z.boolean().default(true),
      defaultTemplate: z.string().default('cluster-256'),
      /** v2: global telemetry sampling interval (simulated seconds). */
      telemetryIntervalS: z.number().int().min(1).max(60).default(5),
      /** v2: warm = nodes already running; cold = every node powers on through POST at boot. */
      startMode: z.enum(['warm', 'cold']).default('warm'),
      /** v2: fraction of nodes that must be online before a cold boot hands over to login. */
      bootMinCapacity: z.number().min(0).max(1).default(0.9),
    })
    .prefault({}),
  /** v2: alert thresholds evaluated by the kernel against live telemetry. */
  monitoring: z
    .object({
      gpuTempWarnC: z.number().min(50).max(110).default(85),
      gpuTempCritC: z.number().min(50).max(120).default(90),
      hallSupplyWarnC: z.number().min(15).max(40).default(27),
      pueWarn: z.number().min(1).max(3).default(1.4),
    })
    .prefault({}),
  /** v2: session and administrative safeguards. */
  security: z
    .object({
      /** Minutes of inactivity before the session locks (0 = never). */
      sessionTimeoutMin: z.number().int().min(0).max(240).default(30),
      lockScreen: z.boolean().default(true),
      confirmCritical: z.boolean().default(true),
    })
    .prefault({}),
  notifications: z
    .object({
      minSeverity: z.enum(['notice', 'warning', 'error', 'critical']).default('warning'),
      toasts: z.boolean().default(true),
      doNotDisturb: z.boolean().default(false),
    })
    .prefault({}),
  windows: z
    .object({
      snapToEdges: z.boolean().default(true),
      animate: z.boolean().default(true),
    })
    .prefault({}),
  system: z
    .object({
      hostname: z.string().min(1).max(63).default('safeton-ops-01'),
      operator: z.string().min(1).max(64).default('admin'),
      /** v2: display name of the administrator configured during setup. */
      operatorName: z.string().max(80).default(''),
      setupComplete: z.boolean().default(false),
    })
    .prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;

/**
 * v1 → v2: adds monitoring thresholds, security options, telemetry interval, start mode and the
 * operator display name. Existing values are kept; new sections receive their defaults.
 */
export function migrateSettingsV1toV2(data: unknown): unknown {
  const d = (data ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return {
    ...d,
    simulation: { telemetryIntervalS: 5, startMode: 'warm', bootMinCapacity: 0.9, ...d.simulation },
    monitoring: { gpuTempWarnC: 85, gpuTempCritC: 90, hallSupplyWarnC: 27, pueWarn: 1.4, ...d.monitoring },
    security: { sessionTimeoutMin: 30, lockScreen: true, confirmCritical: true, ...d.security },
    system: { operatorName: '', ...d.system },
  };
}

export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type SettingsPatch = DeepPartial<Settings>;

/** Applies a partial update and re-validates. Throws a ZodError on invalid values. */
export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const merged: Record<string, unknown> = { ...current };
  for (const [section, values] of Object.entries(patch)) {
    merged[section] = {
      ...(current as Record<string, Record<string, unknown>>)[section],
      ...(values as object),
    };
  }
  return settingsSchema.parse(merged);
}
