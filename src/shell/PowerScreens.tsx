/** Power states of the console: switched off, and display sleep. */
import { Power } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../os/i18n';
import { useDesktopStore } from './desktop/store';

export function OffScreen() {
  const t = useT();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 1800);
    return () => clearTimeout(id);
  }, []);
  return (
    <main className="os-off" aria-label={t('power.off')}>
      {ready && (
        <button type="button" className="os-off__button" onClick={() => location.reload()}>
          <Power size={22} strokeWidth={1.6} />
          <span>{t('power.on')}</span>
        </button>
      )}
    </main>
  );
}

/** Display off: black screen; any key or click wakes the display (to the lock screen). */
export function SleepOverlay() {
  const sleeping = useDesktopStore((s) => s.sleeping);
  useEffect(() => {
    if (!sleeping) return;
    const wake = () => useDesktopStore.getState().setSleeping(false);
    // Ignore the click that triggered sleep.
    const id = setTimeout(() => {
      window.addEventListener('pointerdown', wake, { once: true });
      window.addEventListener('keydown', wake, { once: true });
    }, 400);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, [sleeping]);
  if (!sleeping) return null;
  return <div className="os-sleep" aria-hidden />;
}
