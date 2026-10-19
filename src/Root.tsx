import { useState, useSyncExternalStore } from 'react';
import { assessDevice, readDeviceEnv } from './os/platform';
import { App as PreviewApp } from './preview/App';
import { DeviceBlocked, InstallGate, ViewportGuard } from './shell/gates/Gates';
import { useStandalone } from './shell/gates/useStandalone';
import { ShellApp } from './shell/ShellApp';
import { useOsChrome } from './shell/useOsChrome';

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
const getHash = () => window.location.hash;

const DEV_BYPASS_KEY = 'safeton.dev-browser';
function readDevBypass(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return sessionStorage.getItem(DEV_BYPASS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Entry: platform gates first (desktop only, installed application only), then the OS shell.
 * The design-system gallery (#/components) runs inside the same installed application.
 */
export function Root() {
  const hash = useSyncExternalStore(subscribeHash, getHash);
  const [device] = useState(() => assessDevice(readDeviceEnv()));
  const standalone = useStandalone();
  const [devBypass, setDevBypass] = useState(readDevBypass);
  useOsChrome();

  if (!device.ok) return <DeviceBlocked reason={device.reason} />;
  if (!standalone && !devBypass) {
    return (
      <InstallGate
        onDevContinue={
          import.meta.env.DEV
            ? () => {
                try {
                  sessionStorage.setItem(DEV_BYPASS_KEY, '1');
                } catch {
                  // Session storage unavailable: bypass for this page load only.
                }
                setDevBypass(true);
              }
            : undefined
        }
      />
    );
  }
  const internal = hash.startsWith('#/components');
  return (
    <>
      {internal ? <PreviewApp /> : <ShellApp />}
      <ViewportGuard />
    </>
  );
}
