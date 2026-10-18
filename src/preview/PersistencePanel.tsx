import { Download, HardDrive, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { exportSystem, factoryReset, importSystem, resetSimulation, saveNow } from '../os/kernel';
import { useEngineStore } from '../os/engine/store';
import { useNotificationStore } from '../os/notifications/store';
import { Button, Dialog, KeyValue, Panel, fmt } from '../ui';

export function PersistencePanel() {
  const lastSaved = useEngineStore((s) => s.lastSavedAt);
  const saveError = useEngineStore((s) => s.saveError);
  const storage = useEngineStore((s) => s.storageKind);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirm, setConfirm] = useState<'reset' | 'factory' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const push = useNotificationStore((s) => s.push);

  const doExport = async () => {
    setBusy('export');
    try {
      const text = await exportSystem();
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `safeton-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      push({
        severity: 'notice',
        title: 'Export created',
        body: `${fmt.q(fmt.bytesGB(text.length / 1e9))} written`,
        source: 'kernel',
      });
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (file: File) => {
    setBusy('import');
    try {
      const res = await importSystem(await file.text());
      push({
        severity: res.ok ? 'notice' : 'error',
        title: res.ok ? 'Import complete' : 'Import rejected',
        body: res.message,
        source: 'kernel',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Persistence" icon={<HardDrive size={14} />}>
      <div className="pv-stack">
        <KeyValue
          items={[
            ['Backend', storage === 'indexeddb' ? 'IndexedDB (safeton v1)' : 'Volatile memory'],
            ['Last save', lastSaved ? fmt.clockTime(lastSaved) : '—'],
            [
              'Status',
              saveError ? <span style={{ color: 'var(--status-serious)' }}>{saveError}</span> : 'OK',
            ],
          ]}
        />
        <div className="pv-btn-row">
          <Button
            icon={<Save size={13} />}
            loading={busy === 'save'}
            onClick={() => {
              setBusy('save');
              void saveNow().finally(() => setBusy(null));
            }}
          >
            Save now
          </Button>
          <Button icon={<Download size={13} />} loading={busy === 'export'} onClick={() => void doExport()}>
            Export
          </Button>
          <Button
            icon={<Upload size={13} />}
            loading={busy === 'import'}
            onClick={() => fileRef.current?.click()}
          >
            Import
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="pv-btn-row">
          <Button icon={<RotateCcw size={13} />} onClick={() => setConfirm('reset')}>
            Reset simulation
          </Button>
          <Button variant="danger" icon={<Trash2 size={13} />} onClick={() => setConfirm('factory')}>
            Factory reset
          </Button>
        </div>
        <p className="sf-muted" style={{ fontSize: 'var(--fs-xs)' }}>
          State autosaves periodically and when the tab is hidden. Reload the page to verify restoration.
        </p>
      </div>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'factory' ? 'Factory reset' : 'Reset simulation'}
        description={
          confirm === 'factory'
            ? 'Deletes all stored settings, infrastructure and simulation state, then reloads.'
            : 'Discards simulation state and reloads the default infrastructure template. Settings are kept.'
        }
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const which = confirm;
                setConfirm(null);
                void (which === 'factory' ? factoryReset() : resetSimulation());
              }}
            >
              {confirm === 'factory' ? 'Erase everything' : 'Reset'}
            </Button>
          </>
        }
      />
    </Panel>
  );
}
