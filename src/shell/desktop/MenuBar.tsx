/**
 * Menu bar: system menu, the focused application's menus, window and help menus on the left;
 * status items (simulation, storage, cluster), search, control centre, notifications and clock
 * on the right. Draws into the title-bar area when the window uses Window Controls Overlay.
 */
import {
  Bell,
  BellOff,
  CircleDot,
  CloudAlert,
  CloudCheck,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getApp, listApps } from '../../os/apps/registry';
import { useEngineStore } from '../../os/engine/store';
import { useT, type MessageKey } from '../../os/i18n';
import { unreadCount, useNotificationStore } from '../../os/notifications/store';
import { useSettingsStore } from '../../os/settings/store';
import { useWindowStore } from '../../os/windows/store';
import { MenuList, fmt, type MenuItem } from '../../ui';
import { openApp } from '../../apps/launch';
import { BrandMark } from '../boot/BootScreen';
import { useClusterLevel } from '../clusterStatus';
import { useClock } from '../useClock';
import { lock, logout, openSettings, saveSystem, sleep, toggleFullscreen } from './actions';
import { MOD } from './keys';
import { useDesktopStore } from './store';

interface BarMenu {
  id: string;
  label: ReactNode;
  ariaLabel: string;
  items: MenuItem[];
  strong?: boolean;
}

function useMenus(): BarMenu[] {
  const t = useT();
  const focusedId = useWindowStore((s) => s.focusedId);
  const windows = useWindowStore((s) => s.windows);
  const focused = focusedId ? windows[focusedId] : undefined;
  const app = focused ? getApp(focused.appId) : undefined;
  const ws = useWindowStore.getState();
  const setDialog = useDesktopStore.getState().setDialog;
  const appTitle = app ? t(app.titleKey) : t('desktop.finder');

  const system: MenuItem[] = [
    { id: 'about', label: t('menu.about'), onSelect: () => openApp('about') },
    { id: 's1', separator: true },
    { id: 'settings', label: t('menu.settings'), shortcut: `${MOD},`, onSelect: () => openSettings() },
    { id: 'monitor', label: t('app.monitor.title'), onSelect: () => openApp('monitor') },
    { id: 's2', separator: true },
    { id: 'save', label: t('menu.save'), shortcut: `${MOD}S`, onSelect: () => void saveSystem() },
    { id: 's3', separator: true },
    { id: 'sleep', label: t('menu.sleep'), onSelect: sleep },
    { id: 'restart', label: t('menu.restart'), shortcut: `${MOD}R`, onSelect: () => setDialog('restart') },
    { id: 'shutdown', label: t('menu.shutdown'), onSelect: () => setDialog('shutdown') },
    { id: 's4', separator: true },
    { id: 'lock', label: t('menu.lock'), shortcut: 'Ctrl Alt L', onSelect: lock },
    { id: 'logout', label: t('menu.logout'), onSelect: logout },
  ];

  const appMenu: MenuItem[] = app
    ? [
        { id: 'about-app', label: t('menu.aboutApp', { app: appTitle }), disabled: true },
        { id: 'a1', separator: true },
        ...(!app.singleton
          ? [{ id: 'new', label: t('menu.newWindow'), onSelect: () => openApp(app.id) }]
          : []),
        {
          id: 'close',
          label: t('menu.closeWindow'),
          shortcut: 'Alt W',
          onSelect: () => focused && ws.close(focused.id),
        },
        { id: 'quit', label: t('menu.quitApp', { app: appTitle }), onSelect: () => ws.closeApp(app.id) },
      ]
    : [
        { id: 'icons', label: t('menu.showDesktop'), onSelect: () => ws.minimizeAll() },
        { id: 'wallpaper', label: t('menu.wallpaper'), onSelect: () => openSettings('desktop') },
      ];

  const openWindows = Object.values(windows).sort((a, b) => a.z - b.z);
  const windowMenu: MenuItem[] = [
    {
      id: 'min',
      label: t('menu.minimize'),
      shortcut: 'Alt M',
      disabled: !focused,
      onSelect: () => focused && ws.minimize(focused.id),
    },
    {
      id: 'zoom',
      label: t('menu.zoom'),
      shortcut: 'Ctrl Alt ↑',
      disabled: !focused,
      onSelect: () => focused && ws.toggleMaximize(focused.id),
    },
    {
      id: 'left',
      label: t('menu.snapLeft'),
      shortcut: 'Ctrl Alt ←',
      disabled: !focused,
      onSelect: () => focused && ws.snap(focused.id, 'left'),
    },
    {
      id: 'right',
      label: t('menu.snapRight'),
      shortcut: 'Ctrl Alt →',
      disabled: !focused,
      onSelect: () => focused && ws.snap(focused.id, 'right'),
    },
    { id: 'w1', separator: true },
    { id: 'tile', label: t('menu.tile'), disabled: openWindows.length === 0, onSelect: () => ws.tile() },
    {
      id: 'cycle',
      label: t('menu.cycle'),
      shortcut: 'Alt `',
      disabled: openWindows.length < 2,
      onSelect: () => ws.cycle(1),
    },
    {
      id: 'minall',
      label: t('menu.showDesktop'),
      disabled: openWindows.length === 0,
      onSelect: () => ws.minimizeAll(),
    },
    ...(openWindows.length ? [{ id: 'w2', separator: true }] : []),
    ...openWindows.map((w) => ({
      id: `win-${w.id}`,
      label: w.title,
      checked: w.id === focusedId ? true : undefined,
      onSelect: () => {
        ws.restore(w.id);
        ws.focus(w.id);
      },
    })),
  ];

  const goMenu: MenuItem[] = listApps()
    .filter((a) => !a.hidden)
    .map((a) => ({ id: `go-${a.id}`, label: t(a.titleKey), onSelect: () => openApp(a.id) }));

  const helpMenu: MenuItem[] = [
    {
      id: 'search',
      label: t('menu.search'),
      shortcut: `${MOD}K`,
      onSelect: () => useDesktopStore.getState().setOverlay('launcher'),
    },
    {
      id: 'shortcuts',
      label: t('menu.shortcuts'),
      shortcut: `${MOD}/`,
      onSelect: () => setDialog('shortcuts'),
    },
    { id: 'h1', separator: true },
    {
      id: 'fullscreen',
      label: t('menu.fullscreen'),
      shortcut: 'F11',
      onSelect: () => void toggleFullscreen(),
    },
    { id: 'h2', separator: true },
    {
      id: 'dev',
      label: t('menu.developer'),
      submenu: [
        { id: 'gallery', label: t('menu.designSystem'), onSelect: () => (location.hash = '#/components') },
      ],
    },
  ];

  return [
    { id: 'system', label: <BrandMark size={15} />, ariaLabel: t('menu.system'), items: system },
    { id: 'app', label: appTitle, ariaLabel: appTitle, items: appMenu, strong: true },
    { id: 'window', label: t('menu.window'), ariaLabel: t('menu.window'), items: windowMenu },
    { id: 'go', label: t('menu.go'), ariaLabel: t('menu.go'), items: goMenu },
    { id: 'help', label: t('menu.help'), ariaLabel: t('menu.help'), items: helpMenu },
  ];
}

