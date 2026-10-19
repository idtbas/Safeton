/**
 * Renders application windows inside the workspace area, with lazy loading, crash isolation,
 * window context menus and the snap preview.
 */
import { Loader2 } from 'lucide-react';
import { Suspense, useLayoutEffect, useRef } from 'react';
import { AppIcon } from '../../apps/common/AppIcon';
import { getApp } from '../../os/apps/registry';
import { useT } from '../../os/i18n';
import { useSettingsStore } from '../../os/settings/store';
import { WindowFrame } from '../../os/windows/WindowFrame';
import { useWindowStore, type WindowState } from '../../os/windows/store';
import type { MenuItem } from '../../ui';
import { AppErrorBoundary } from './AppErrorBoundary';
import { useDesktopStore } from './store';

function AppWindow({ win }: { win: WindowState }) {
  const t = useT();
  const snap = useSettingsStore((s) => s.settings.windows.snapToEdges);
  const app = getApp(win.appId);
  if (!app) return null;
  const Component = app.component;
  const appTitle = t(app.titleKey);
  const title = app.singleton ? appTitle : win.title;
  const ws = useWindowStore.getState();
  const menu = (): MenuItem[] => [
    { id: 'min', label: t('menu.minimize'), onSelect: () => ws.minimize(win.id) },
    {
      id: 'max',
      label: win.maximized ? t('menu.restoreSize') : t('menu.zoom'),
      onSelect: () => ws.toggleMaximize(win.id),
    },
    { id: 'left', label: t('menu.snapLeft'), onSelect: () => ws.snap(win.id, 'left') },
    { id: 'right', label: t('menu.snapRight'), onSelect: () => ws.snap(win.id, 'right') },
    { id: 's', separator: true },
    { id: 'close', label: t('menu.closeWindow'), onSelect: () => ws.close(win.id) },
  ];
  return (
    <WindowFrame
      win={win}
      title={title}
      icon={<AppIcon app={app} size={18} />}
      snap={snap}
      labels={{
        minimize: t('menu.minimize'),
        maximize: t('menu.zoom'),
        restore: t('menu.restoreSize'),
        close: t('common.close'),
      }}
      onTitleContextMenu={(e) => {
        e.preventDefault();
        useDesktopStore.getState().openContextMenu(e.clientX, e.clientY, menu(), title);
      }}
    >
      <AppErrorBoundary appTitle={appTitle}>
        <Suspense
          fallback={
            <div className="ap-loading" aria-busy>
              <Loader2 size={20} className="sh-spin" />
            </div>
          }
        >
          <Component windowId={win.id} args={win.args} />
        </Suspense>
      </AppErrorBoundary>
    </WindowFrame>
  );
}

export function WindowLayer() {
  const windows = useWindowStore((s) => s.windows);
  const preview = useWindowStore((s) => s.snapPreview);
  // Directly below the dragged (focused, top-most) window: same z-index, earlier in the DOM.
  const previewZ = useWindowStore((s) => s.nextZ - 1);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => useWindowStore.getState().setViewport(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(set);
    ro.observe(el);
    set();
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="os-windows" data-window-area>
      {preview && (
        <div className="os-snap-preview" data-zone={preview} style={{ zIndex: previewZ }} aria-hidden />
      )}
      {Object.values(windows).map((w) => (
        <AppWindow key={w.id} win={w} />
      ))}
    </div>
  );
}
