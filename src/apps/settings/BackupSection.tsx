/**
 * Backup and reset: save, export / import the complete system, reset the simulation, and
 * reset & reconfigure the whole system.
 */
import { Download, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { exportSystem, importSystem, resetAndReconfigure, resetSimulation, saveNow } from '../../os/kernel';
import { useNotificationStore } from '../../os/notifications/store';
import { Button, Dialog, KeyValue, fmt } from '../../ui';

export function BackupSection() {
  const t = useT();
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
        title: t('backup.exported'),
        body: fmt.q(fmt.bytesGB(text.length / 1e9)),
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
        title: res.ok ? t('backup.imported') : t('backup.importRejected'),
        body: res.message,
        source: 'kernel',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <section className="st-group">
        <h3 className="st-group__title">{t('backup.state')}</h3>
        <div className="st-group__box">
          <div className="st-pad">
            <KeyValue
              items={[
                [
                  t('backup.backend'),
                  storage === 'indexeddb' ? 'IndexedDB (safeton v1)' : t('backup.volatile'),
                ],
                [t('backup.lastSave'), lastSaved ? fmt.dateTime(lastSaved) : '—'],
                [
                  t('backup.status'),
                  saveError ? <span style={{ color: 'var(--status-serious)' }}>{saveError}</span> : 'OK',
                ],
              ]}
            />
          </div>
          <div className="st-row">
            <div className="st-row__text">
              <div className="st-row__label">{t('backup.saveNow')}</div>
              <div className="st-row__desc">{t('backup.saveDesc')}</div>
            </div>
            <div className="st-row__control">
              <Button
                size="sm"
                icon={<Save size={13} />}
                loading={busy === 'save'}
                onClick={() => {
                  setBusy('save');
                  void saveNow().finally(() => setBusy(null));
                }}
              >
                {t('backup.saveNow')}
              </Button>
            </div>
          </div>
          <div className="st-row">
            <div className="st-row__text">
              <div className="st-row__label">{t('backup.exportImport')}</div>
              <div className="st-row__desc">{t('backup.exportDesc')}</div>
            </div>
            <div className="st-row__control st-inline">
              <Button
                size="sm"
                icon={<Download size={13} />}
                loading={busy === 'export'}
                onClick={() => void doExport()}
              >
                {t('backup.export')}
              </Button>
              <Button
                size="sm"
                icon={<Upload size={13} />}
                loading={busy === 'import'}
                onClick={() => fileRef.current?.click()}
              >
                {t('backup.import')}
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
          </div>
        </div>
      </section>
      <section className="st-group">
        <h3 className="st-group__title">{t('backup.reset')}</h3>
        <div className="st-group__box">
          <div className="st-row">
            <div className="st-row__text">
              <div className="st-row__label">{t('backup.resetSim')}</div>
              <div className="st-row__desc">{t('backup.resetSimDesc')}</div>
            </div>
            <div className="st-row__control">
              <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => setConfirm('reset')}>
                {t('backup.resetSim')}
              </Button>
            </div>
          </div>
          <div className="st-row">
            <div className="st-row__text">
              <div className="st-row__label">{t('ws.reset')}</div>
              <div className="st-row__desc">{t('ws.resetBody')}</div>
            </div>
            <div className="st-row__control">
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={13} />}
                onClick={() => setConfirm('factory')}
              >
                {t('ws.resetConfirm')}
              </Button>
            </div>
          </div>
        </div>
      </section>
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'factory' ? t('ws.resetTitle') : t('backup.resetSimTitle')}
        description={confirm === 'factory' ? t('ws.resetBody') : t('backup.resetSimDesc')}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                const which = confirm;
                setConfirm(null);
                void (which === 'factory' ? resetAndReconfigure() : resetSimulation());
              }}
            >
              {confirm === 'factory' ? t('ws.resetConfirm') : t('backup.resetSim')}
            </Button>
          </>
        }
      />
    </>
  );
}
