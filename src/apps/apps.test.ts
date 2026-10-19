import { describe, expect, it } from 'vitest';
import { en } from '../os/i18n/en';
import { getApp, listApps } from '../os/apps/registry';
import { DEFAULT_DOCK, defaultSettings } from '../os/settings/schema';
import { useWindowStore } from '../os/windows/store';
import { APP_MANIFESTS, registerBuiltinApps } from './index';
import { activateApp, openApp, visibleApps } from './launch';
import { SETTINGS_SECTIONS } from './settings/sections';

describe('application registry', () => {
  registerBuiltinApps();

  it('registers every built-in app with translated title and description', () => {
    expect(listApps().map((a) => a.id)).toEqual(APP_MANIFESTS.map((a) => a.id));
    for (const a of listApps()) {
      expect(en[a.titleKey], a.id).toBeTruthy();
      expect(en[a.descriptionKey], a.id).toBeTruthy();
      expect(a.minSize.w).toBeLessThanOrEqual(a.defaultSize.w);
    }
  });

  it('pins only existing, launchable apps to the default dock', () => {
    expect(defaultSettings().desktop.dockApps).toEqual(DEFAULT_DOCK);
    for (const id of DEFAULT_DOCK) {
      expect(getApp(id), id).toBeDefined();
      expect(getApp(id)!.hidden).toBeFalsy();
    }
    expect(visibleApps().some((a) => a.id === 'node')).toBe(false);
  });

  it('every settings section has a title', () => {
    for (const s of SETTINGS_SECTIONS) expect(en[`settings.section.${s}` as keyof typeof en]).toBeTruthy();
  });

  it('opens single-instance apps once and toggles them from the dock', () => {
    const ws = useWindowStore.getState();
    ws.closeAll();
    const a = openApp('monitor');
    const b = openApp('monitor');
    expect(a).toBe(b);
    expect(Object.keys(useWindowStore.getState().windows)).toHaveLength(1);
    // Dock click on the focused app minimises it, the next click restores it.
    activateApp('monitor');
    expect(useWindowStore.getState().windows[a!]!.minimized).toBe(true);
    activateApp('monitor');
    expect(useWindowStore.getState().windows[a!]!.minimized).toBe(false);
    // Multi-instance apps (node details) open a window per launch with their arguments.
    const n1 = openApp('node', { node: 1 });
    const n2 = openApp('node', { node: 2 });
    expect(n1).not.toBe(n2);
    expect(useWindowStore.getState().windows[n2!]!.args).toEqual({ node: 2 });
    // Launch arguments reach an existing single-instance window.
    openApp('settings', { section: 'security' });
    const s = openApp('settings', { section: 'backup' });
    expect(useWindowStore.getState().windows[s!]!.args).toEqual({ section: 'backup' });
  });
});
