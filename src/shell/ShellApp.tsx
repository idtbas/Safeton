/**
 * Root of the operating system UI. Renders the screen for the current shell phase
 * (boot → setup → initialisation → login ⇄ workspace ⇄ lock) and owns session-wide concerns:
 * regional formatting, the inactivity lock and the confirmation dialog host.
 */
import { useEffect } from 'react';
import { useSettingsStore } from '../os/settings/store';
import { useShellStore } from '../os/shell/machine';
import { ToastViewport, fmt } from '../ui';
import { BootScreen } from './boot/BootScreen';
import { ConfirmHost } from './ConfirmHost';
import { LoginScreen } from './login/LoginScreen';
import { SetupWizard } from './setup/SetupWizard';
import { Workspace } from './workspace/Workspace';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** Locks (or signs out) the session after the configured period of inactivity. */
function useInactivityLock(active: boolean) {
  const timeoutMin = useSettingsStore((s) => s.settings.security.sessionTimeoutMin);
  const lockScreen = useSettingsStore((s) => s.settings.security.lockScreen);
  const send = useShellStore((s) => s.send);
  useEffect(() => {
    if (!active || timeoutMin <= 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => send(lockScreen ? { type: 'LOCK' } : { type: 'LOGOUT' }), timeoutMin * 60_000);
    };
    arm();
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, arm, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, arm);
    };
  }, [active, timeoutMin, lockScreen, send]);
}

export function ShellApp() {
  const phase = useShellStore((s) => s.phase);
  const user = useShellStore((s) => s.user);
  const send = useShellStore((s) => s.send);
  const region = useSettingsStore((s) => s.settings.region);

  useEffect(() => {
    fmt.configureFormatting(region);
  }, [region]);
  useInactivityLock(phase === 'workspace');

  let screen;
  switch (phase) {
    case 'firmware':
    case 'kernel':
    case 'infrastructure':
    case 'error':
      screen = <BootScreen phase={phase} send={send} />;
      break;
    case 'setup':
    case 'initializing':
      screen = <SetupWizard phase={phase} send={send} />;
      break;
    case 'login':
      screen = <LoginScreen key="login" mode="login" user={null} send={send} />;
      break;
    case 'locked':
      screen = <LoginScreen key="locked" mode="locked" user={user} send={send} />;
      break;
    case 'workspace':
      screen = <Workspace send={send} />;
      break;
  }

  return (
    <div className="sh-root" data-phase={phase}>
      {screen}
      {phase !== 'firmware' && phase !== 'kernel' && <ToastViewport />}
      <ConfirmHost />
    </div>
  );
}