function Tray() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  const lastSaved = useEngineStore((s) => s.lastSavedAt);
  const saveError = useEngineStore((s) => s.saveError);
  const items = useNotificationStore((s) => s.items);
  const dnd = useNotificationStore((s) => s.doNotDisturb);
  const overlay = useDesktopStore((s) => s.overlay);
  const toggle = useDesktopStore((s) => s.toggleOverlay);
  const level = useClusterLevel();
  const now = useClock();
  const settings = useSettingsStore((s) => s.settings);
  const unread = unreadCount(items);
  const statusKey: MessageKey =
    level === 'ok' ? 'ws.status.ok' : level === 'warning' ? 'ws.status.warning' : 'ws.status.critical';
  const loc = settings.region.locale;
  const date = new Intl.DateTimeFormat(loc, {
    timeZone: settings.region.timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(now);
  const time = new Intl.DateTimeFormat(loc, {
    timeZone: settings.region.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(settings.desktop.clockSeconds ? { second: '2-digit' } : {}),
    hour12: settings.region.hourCycle === 'h12',
  }).format(now);

  return (
    <div className="os-tray">
      {snap && (
        <button
          type="button"
          className="os-tray__item"
          title={t(snap.running ? 'tray.simRunning' : 'tray.simPaused', { scale: snap.timeScale })}
          aria-label={t(snap.running ? 'tray.simRunning' : 'tray.simPaused', { scale: snap.timeScale })}
          onClick={() => toggle('control')}
        >
          {snap.running ? <Play size={12} fill="currentColor" /> : <Pause size={12} fill="currentColor" />}
          <span className="mono">{snap.timeScale}×</span>
        </button>
      )}
      <button
        type="button"
        className="os-tray__item"
        data-tone={saveError ? 'warning' : undefined}
        title={saveError ?? t('tray.saved', { time: lastSaved ? fmt.clockTime(lastSaved) : '—' })}
        aria-label={saveError ?? t('tray.saved', { time: lastSaved ? fmt.clockTime(lastSaved) : '—' })}
        onClick={() => void saveSystem()}
      >
        {saveError ? <CloudAlert size={14} /> : <CloudCheck size={14} />}
      </button>
      <button
        type="button"
        className="os-tray__item"
        data-level={level}
        title={t(statusKey)}
        aria-label={`${t('login.cluster')}: ${t(statusKey)}`}
        onClick={() => openApp('monitor')}
      >
        <CircleDot size={13} className="os-tray__status" />
        <span>{t(statusKey)}</span>
      </button>
      <button
        type="button"
        className="os-tray__item"
        aria-label={t('menu.search')}
        title={t('menu.search')}
        onClick={() => toggle('launcher')}
        aria-expanded={overlay === 'launcher'}
      >
        <Search size={14} />
      </button>
      <button
        type="button"
        className="os-tray__item"
        aria-label={t('cc.title')}
        title={t('cc.title')}
        aria-expanded={overlay === 'control'}
        data-open={overlay === 'control' || undefined}
        onClick={() => toggle('control')}
      >
        <SlidersHorizontal size={14} />
      </button>
      <button
        type="button"
        className="os-tray__item"
        aria-label={`${t('ws.notifications')} (${unread})`}
        title={t('ws.notifications')}
        aria-expanded={overlay === 'notifications'}
        data-open={overlay === 'notifications' || undefined}
        onClick={() => toggle('notifications')}
      >
        {dnd ? <BellOff size={14} /> : <Bell size={14} />}
        {unread > 0 && <span className="os-tray__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <button
        type="button"
        className="os-tray__item os-tray__clock"
        aria-label={`${date} ${time}`}
        aria-expanded={overlay === 'calendar'}
        data-open={overlay === 'calendar' || undefined}
        onClick={() => toggle('calendar')}
      >
        <span>{date}</span>
        <span className="num">{time}</span>
      </button>
    </div>
  );
}

export function MenuBar() {
  const menus = useMenus();
  const open = useDesktopStore((s) => s.menu);
  const setMenu = useDesktopStore((s) => s.setMenu);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (barRef.current?.contains(target) || target.closest('.sf-menu')) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, setMenu]);

  // Anchor of the open menu, measured after the menu bar has laid out.
  const [anchor, setAnchor] = useState<{ id: string; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const r = open ? refs.current[open]?.getBoundingClientRect() : undefined;
    setAnchor(open && r ? { id: open, x: r.left, y: r.bottom + 3 } : null);
  }, [open]);
  const current = menus.find((m) => m.id === open);
  const navigate = (dir: -1 | 1) => {
    const i = menus.findIndex((m) => m.id === open);
    const next = menus[(i + dir + menus.length) % menus.length]!;
    setMenu(next.id);
  };

  return (
    <header ref={barRef} className="os-menubar">
      <div className="os-menubar__inner">
        <nav className="os-menubar__menus" aria-label="Menu bar">
          {menus.map((m) => (
            <button
              key={m.id}
              ref={(el) => {
                refs.current[m.id] = el;
              }}
              type="button"
              className="os-menubar__menu"
              data-strong={m.strong || undefined}
              data-open={open === m.id || undefined}
              aria-haspopup="menu"
              aria-expanded={open === m.id}
              aria-label={m.ariaLabel}
              onPointerDown={(e) => {
                e.preventDefault();
                setMenu(open === m.id ? null : m.id);
              }}
              onPointerEnter={() => {
                if (open && open !== m.id) setMenu(m.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMenu(m.id);
                }
              }}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <span className="os-menubar__drag" />
        <Tray />
      </div>
      {current &&
        anchor?.id === current.id &&
        createPortal(
          <MenuList
            key={current.id}
            items={current.items}
            x={anchor.x}
            y={anchor.y}
            label={current.ariaLabel}
            className="sf-menu--bar"
            onClose={() => setMenu(null)}
            onNavigate={navigate}
          />,
          document.body,
        )}
    </header>
  );
}
