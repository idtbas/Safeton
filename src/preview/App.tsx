/**
 * Stage-1 shell: boots the kernel and hosts the internal Engineering Preview and the
 * design-system gallery. This is a verification surface, not the final desktop (stage 3).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { bootKernel, type BootStep } from '../os/kernel';
import { useEngineStore } from '../os/engine/store';
import { useSettingsStore } from '../os/settings/store';
import { ToastViewport, fmt } from '../ui';
import { EngineeringPreview } from './EngineeringPreview';
import { Gallery } from './Gallery';
import { Header } from './Header';

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
const getHash = () => window.location.hash || '#/preview';

export function App() {
  const route = useSyncExternalStore(subscribeHash, getHash);
  const status = useEngineStore((s) => s.status);
  const error = useEngineStore((s) => s.error);
  const region = useSettingsStore((s) => s.settings.region);
  const [steps, setSteps] = useState<BootStep[]>([]);

  useEffect(() => {
    bootKernel(setSteps).catch(() => undefined);
  }, []);

  useEffect(() => {
    fmt.configureFormatting(region);
  }, [region]);

  return (
    <div className="pv-app">
      <Header route={route} />
      {status === 'ready' ? (
        route.startsWith('#/components') ? <Gallery /> : <EngineeringPreview />
      ) : (
        <BootStatus steps={steps} error={status === 'error' ? error : null} />
      )}
      <ToastViewport />
    </div>
  );
}

function BootStatus({ steps, error }: { steps: BootStep[]; error: string | null }) {
  return (
    <main className="pv-boot">
      <div className="pv-boot__card">
        <div className="sf-label">System initialisation</div>
        <ol className="pv-boot__steps">
          {steps.map((s) => (
            <li key={s.id} data-status={s.status}>
              <span className="pv-boot__mark" aria-hidden />
              <span>{s.label}</span>
              <span className="sf-muted mono">{s.detail ?? (s.status === 'running' ? '…' : '')}</span>
            </li>
          ))}
        </ol>
        {error && <p className="pv-boot__error">Boot failed: {error}</p>}
      </div>
    </main>
  );
}
