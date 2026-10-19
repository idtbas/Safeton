/**
 * Dock: pinned and running applications with running indicators, the app overview button,
 * magnification on hover and context menus (open, show windows, keep in dock, quit).
 */
import { LayoutGrid } from 'lucide-react';
import { activateApp, openApp } from '../../apps/launch';
import { AppIcon } from '../../apps/common/AppIcon';
import { getApp, type AppManifest } from '../../os/apps/registry';
import { useT } from '../../os/i18n';
import { useSettingsStore } from '../../os/settings/store';
import { useWindowStore } from '../../os/windows/store';
import type { MenuItem } from '../../ui';
import { useDesktopStore } from './store';

export function Dock() {
  const t = useT();
  const dockApps = useSettingsStore((s) => s.settings.desktop.dockApps);
  const magnify = useSettingsStore((s) => s.settings.desktop.dockMagnify);
  const update = useSettingsStore((s) => s.update);
  const windows = useWindowStore((s) => s.windows);
  const focusedId = useWindowStore((s) => s.focusedId);
  const overlay = useDesktopStore((s) => s.overlay);
  const toggleOverlay = useDesktopStore((s) => s.toggleOverlay);
  const openContextMenu = useDesktopStore((s) => s.openContextMenu);

  const running = new Set(Object.values(windows).map((w) => w.appId));
  const focusedApp = focusedId ? windows[focusedId]?.appId : null;
  const pinned = dockApps.map((id) => getApp(id)).filter((a): a is AppManifest => !!a);
  const extra = [...running]
    .filter((id) => !dockApps.includes(id))
    .map((id) => getApp(id))
    .filter((a): a is AppManifest => !!a);

  const menuFor = (app: AppManifest): MenuItem[] => {
    const wins = Object.values(windows).filter((w) => w.appId === app.id);
    const ws = useWindowStore.getState();
    const isPinned = dockApps.includes(app.id);
    return [
      ...wins.map((w) => ({
        id: `w-${w.id}`,
        label: w.title,
        checked: w.id === focusedId ? true : undefined,
        onSelect: () => {
          ws.restore(w.id);
          ws.focus(w.id);
        },
      })),
      ...(wins.length ? [{ id: 's0', separator: true }] : []),
      wins.length && app.singleton
        ? { id: 'show', label: t('dock.show'), onSelect: () => activateApp(app.id) }
        : {
            id: 'open',
            label: wins.length ? t('menu.newWindow') : t('dock.open'),
            onSelect: () => openApp(app.id),
          },
      { id: 's1', separator: true },
      {
        id: 'keep',
        label: t('dock.keep'),
        checked: isPinned,
        onSelect: () =>
          update({
            desktop: { dockApps: isPinned ? dockApps.filter((x) => x !== app.id) : [...dockApps, app.id] },
          }),
      },
      ...(wins.length
        ? [
            { id: 's2', separator: true },
            { id: 'quit', label: t('dock.quit'), onSelect: () => ws.closeApp(app.id) },
          ]
        : []),
    ];
  };

  const item = (app: AppManifest) => {
    const label = t(app.titleKey);
    return (
      <li key={app.id} className="os-dock__item">
        <button
          type="button"
          className="os-dock__btn"
          aria-label={label}
          data-active={focusedApp === app.id || undefined}
          onClick={() => activateApp(app.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openContextMenu(r.left, r.top - 8, menuFor(app), label);
          }}
        >
          <AppIcon app={app} size={46} />
          <span className="os-dock__label" aria-hidden>
            {label}
          </span>
        </button>
        <span className="os-dock__dot" data-on={running.has(app.id) || undefined} aria-hidden />
      </li>
    );
  };

  return (
    <nav className="os-dock" aria-label={t('dock.label')} data-magnify={magnify || undefined}>
      <ul>
        {pinned.map(item)}
        {extra.length > 0 && <li className="os-dock__sep" aria-hidden />}
        {extra.map(item)}
        <li className="os-dock__sep" aria-hidden />
        <li className="os-dock__item">
          <button
            type="button"
            className="os-dock__btn"
            aria-label={t('dock.apps')}
            aria-expanded={overlay === 'launcher'}
            onClick={() => toggleOverlay('launcher')}
          >
            <span className="os-dock__grid">
              <LayoutGrid size={22} strokeWidth={1.6} />
            </span>
            <span className="os-dock__label" aria-hidden>
              {t('dock.apps')}
            </span>
          </button>
          <span className="os-dock__dot" aria-hidden />
        </li>
      </ul>
    </nav>
  );
}
