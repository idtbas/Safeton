/**
 * System actions shared by menus, launcher, keyboard shortcuts and the power dialogs.
 */
import { openApp } from '../../apps/launch';
import { t } from '../../os/i18n';
import { saveNow, setRunning } from '../../os/kernel';
import { useNotificationStore } from '../../os/notifications/store';
import { useSettingsStore } from '../../os/settings/store';
import { useShellStore } from '../../os/shell/machine';
import { useWindowStore } from '../../os/windows/store';
import { useDesktopStore } from './store';

export function lock(): void {
  useDesktopStore.getState().setOverlay(null);
  useShellStore.getState().send({ type: 'LOCK' });
}

export function logout(): void {
  useWindowStore.getState().closeAll();
  useDesktopStore.getState().setOverlay(null);
  useShellStore.getState().send({ type: 'LOGOUT' });
}

/** Display off; the session locks and any input wakes the lock screen. */
export function sleep(): void {
  lock();
  useDesktopStore.getState().setSleeping(true);
}

/** Saves the system state and reloads: a full boot from firmware. */
export async function restart(): Promise<void> {
  useDesktopStore.getState().setDialog(null);
  await saveNow();
  location.reload();
}

/** Saves, pauses the simulation and powers the console off. */
export async function shutdown(): Promise<void> {
  useDesktopStore.getState().setDialog(null);
  await saveNow();
  await setRunning(false).catch(() => undefined);
  useWindowStore.getState().closeAll();
  useShellStore.getState().send({ type: 'SHUTDOWN' });
}

export async function saveSystem(): Promise<void> {
  await saveNow();
  useNotificationStore
    .getState()
    .push({ severity: 'notice', title: t('sys.saved'), body: t('sys.savedBody'), source: 'kernel' });
}

export function toggleTheme(): void {
  const s = useSettingsStore.getState();
  const current = s.settings.appearance.theme;
  const dark =
    current === 'dark' || (current === 'system' && document.documentElement.dataset.theme === 'dark');
  s.update({ appearance: { theme: dark ? 'light' : 'dark' } });
}

export function openSettings(section?: string): void {
  openApp('settings', section ? { section } : undefined);
}

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // Fullscreen not permitted (e.g. without user gesture); ignore.
  }
}
