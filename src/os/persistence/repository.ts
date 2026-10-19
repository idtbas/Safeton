/**
 * Typed persistence repository: loads documents with migration and validation, quarantines
 * anything corrupt instead of crashing, and produces / consumes export bundles.
 */
import {
  INFRA_SPEC_VERSION,
  SIM_STATE_FORMAT,
  SIM_STATE_VERSION,
  validateInfra,
  type InfraSpec,
  type SimStateBlob,
} from '../../engine';
import { ACCOUNT_SCHEMA_VERSION, accountSchema, type Account } from '../auth/credentials';
import {
  SETTINGS_SCHEMA_VERSION,
  defaultSettings,
  migrateSettingsV1toV2,
  migrateSettingsV2toV3,
  settingsSchema,
  type Settings,
} from '../settings/schema';
import { SETUP_DRAFT_VERSION, setupDraftSchema, type SetupDraft } from '../setup/model';
import { decodeJson, encodeJson } from './codec';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportBundleSchema,
  infraSpecSchema,
  simStateEnvelopeSchema,
} from './schemas';
import type { DocKey, DocumentStore, StoredDoc } from './store';

/** Current schema version per document type. */
export const CURRENT_VERSIONS: Record<DocKey, number> = {
  settings: SETTINGS_SCHEMA_VERSION,
  infra: INFRA_SPEC_VERSION,
  'sim-state': SIM_STATE_VERSION,
  meta: 1,
  account: ACCOUNT_SCHEMA_VERSION,
  setup: SETUP_DRAFT_VERSION,
};

type Migration = (data: unknown) => unknown;
/**
 * Migrations keyed by document and source version: MIGRATIONS[key][v] upgrades v → v+1.
 * Version 1 is the first released schema; future schema changes add entries here.
 */
export const MIGRATIONS: Record<DocKey, Record<number, Migration>> = {
  settings: { 1: migrateSettingsV1toV2, 2: migrateSettingsV2toV3 },
  infra: {},
  'sim-state': {},
  meta: {},
  account: {},
  setup: {},
};

export function migrate(key: DocKey, doc: StoredDoc): unknown {
  const target = CURRENT_VERSIONS[key];
  let version = doc.schemaVersion;
  let data = doc.data;
  if (version > target)
    throw new Error(`${key} was written by a newer version (schema ${version} > ${target})`);
  while (version < target) {
    const step = MIGRATIONS[key][version];
    if (!step) throw new Error(`No migration for ${key} from schema ${version}`);
    data = step(data);
    version++;
  }
  return data;
}

export interface LoadResult<T> {
  value: T | null;
  /** Human-readable problems encountered (corrupt / quarantined documents). */
  issues: string[];
}

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  app: { version: string; settingsVersion?: number };
  settings?: Settings;
  account?: Account;
  infra?: InfraSpec;
  simState?: SimStateBlob;
}

export class Repository {
  constructor(readonly store: DocumentStore) {}

  private async loadDoc<T>(key: DocKey, parse: (data: unknown) => T): Promise<LoadResult<T>> {
    let doc: StoredDoc | undefined;
    try {
      doc = await this.store.get(key);
    } catch (err) {
      return { value: null, issues: [`Could not read ${key}: ${(err as Error).message}`] };
    }
    if (!doc) return { value: null, issues: [] };
    try {
      return { value: parse(migrate(key, doc)), issues: [] };
    } catch (err) {
      const reason = (err as Error).message.slice(0, 500);
      await this.store.quarantine(key, doc, reason).catch(() => undefined);
      return { value: null, issues: [`Stored ${key} was invalid and has been quarantined: ${reason}`] };
    }
  }

  loadSettings(): Promise<LoadResult<Settings>> {
    return this.loadDoc('settings', (d) => settingsSchema.parse(d));
  }

  saveSettings(settings: Settings): Promise<void> {
    return this.store.put('settings', CURRENT_VERSIONS.settings, settings);
  }

  loadInfra(): Promise<LoadResult<InfraSpec>> {
    return this.loadDoc('infra', (d) => infraSpecSchema.parse(d) as InfraSpec);
  }

  saveInfra(spec: InfraSpec): Promise<void> {
    return this.store.put('infra', CURRENT_VERSIONS.infra, spec);
  }

