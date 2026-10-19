/**
 * Workspace placeholder (stage 2): status bar with clock, cluster status, notifications and
 * session controls, plus an overview of the commissioned infrastructure. The desktop with
 * window management replaces the body in stage 3.
 */
import {
  AlertTriangle,
  Bell,
  BellOff,
  Cpu,
  Gauge,
  Layers,
  Lock,
  LogOut,
  Palette,
  RotateCcw,
  Thermometer,
  Workflow,
  XCircle,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAlertStore } from '../../os/alerts';
import { useEngineStore } from '../../os/engine/store';
import { useT, type MessageKey } from '../../os/i18n';
import { currentAccount, resetAndReconfigure } from '../../os/kernel';
import { unreadCount, useNotificationStore } from '../../os/notifications/store';
import { useSettingsStore } from '../../os/settings/store';
import type { ShellEvent } from '../../os/shell/machine';
import { Badge, Button, Dialog, KeyValue, MetricTile, StatusBadge, fmt } from '../../ui';
import { BrandMark } from '../boot/BootScreen';
import { onlineNodes, useClusterLevel } from '../clusterStatus';
import { useClock } from '../useClock';

const SEVERITY_TONE = {
  debug: 'neutral',
  info: 'info',
  notice: 'info',
  warning: 'warning',
  error: 'serious',
  critical: 'critical',
} as const;

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const items = useNotificationStore((s) => s.items);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clear = useNotificationStore((s) => s.clear);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !(e.target as Element).closest?.('[data-bell]')
      )
        onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="sh-notif" role="dialog" aria-label={t('ws.notifications')} tabIndex={-1}>
      <div className="sh-notif__head">
        <strong>{t('ws.notifications')}</strong>
        <span className="sh-row">
          <Button size="sm" variant="ghost" onClick={markAllRead} disabled={items.length === 0}>
            {t('ws.markAllRead')}
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={items.length === 0}>
            {t('ws.clear')}
          </Button>
        </span>
      </div>
      {items.length === 0 ? (
        <p className="sf-empty">{t('ws.noNotifications')}</p>
      ) : (
        <ul className="sh-notif__list">
          {items.slice(0, 100).map((n) => (
            <li key={n.id} data-read={n.read || undefined}>
              <Badge tone={SEVERITY_TONE[n.severity]} dot>
                {n.severity}
              </Badge>
              <div className="sh-notif__text">
                <div className="sh-notif__title">{n.title}</div>
                <div className="sh-notif__body">{n.body}</div>
                <div className="sh-notif__meta mono">
                  {fmt.clockTime(n.createdAt)}
                  {n.source ? ` · ${n.source}` : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatusBar({ send }: { send: (e: ShellEvent) => void }) {
  const t = useT();
  const now = useClock();
  const settings = useSettingsStore((s) => s.settings);
  const snap = useEngineStore((s) => s.snapshot);
  const items = useNotificationStore((s) => s.items);
  const dnd = useNotificationStore((s) => s.doNotDisturb);
  const level = useClusterLevel();
  const [open, setOpen] = useState(false);
  const unread = unreadCount(items);
  const account = currentAccount();
  const statusKey: MessageKey =
    level === 'ok' ? 'ws.status.ok' : level === 'warning' ? 'ws.status.warning' : 'ws.status.critical';
  return (
    <header className="sh-statusbar">
      <div className="sh-statusbar__left">
        <BrandMark size={20} />
        <span className="sh-statusbar__host mono">{settings.system.hostname}</span>
        <StatusBadge
          tone={level === 'ok' ? 'good' : level}
          label={t(statusKey)}
          pulse={level === 'critical'}
        />
      </div>
      <div className="sh-statusbar__right">
        {snap && (
          <span className="sh-statusbar__sim mono" title={t('ws.simTime')}>
            <span className="sf-muted">SIM</span> {fmt.dateTime(snap.time)}
            {snap.running ? ` · ${snap.timeScale}×` : ' · ⏸'}
          </span>
        )}
        <span className="sh-statusbar__clock mono" aria-label="Clock">
          {fmt.clockTime(now)}
        </span>
        <span className="sh-statusbar__bell">
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            data-bell
            aria-label={`${t('ws.notifications')} (${unread})`}
            aria-expanded={open}
            icon={dnd ? <BellOff size={15} /> : <Bell size={15} />}
            onClick={() => setOpen((o) => !o)}
          />
          {unread > 0 && <span className="sh-statusbar__count">{unread > 99 ? '99+' : unread}</span>}
          {open && <NotificationPanel onClose={() => setOpen(false)} />}
        </span>
        <span className="sh-statusbar__user">{account?.displayName ?? settings.system.operator}</span>
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          aria-label={t('ws.lock')}
          title={t('ws.lock')}
          icon={<Lock size={15} />}
          onClick={() => send({ type: 'LOCK' })}
        />
        <Button
          size="sm"
          variant="ghost"
          iconOnly
          aria-label={t('ws.logout')}
          title={t('ws.logout')}
          icon={<LogOut size={15} />}
          onClick={() => send({ type: 'LOGOUT' })}
        />
      </div>
    </header>
  );
}

export function Workspace({ send }: { send: (e: ShellEvent) => void }) {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  const topo = useEngineStore((s) => s.topology);
  const alerts = useAlertStore((s) => s.alerts);
  const settings = useSettingsStore((s) => s.settings);
  const account = currentAccount();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const activeJobs =
    snap?.jobs.filter((j) => j.state === 'running' || j.state === 'initializing').length ?? 0;
  const alertList = Object.values(alerts).sort((a, b) =>
    a.level === b.level ? b.since - a.since : a.level === 'critical' ? -1 : 1,
  );

  return (
    <div className="sh-workspace">
      <StatusBar send={send} />
      <main className="sh-workspace__body">
        <section className="sh-workspace__hero">
          <h1>{t('ws.welcome', { name: account?.displayName ?? settings.system.operatorName })}</h1>
          <p className="sf-secondary">
            {t('ws.lead', { infra: topo?.spec.name ?? '', site: topo?.spec.site.name ?? '' })}
          </p>
        </section>

        {snap && (
          <section className="sh-workspace__metrics" aria-label="Cluster">
            <MetricTile
              icon={<Cpu size={13} />}
              label={t('ws.metric.nodes')}
              value={`${onlineNodes(snap)}`}
              unit={`/ ${snap.cluster.nodesTotal}`}
            />
            <MetricTile
              icon={<Gauge size={13} />}
              label={t('ws.metric.gpus')}
              value={fmt.formatNumber(snap.cluster.gpuUtilAvg * 100, 1, 1)}
              unit="%"
            />
            <MetricTile
              icon={<Zap size={13} />}
              label={t('ws.metric.it')}
              value={fmt.power(snap.facility.itPowerW).value}
              unit={fmt.power(snap.facility.itPowerW).unit}
            />
            <MetricTile
              icon={<Layers size={13} />}
              label={t('ws.metric.pue')}
              value={fmt.formatNumber(snap.facility.pue, 3, 3)}
            />
            <MetricTile
              icon={<Thermometer size={13} />}
              label={t('ws.metric.temp')}
              value={fmt.temperature(snap.cluster.gpuTempMax).replace(/\s?°[CF]$/, '')}
              unit={settings.region.temperatureUnit === 'F' ? '°F' : '°C'}
            />
            <MetricTile
              icon={<Workflow size={13} />}
              label={t('ws.metric.jobs')}
              value={String(activeJobs)}
            />
          </section>
        )}

        <div className="sh-workspace__grid">
          {topo && (
            <section className="sh-card" aria-label={t('ws.infra')}>
              <h2>{t('ws.infra')}</h2>
              <KeyValue
                items={[
                  [
                    t('ws.infra.site'),
                    `${topo.spec.site.name} · ${topo.spec.site.city} (${topo.spec.site.country})`,
                  ],
                  [
                    t('ws.infra.layout'),
                    t('ws.infra.layoutValue', {
                      halls: topo.halls.length,
                      racks: topo.racks.length,
                      nodes: topo.nodes.length,
                      gpus: fmt.formatNumber(topo.gpuCount),
                    }),
                  ],
                  [
                    t('ws.infra.fabric'),
                    topo.fabric.topology === 'none'
                      ? t('common.none')
                      : `${topo.fabric.topology} · ${topo.switches.length} × ${topo.fabric.switchModel ?? ''}`,
                  ],
                  [t('ws.infra.storage'), `${topo.storage.length} × ${topo.storage[0]?.model ?? '—'}`],
                  ...(snap
                    ? ([
                        [
                          t('ws.infra.plant'),
                          `${t('ws.infra.chillers', { healthy: snap.facility.chillersHealthy, installed: snap.facility.chillersInstalled })} · ${fmt.temperature(snap.facility.ambientC)}`,
                        ],
                        [
                          t('ws.infra.energy'),
                          `${fmt.q(fmt.energyWh(snap.facility.energyMWh * 1e6))} · ${fmt.currency(snap.facility.energyCostEur)}`,
                        ],
                      ] as [string, string][])
                    : []),
                ]}
              />
            </section>
          )}
          <section className="sh-card" aria-label={t('ws.alerts')}>
            <h2>{t('ws.alerts')}</h2>
            {alertList.length === 0 ? (
              <p className="sf-muted">{t('ws.noAlerts')}</p>
            ) : (
              <ul className="sh-alerts">
                {alertList.map((a) => (
                  <li key={a.id} data-level={a.level}>
                    {a.level === 'critical' ? <XCircle size={14} /> : <AlertTriangle size={14} />}
                    <div>
                      <div className="sh-alerts__title">{a.title}</div>
                      <div className="sf-muted">{a.body}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="sh-card">
            <h2>{t('ws.placeholderTitle')}</h2>
            <p className="sf-secondary">{t('ws.placeholder')}</p>
            <div className="sh-row sh-row--wrap">
              <Button icon={<Gauge size={14} />} onClick={() => (location.hash = '#/preview')}>
                {t('ws.openPreview')}
              </Button>
              <Button icon={<Palette size={14} />} onClick={() => (location.hash = '#/components')}>
                {t('ws.openComponents')}
              </Button>
            </div>
            <hr className="sh-card__rule" />
            <Button variant="danger" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>
              {t('ws.reset')}
            </Button>
          </section>
        </div>
      </main>

      <Dialog
        open={confirmReset}
        onClose={() => !resetting && setConfirmReset(false)}
        title={t('ws.resetTitle')}
        description={t('ws.resetBody')}
        footer={
          <>
            <Button onClick={() => setConfirmReset(false)} disabled={resetting}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={resetting}
              onClick={() => {
                setResetting(true);
                void resetAndReconfigure();
              }}
            >
              {t('ws.resetConfirm')}
            </Button>
          </>
        }
      />
    </div>
  );
}
