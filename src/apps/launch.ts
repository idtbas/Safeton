/**
 * Launching and activating applications — the single entry point used by dock, launcher,
 * desktop icons, menus, system search and the apps themselves.
 */
import { getApp, listApps, type AppManifest } from '../os/apps/registry';
import { t } from '../os/i18n';
import { useWindowStore } from '../os/windows/store';

/** Opens an app (or focuses its window for single-instance apps) with optional arguments. */
export function openApp(appId: string, args?: Record<string, unknown>): string | null {
  const m = getApp(appId);
  if (!m) return null;
  const ws = useWindowStore.getState();
  if (m.singleton) {
    const existing = Object.values(ws.windows).find((w) => w.appId === appId);
    if (existing) {
      if (args) ws.setArgs(existing.id, args);
      ws.restore(existing.id);
      ws.focus(existing.id);
      return existing.id;
    }
  }
  const vp = ws.viewport;
  const size = {
    w: Math.min(m.defaultSize.w, Math.max(m.minSize.w, vp.w - 48)),
    h: Math.min(m.defaultSize.h, Math.max(m.minSize.h, vp.h - 32)),
  };
  return ws.open(appId, {
    title: t(m.titleKey),
    size,
    minSize: m.minSize,
    singleton: m.singleton,
    ...(args ? { args } : {}),
  });
}

/**
 * Dock / taskbar semantics: no window → open; front window of the app → minimise all of its
 * windows; otherwise restore and focus the app's most recent window.
 */
export function activateApp(appId: string): void {
  const ws = useWindowStore.getState();
  const wins = Object.values(ws.windows)
    .filter((w) => w.appId === appId)
    .sort((a, b) => b.z - a.z);
  if (wins.length === 0) {
    openApp(appId);
    return;
  }
  const top = wins[0]!;
  if (ws.focusedId === top.id && !top.minimized) {
    for (const w of wins) ws.minimize(w.id);
    return;
  }
  for (const w of wins) if (w.minimized) ws.restore(w.id);
  ws.focus(top.id);
}

/** Apps shown on the desktop, in the dock overview and in the launcher. */
export function visibleApps(): AppManifest[] {
  return listApps().filter((a) => !a.hidden);
}
