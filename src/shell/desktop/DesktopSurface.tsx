/**
 * The desktop surface below the windows: wallpaper, application icons and the live cluster
 * widget.
 */
import { Activity } from 'lucide-react';
import { AppIcon } from '../../apps/common/AppIcon';
import { openApp, visibleApps } from '../../apps/launch';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { useSettingsStore } from '../../os/settings/store';
import { Sparkline, StatusBadge, fmt } from '../../ui';
import { onlineNodes, useClusterLevel } from '../clusterStatus';
import { useDesktopStore } from './store';

export function Wallpaper() {
  const wallpaper = useSettingsStore((s) => s.settings.desktop.wallpaper);
  return <div className="os-wallpaper" data-wallpaper={wallpaper} aria-hidden />;
}

export function DesktopIcons() {
  const t = useT();
  const selected = useDesktopStore((s) => s.selectedIcon);
  const select = useDesktopStore((s) => s.selectIcon);
  const apps = visibleApps();
  return (
    <ul className="os-icons" aria-label={t('desktop.icons')}>
      {apps.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            className="os-icons__item"
            data-selected={selected === a.id || undefined}
            onClick={(e) => {
              e.stopPropagation();
              select(a.id);
            }}
            onDoubleClick={() => openApp(a.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openApp(a.id);
            }}
          >
            <AppIcon app={a} size={48} />
            <span>{t(a.titleKey)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const tail = (arr: number[] | undefined, n = 90) => (arr ? arr.slice(Math.max(0, arr.length - n)) : []);

export function ClusterWidget() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  const topo = useEngineStore((s) => s.topology);
  const series = useEngineStore((s) => s.series);
  const level = useClusterLevel();
  if (!snap || !topo) return null;
  const c = snap.cluster;
  const f = snap.facility;
  return (
    <section className="os-widget" aria-label={t('widget.title')} onDoubleClick={() => openApp('monitor')}>
      <header>
        <div>
          <div className="os-widget__name">{topo.spec.name}</div>
          <div className="os-widget__site">
            {topo.spec.site.name} · {topo.spec.site.code}
          </div>
        </div>
        <StatusBadge
          tone={level === 'ok' ? 'good' : level}
          label={t(
            level === 'ok'
              ? 'ws.status.ok'
              : level === 'warning'
                ? 'ws.status.warning'
                : 'ws.status.critical',
          )}
        />
      </header>
      <dl className="os-widget__grid">
        <div>
          <dt>{t('login.nodesOnline')}</dt>
          <dd className="num">
            {onlineNodes(snap)}
            <small>/{c.nodesTotal}</small>
          </dd>
        </div>
        <div>
          <dt>{t('kpi.gpuUtil')}</dt>
          <dd className="num">
            {fmt.formatNumber(c.gpuUtilAvg * 100, 1, 1)}
            <small>%</small>
          </dd>
        </div>
        <div>
          <dt>{t('kpi.itLoad')}</dt>
          <dd className="num">
            {fmt.power(f.itPowerW).value}
            <small>{fmt.power(f.itPowerW).unit}</small>
          </dd>
        </div>
        <div>
          <dt>PUE</dt>
          <dd className="num">{fmt.formatNumber(f.pue, 3, 3)}</dd>
        </div>
      </dl>
      <div className="os-widget__trend">
        <Activity size={12} />
        <Sparkline
          values={tail(series.itPowerW)}
          width={236}
          height={30}
          format={(v) => fmt.q(fmt.power(v))}
        />
      </div>
      <footer className="mono">
        SIM {fmt.dateTime(snap.time)} · {snap.running ? `${snap.timeScale}×` : t('sim.paused')}
      </footer>
    </section>
  );
}
