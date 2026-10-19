/**
 * System dialogs: restart and shutdown confirmation (with automatic countdown, like a real OS)
 * and the keyboard shortcut reference.
 */
import { Power, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT, type MessageKey } from '../../os/i18n';
import { Button, Dialog, Kbd } from '../../ui';
import { restart, shutdown } from './actions';
import { MOD } from './keys';
import { useDesktopStore } from './store';

const COUNTDOWN_S = 60;

function PowerDialog({ kind }: { kind: 'restart' | 'shutdown' }) {
  const t = useT();
  const close = () => useDesktopStore.getState().setDialog(null);
  const [left, setLeft] = useState(COUNTDOWN_S);
  const act = kind === 'restart' ? restart : shutdown;
  useEffect(() => {
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left <= 0) void act();
  }, [left, act]);
  return (
    <Dialog
      open
      onClose={close}
      width={420}
      title={
        <span className="sh-row">
          {kind === 'restart' ? <RotateCcw size={16} /> : <Power size={16} />}
          {t(kind === 'restart' ? 'power.restartTitle' : 'power.shutdownTitle')}
        </span>
      }
      description={t(kind === 'restart' ? 'power.restartBody' : 'power.shutdownBody', { s: left })}
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => void act()}>
            {t(kind === 'restart' ? 'menu.restartNow' : 'menu.shutdownNow')}
          </Button>
        </>
      }
    />
  );
}

const SHORTCUTS: [string, MessageKey][] = [
  [`${MOD}K`, 'menu.search'],
  [`${MOD}Space`, 'menu.search'],
  [`${MOD},`, 'menu.settings'],
  [`${MOD}S`, 'menu.save'],
  [`${MOD}R`, 'menu.restart'],
  [`${MOD}/`, 'menu.shortcuts'],
  ['Ctrl Alt L', 'menu.lock'],
  ['Alt W', 'menu.closeWindow'],
  ['Alt M', 'menu.minimize'],
  ['Alt `', 'menu.cycle'],
  ['Ctrl Alt ←', 'menu.snapLeft'],
  ['Ctrl Alt →', 'menu.snapRight'],
  ['Ctrl Alt ↑', 'menu.zoom'],
  ['Ctrl Alt ↓', 'menu.minimize'],
  ['F11', 'menu.fullscreen'],
  ['Esc', 'shortcut.closeOverlay'],
];

function ShortcutsDialog() {
  const t = useT();
  const close = () => useDesktopStore.getState().setDialog(null);
  return (
    <Dialog open onClose={close} title={t('menu.shortcuts')} width={480}>
      <dl className="os-shortcuts">
        {SHORTCUTS.map(([keys, label], i) => (
          <div key={i}>
            <dt>
              {keys.split(' ').map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dt>
            <dd>{t(label)}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

export function SystemDialogs() {
  const dialog = useDesktopStore((s) => s.dialog);
  if (dialog === 'restart' || dialog === 'shutdown') return <PowerDialog key={dialog} kind={dialog} />;
  if (dialog === 'shortcuts') return <ShortcutsDialog />;
  return null;
}
