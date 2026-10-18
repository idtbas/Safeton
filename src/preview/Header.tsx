import { Activity, Cpu, Database, HardDrive } from 'lucide-react';
import { APP_VERSION } from '../os/kernel';
import { useEngineStore } from '../os/engine/store';
import { Badge, Tooltip, fmt } from '../ui';

export function Header({ route }: { route: string }) {
  const snap = useEngineStore((s) => s.snapshot);
  const mode = useEngineStore((s) => s.mode);
  const storage = useEngineStore((s) => s.storageKind);
  const topo = useEngineStore((s) => s.topology);
  const perf = snap?.perf;
  return (
    <header className="pv-header">
      <div className="pv-brand">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
          <path
            d="M8 11.5 16 7l8 4.5v9L16 25l-8-4.5z"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M8 11.5 16 16l8-4.5M16 16v9"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinejoin="round"
            opacity=".55"
          />
        </svg>
        <span className="pv-brand__name">SAFETON</span>
        <span className="pv-brand__tag">Engineering Preview</span>
      </div>
      <nav className="pv-nav" aria-label="Preview sections">
        <a href="#/preview" aria-current={!route.startsWith('#/components') ? 'page' : undefined}>
          Simulation
        </a>
        <a href="#/components" aria-current={route.startsWith('#/components') ? 'page' : undefined}>
          Design system
        </a>
      </nav>
      <div className="pv-header__status">
        {topo && (
          <span className="pv-header__item" title="Loaded infrastructure">
            <Database size={13} /> {topo.spec.site.code} · {topo.spec.name}
          </span>
        )}
        {snap && (
          <span className="pv-header__item mono" title="Simulated wall-clock time">
            {fmt.dateTime(snap.time)}
          </span>
        )}
        {perf && (
          <Tooltip
            content={
              <span className="mono">
                tick avg {fmt.formatNumber(perf.tickMsAvg, 2, 2)} ms · p95{' '}
                {fmt.formatNumber(perf.tickMsP95, 2, 2)} ms
                <br />
                {fmt.formatNumber(perf.ticksPerSecond, 1, 1)} ticks/s · {snap!.timeScale}× requested
              </span>
            }
          >
            <span className="pv-header__item mono" tabIndex={0}>
              <Activity size={13} />{' '}
              {snap!.running ? `${fmt.formatNumber(perf.simSecondsPerSecond, 1, 1)}×` : 'paused'} ·{' '}
              {fmt.formatNumber(perf.tickMsAvg, 2, 2)} ms
            </span>
          </Tooltip>
        )}
        {perf?.lagging && (
          <Badge tone="warning" dot>
            Lagging
          </Badge>
        )}
        <span className="pv-header__item" title="Simulation engine thread">
          <Cpu size={13} /> {mode === 'worker' ? 'Worker' : mode === 'in-process' ? 'In-process' : '—'}
        </span>
        <span className="pv-header__item" title="Persistent storage backend">
          <HardDrive size={13} />{' '}
          {storage === 'indexeddb' ? 'IndexedDB' : storage === 'memory' ? 'Volatile' : '—'}
        </span>
        <span className="pv-header__item sf-muted mono">
          v{APP_VERSION} · {typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'dev'}
        </span>
      </div>
    </header>
  );
}