  loadSimState(): Promise<LoadResult<SimStateBlob>> {
    return this.loadDoc('sim-state', (d) => {
      const parsed = simStateEnvelopeSchema.parse(d);
      if (parsed.version !== SIM_STATE_VERSION)
        throw new Error(`Unsupported state version ${parsed.version}`);
      return d as SimStateBlob;
    });
  }

  saveSimState(state: SimStateBlob): Promise<void> {
    return this.store.put('sim-state', CURRENT_VERSIONS['sim-state'], state);
  }

  loadAccount(): Promise<LoadResult<Account>> {
    return this.loadDoc('account', (d) => accountSchema.parse(d));
  }

  saveAccount(account: Account): Promise<void> {
    return this.store.put('account', CURRENT_VERSIONS.account, accountSchema.parse(account));
  }

  loadSetupDraft(): Promise<LoadResult<SetupDraft>> {
    return this.loadDoc('setup', (d) => setupDraftSchema.parse(d) as SetupDraft);
  }

  saveSetupDraft(draft: SetupDraft): Promise<void> {
    return this.store.put('setup', CURRENT_VERSIONS.setup, draft);
  }

  clearSetupDraft(): Promise<void> {
    return this.store.delete('setup');
  }

  async clearSimulation(): Promise<void> {
    await this.store.delete('sim-state');
    await this.store.delete('infra');
  }

  async factoryReset(): Promise<void> {
    await this.store.clear();
  }

  async exportBundle(appVersion: string, simState: SimStateBlob | null): Promise<string> {
    const settings = (await this.loadSettings()).value ?? defaultSettings();
    const infra = (await this.loadInfra()).value;
    const account = (await this.loadAccount()).value;
    const bundle: ExportBundle = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      app: { version: appVersion, settingsVersion: SETTINGS_SCHEMA_VERSION },
      settings,
      ...(account ? { account } : {}),
      ...(infra ? { infra } : {}),
      ...(simState ? { simState } : {}),
    };
    return encodeJson(bundle);
  }

  /** Parses and validates an export file. Does not write anything. */
  parseBundle(text: string): ExportBundle {
    let raw: unknown;
    try {
      raw = decodeJson(text);
    } catch (err) {
      throw new Error(`Not a valid Safeton export (JSON): ${(err as Error).message}`, { cause: err });
    }
    const envelope = exportBundleSchema.safeParse(raw);
    if (!envelope.success) throw new Error('Not a Safeton export file (missing or wrong format header)');
    if (envelope.data.version > EXPORT_VERSION)
      throw new Error(`Export version ${envelope.data.version} is newer than this system supports`);
    const out: ExportBundle = {
      format: EXPORT_FORMAT,
      version: envelope.data.version,
      exportedAt: envelope.data.exportedAt,
      app: { version: String(envelope.data.app.version) },
    };
    if (envelope.data.settings !== undefined) {
      // Exports from older versions carry older settings; migrate via the settings migrations.
      const migrated = migrate('settings', {
        key: 'settings',
        schemaVersion: Number((envelope.data.app as { settingsVersion?: number }).settingsVersion ?? 1),
        savedAt: '',
        data: envelope.data.settings,
      });
      out.settings = settingsSchema.parse(migrated);
    }
    if (envelope.data.account !== undefined) out.account = accountSchema.parse(envelope.data.account);
    if (envelope.data.infra !== undefined) {
      const spec = infraSpecSchema.parse(envelope.data.infra) as InfraSpec;
      const report = validateInfra(spec);
      if (!report.ok)
        throw new Error(
          `Imported infrastructure has ${report.errors} validation error(s): ${report.issues[0]?.message ?? ''}`,
        );
      out.infra = spec;
    }
    if (envelope.data.simState !== undefined) {
      const st = simStateEnvelopeSchema.parse(envelope.data.simState);
      if (st.format !== SIM_STATE_FORMAT || st.version !== SIM_STATE_VERSION)
        throw new Error('Unsupported simulation state in export');
      out.simState = envelope.data.simState as SimStateBlob;
    }
    return out;
  }

  async importBundle(bundle: ExportBundle): Promise<void> {
    if (bundle.settings) await this.saveSettings(bundle.settings);
    if (bundle.account) await this.saveAccount(bundle.account);
    if (bundle.infra) await this.saveInfra(bundle.infra);
    if (bundle.simState) await this.saveSimState(bundle.simState);
    else if (bundle.infra) await this.store.delete('sim-state');
  }
}
