/**
 * Key-value document storage on IndexedDB, with an in-memory fallback when IndexedDB is not
 * available (private browsing, blocked storage, tests). Every document is wrapped in an
 * envelope carrying its schema version so it can be migrated on load.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export const DB_NAME = 'safeton';
export const DB_VERSION = 1;

export type DocKey = 'settings' | 'infra' | 'sim-state' | 'meta' | 'account' | 'setup';

export interface StoredDoc<T = unknown> {
  key: DocKey;
  schemaVersion: number;
  savedAt: string;
  data: T;
}

export interface QuarantinedDoc {
  id: string;
  key: DocKey;
  reason: string;
  quarantinedAt: string;
  raw: unknown;
}

interface SafetonDB extends DBSchema {
  docs: { key: DocKey; value: StoredDoc };
  quarantine: { key: string; value: QuarantinedDoc };
}

export interface DocumentStore {
  readonly kind: 'indexeddb' | 'memory';
  get<T>(key: DocKey): Promise<StoredDoc<T> | undefined>;
  put<T>(key: DocKey, schemaVersion: number, data: T): Promise<void>;
  delete(key: DocKey): Promise<void>;
  quarantine(key: DocKey, raw: unknown, reason: string): Promise<void>;
  listQuarantine(): Promise<QuarantinedDoc[]>;
  clear(): Promise<void>;
}

class IdbDocumentStore implements DocumentStore {
  readonly kind = 'indexeddb' as const;
  constructor(private readonly db: IDBPDatabase<SafetonDB>) {}

  async get<T>(key: DocKey) {
    return (await this.db.get('docs', key)) as StoredDoc<T> | undefined;
  }
  async put<T>(key: DocKey, schemaVersion: number, data: T) {
    await this.db.put('docs', { key, schemaVersion, savedAt: new Date().toISOString(), data });
  }
  async delete(key: DocKey) {
    await this.db.delete('docs', key);
  }
  async quarantine(key: DocKey, raw: unknown, reason: string) {
    const id = `${key}-${Date.now()}`;
    try {
      await this.db.put('quarantine', { id, key, reason, quarantinedAt: new Date().toISOString(), raw });
    } catch {
      // Raw value may not be cloneable; keep the reason at least.
      await this.db.put('quarantine', {
        id,
        key,
        reason,
        quarantinedAt: new Date().toISOString(),
        raw: null,
      });
    }
    await this.db.delete('docs', key);
  }
  async listQuarantine() {
    return this.db.getAll('quarantine');
  }
  async clear() {
    await this.db.clear('docs');
    await this.db.clear('quarantine');
  }
}

export class MemoryDocumentStore implements DocumentStore {
  readonly kind = 'memory' as const;
  private docs = new Map<DocKey, StoredDoc>();
  private quarantined: QuarantinedDoc[] = [];

  async get<T>(key: DocKey) {
    return this.docs.get(key) as StoredDoc<T> | undefined;
  }
  async put<T>(key: DocKey, schemaVersion: number, data: T) {
    this.docs.set(key, { key, schemaVersion, savedAt: new Date().toISOString(), data });
  }
  async delete(key: DocKey) {
    this.docs.delete(key);
  }
  async quarantine(key: DocKey, raw: unknown, reason: string) {
    this.quarantined.push({
      id: `${key}-${Date.now()}`,
      key,
      reason,
      quarantinedAt: new Date().toISOString(),
      raw,
    });
    this.docs.delete(key);
  }
  async listQuarantine() {
    return [...this.quarantined];
  }
  async clear() {
    this.docs.clear();
    this.quarantined = [];
  }
}

export async function openDocumentStore(): Promise<DocumentStore> {
  if (typeof indexedDB === 'undefined') return new MemoryDocumentStore();
  try {
    const db = await openDB<SafetonDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore('docs', { keyPath: 'key' });
          database.createObjectStore('quarantine', { keyPath: 'id' });
        }
      },
      blocked() {
        // Another tab holds an older version open; it will be asked to close via versionchange.
      },
    });
    db.addEventListener('versionchange', () => db.close());
    return new IdbDocumentStore(db);
  } catch {
    return new MemoryDocumentStore();
  }
}
