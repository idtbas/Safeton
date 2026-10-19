/**
 * The desktop session: wallpaper, menu bar, desktop icons and widget, application windows,
 * dock, system overlays (search, control centre, notifications, calendar), context menus and
 * system dialogs.
 */
import { useEffect } from 'react';
import { openApp, visibleApps } from '../../apps/launch';
import { getApp } from '../../os/apps/registry';
import { useT } from '../../os/i18n';
import { useSettingsStore } from '../../os/settings/store';
import { useWindowStore } from '../../os/windows/store';
import { PopupMenu, type MenuItem } from '../../ui';
import { openSettings } from './actions';
import { ClusterWidget, DesktopIcons, Wallpaper } from './DesktopSurface';
import { Dock } from './Dock';
import { Launcher } from './Launcher';
import { MenuBar } from './MenuBar';
import { CalendarPanel, ControlCenter, NotificationCenter } from './Panels';
import { useDesktopStore } from './store';
import { SystemDialogs } from './SystemDialogs';
import { useDesktopShortcuts } from './useDesktopShortcuts';
import { WindowLayer } from './WindowLayer';

function useDocumentTitle() {
  const t = useT();
  const title = useWindowStore((s) => {
    const w = s.focusedId ? s.windows[s.focusedId] : undefined;
    const app = w ? getApp(w.appId) : undefined;
    return app ? (app.singleton ? t(app.titleKey) : w!.title) : null;
  });
  useEffect(() => {
    document.title = title ? `${title} — Safeton` : 'Safeton';
    return () => {
      document.title = 'Safeton';
    };
  }, [title]);
}

export function Desktop() {
  const t = useT();
  const overlay = useDesktopStore((s) => s.overlay);
  const contextMenu = useDesktopStore((s) => s.contextMenu);
  const closeContextMenu = useDesktopStore((s) => s.closeContextMenu);
  const showIcons = useSettingsStore((s) => s.settings.desktop.showIcons);
  const showWidget = useSettingsStore((s) => s.settings.desktop.showWidget);
  useDesktopShortcuts();
  useDocumentTitle();

  const desktopMenu = (): MenuItem[] => {
    const ws = useWindowStore.getState();
    const any = Object.keys(ws.windows).length > 0;
    return [
      {
        id: 'open',
        label: t('ctx.open'),
        submenu: visibleApps().map((a) => ({
          id: a.id,
          label: t(a.titleKey),
          onSelect: () => openApp(a.id),
        })),
      },
      { id: 's1', separator: true },
      { id: 'tile', label: t('menu.tile'), disabled: !any, onSelect: () => ws.tile() },
      { id: 'minall', label: t('menu.showDesktop'), disabled: !any, onSelect: () => ws.minimizeAll() },
      { id: 's2', separator: true },
      {
        id: 'icons',
        label: t('settings.desktop.icons'),
        checked: showIcons,
        onSelect: () => useSettingsStore.getState().update({ desktop: { showIcons: !showIcons } }),
      },
      {
        id: 'widget',
        label: t('settings.desktop.widget'),
        checked: showWidget,
        onSelect: () => useSettingsStore.getState().update({ desktop: { showWidget: !showWidget } }),
      },
      { id: 's3', separator: true },
      { id: 'wallpaper', label: t('menu.wallpaper'), onSelect: () => openSettings('desktop') },
      { id: 'settings', label: t('menu.settings'), onSelect: () => openSettings() },
    ];
  };

  return (
    <div className="os-desktop">
      <Wallpaper />
      <MenuBar />
      <main
        className="os-desktop__area"
        aria-label={t('desktop.label')}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) useDesktopStore.getState().selectIcon(null);
        }}
        onContextMenu={(e) => {
          if ((e.target as Element).closest('.os-window')) return;
          e.preventDefault();
          useDesktopStore.getState().openContextMenu(e.clientX, e.clientY, desktopMenu(), t('desktop.label'));
        }}
      >
        {showWidget && <ClusterWidget />}
        {showIcons && <DesktopIcons />}
        <WindowLayer />
      </main>
      <Dock />
      {overlay === 'launcher' && <Launcher />}
      {overlay === 'control' && <ControlCenter />}
      {overlay === 'notifications' && <NotificationCenter />}
      {overlay === 'calendar' && <CalendarPanel />}
      {contextMenu && (
        <PopupMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          label={contextMenu.label}
          onClose={closeContextMenu}
        />
      )}
      <SystemDialogs />
    </div>
  );
}
