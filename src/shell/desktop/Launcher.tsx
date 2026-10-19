/**
 * System search and app overview. Without a query it shows all applications; with a query it
 * searches apps, system actions, settings sections, nodes (hostname / rack) and jobs, all from
 * the live system state. ↑/↓ select, Enter opens, Esc closes.
 */
import {
  Contrast,
  Cpu,
  Keyboard,
  LayoutGrid,
  Lock,
  LogOut,
  Maximize,
  Moon,
  Pause,
  Play,
  Power,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppIcon } from '../../apps/common/AppIcon';
import { openApp, visibleApps } from '../../apps/launch';
import { SETTINGS_SECTIONS } from '../../apps/settings/sections';
import { useEngineStore } from '../../os/engine/store';
import { useT, type MessageKey } from '../../os/i18n';
import { setRunning } from '../../os/kernel';
import { useWindowStore } from '../../os/windows/store';
import { lock, logout, openSettings, saveSystem, sleep, toggleFullscreen, toggleTheme } from './actions';
import { useDesktopStore } from './store';

interface Result {
  id: string;
  group: 'apps' | 'actions' | 'settings' | 'nodes' | 'jobs';
  icon: ReactNode;
  title: string;
  subtitle?: string;
  run: () => void;
}

const GROUP_KEY: Record<Result['group'], MessageKey> = {
  apps: 'search.group.apps',
  actions: 'search.group.actions',
  settings: 'search.group.settings',
  nodes: 'search.group.nodes',
  jobs: 'search.group.jobs',
};

const match = (q: string, ...texts: (string | undefined)[]) =>
  texts.some((s) => s?.toLowerCase().includes(q));

