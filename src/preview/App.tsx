/**
 * Developer tool inside the installed application: the design-system gallery (#/components).
 * Boots the kernel like the shell does, so theme, accent and density apply live.
 */
import { useEffect } from 'react';
import { bootKernel } from '../os/kernel';
import { useEngineStore } from '../os/engine/store';
import { useSettingsStore } from '../os/settings/store';
import { ConfirmHost } from '../shell/ConfirmHost';
import { ToastViewport, fmt } from '../ui';
import { Gallery } from './Gallery';
import { Header } from './Header';

export function App() {
  const status = useEngineStore((s) => s.status);
  const region = useSettingsStore((s) => s.settings.region);

  useEffect(() => {
    bootKernel().catch(() => undefined);
  }, []);

  useEffect(() => {
    fmt.configureFormatting(region);
  }, [region]);

  return (
    <div className="pv-app">
      <Header />
      {status === 'ready' ? <Gallery /> : <main className="pv-boot" aria-busy />}
      <ToastViewport />
      <ConfirmHost />
    </div>
  );
}