export function Launcher() {
  const t = useT();
  const close = () => useDesktopStore.getState().setOverlay(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const topo = useEngineStore((s) => s.topology);
  const jobs = useEngineStore((s) => s.snapshot?.jobs);
  const running = useEngineStore((s) => s.snapshot?.running ?? false);
  const apps = useMemo(() => visibleApps(), []);

  useEffect(() => inputRef.current?.focus(), []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Result[] = [];
    for (const a of apps) {
      if (match(q, t(a.titleKey), t(a.descriptionKey), ...(a.keywords ?? [])))
        out.push({
          id: `app-${a.id}`,
          group: 'apps',
          icon: <AppIcon app={a} size={26} />,
          title: t(a.titleKey),
          subtitle: t(a.descriptionKey),
          run: () => openApp(a.id),
        });
    }
    const actions: (Omit<Result, 'group'> & { keys: string[] })[] = [
      { id: 'lock', icon: <Lock size={16} />, title: t('menu.lock'), keys: ['lock'], run: lock },
      {
        id: 'logout',
        icon: <LogOut size={16} />,
        title: t('menu.logout'),
        keys: ['logout', 'sign out'],
        run: logout,
      },
      { id: 'sleep', icon: <Moon size={16} />, title: t('menu.sleep'), keys: ['sleep'], run: sleep },
      {
        id: 'restart',
        icon: <RotateCcw size={16} />,
        title: t('menu.restart'),
        keys: ['restart', 'reboot'],
        run: () => useDesktopStore.getState().setDialog('restart'),
      },
      {
        id: 'shutdown',
        icon: <Power size={16} />,
        title: t('menu.shutdown'),
        keys: ['shutdown', 'power off'],
        run: () => useDesktopStore.getState().setDialog('shutdown'),
      },
      {
        id: 'save',
        icon: <Save size={16} />,
        title: t('menu.save'),
        keys: ['save'],
        run: () => void saveSystem(),
      },
      {
        id: 'theme',
        icon: <Contrast size={16} />,
        title: t('search.toggleTheme'),
        keys: ['theme', 'dark', 'light'],
        run: toggleTheme,
      },
      {
        id: 'fullscreen',
        icon: <Maximize size={16} />,
        title: t('menu.fullscreen'),
        keys: ['fullscreen'],
        run: () => void toggleFullscreen(),
      },
      {
        id: 'sim',
        icon: running ? <Pause size={16} /> : <Play size={16} />,
        title: running ? t('search.pauseSim') : t('search.runSim'),
        keys: ['simulation', 'pause', 'run'],
        run: () => void setRunning(!running),
      },
      {
        id: 'tile',
        icon: <LayoutGrid size={16} />,
        title: t('menu.tile'),
        keys: ['tile', 'arrange'],
        run: () => useWindowStore.getState().tile(),
      },
      {
        id: 'shortcuts',
        icon: <Keyboard size={16} />,
        title: t('menu.shortcuts'),
        keys: ['shortcuts', 'keyboard'],
        run: () => useDesktopStore.getState().setDialog('shortcuts'),
      },
    ];
    for (const a of actions) if (match(q, a.title, ...a.keys)) out.push({ ...a, group: 'actions' });
    for (const s of SETTINGS_SECTIONS) {
      const title = t(`settings.section.${s}` as MessageKey);
      if (match(q, title, s))
        out.push({
          id: `set-${s}`,
          group: 'settings',
          icon: <Settings2 size={16} />,
          title,
          subtitle: t('app.settings.title'),
          run: () => openSettings(s),
        });
    }
    if (topo && q.length >= 2) {
      let n = 0;
      for (let i = 0; i < topo.nodes.length && n < 8; i++) {
        const node = topo.nodes[i]!;
        const rack = topo.racks[node.rack]!;
        if (node.hostname.includes(q) || rack.name.toLowerCase() === q) {
          n++;
          out.push({
            id: `node-${i}`,
            group: 'nodes',
            icon: <Cpu size={16} />,
            title: node.hostname,
            subtitle: `${rack.name} · ${node.platform}`,
            run: () => openApp('node', { node: i }),
          });
        }
      }
    }
    for (const j of jobs ?? []) {
      if (match(q, j.name, String(j.id), j.modelId))
        out.push({
          id: `job-${j.id}`,
          group: 'jobs',
          icon: <Workflow size={16} />,
          title: `${j.name} · #${j.id}`,
          subtitle: `${t(`job.state.${j.state}` as MessageKey)} · ${j.gpus} GPUs`,
          run: () => openApp('workloads'),
        });
    }
    return out.slice(0, 40);
  }, [query, apps, t, topo, jobs, running]);

  // Reset the selection whenever the result set changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- selection follows the query
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const runAt = (i: number) => {
    const r = results[i];
    if (!r) return;
    close();
    r.run();
  };

  let lastGroup: Result['group'] | null = null;
  return (
    <div
      className="os-launcher-layer"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="os-launcher" role="dialog" aria-modal="true" aria-label={t('menu.search')}>
        <div className="os-launcher__search">
          <Search size={18} aria-hidden />
          <input
            ref={inputRef}
            value={query}
            placeholder={t('search.placeholder')}
            aria-label={t('menu.search')}
            aria-controls="launcher-results"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-activedescendant={results[active] ? `lr-${results[active].id}` : undefined}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
              else if (e.key === 'Enter') runAt(active);
              else if (e.key === 'Escape') close();
              else return;
              e.preventDefault();
            }}
          />
        </div>
        {query.trim() ? (
          <div className="os-launcher__results" id="launcher-results" role="listbox" ref={listRef}>
            {results.length === 0 && (
              <p className="os-launcher__empty">{t('search.none', { q: query.trim() })}</p>
            )}
            {results.map((r, i) => {
              const header =
                r.group !== lastGroup ? (
                  <div className="os-launcher__group">{t(GROUP_KEY[r.group])}</div>
                ) : null;
              lastGroup = r.group;
              return (
                <div key={r.id}>
                  {header}
                  <div
                    id={`lr-${r.id}`}
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active || undefined}
                    className="os-launcher__result"
                    onPointerMove={() => setActive(i)}
                    onClick={() => runAt(i)}
                  >
                    <span className="os-launcher__icon">{r.icon}</span>
                    <span className="os-launcher__text">
                      <span className="os-launcher__title">{r.title}</span>
                      {r.subtitle && <span className="os-launcher__sub">{r.subtitle}</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="os-launcher__apps" role="list" aria-label={t('search.group.apps')}>
            {apps.map((a) => (
              <button
                key={a.id}
                type="button"
                role="listitem"
                className="os-launcher__app"
                onClick={() => {
                  close();
                  openApp(a.id);
                }}
              >
                <AppIcon app={a} size={56} />
                <span>{t(a.titleKey)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="os-launcher__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('search.navigate')}
          </span>
          <span>
            <kbd>↵</kbd> {t('search.open')}
          </span>
          <span>
            <kbd>Esc</kbd> {t('common.close')}
          </span>
        </div>
      </div>
    </div>
  );
}
