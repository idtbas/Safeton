/**
 * Menu-bar popovers: control centre (simulation, appearance, focus, display), notification
 * centre (active alerts + history) and the calendar / clock panel.
 */
import {
  AlertTriangle,
  BellOff,
  ChevronLeft,
  ChevronRight,
  Contrast,
  Maximize,
  Pause,
  Play,
  Settings2,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { openApp } from '../../apps/launch';
import { SEVERITY_TONE, severityKey } from '../../apps/common/shared';
import { useAlertStore } from '../../os/alerts';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { setRunning, setTimeScale } from '../../os/kernel';
import { useNotificationStore } from '../../os/notifications/store';
import { ACCENTS, type AccentName } from '../../os/settings/schema';
import { useSettingsStore } from '../../os/settings/store';
import { Badge, Button, Slider, fmt } from '../../ui';
import { useClock } from '../useClock';
import { openSettings, toggleFullscreen, toggleTheme } from './actions';
import { useDesktopStore } from './store';

/** Closes the current popover on outside pointer-down or Escape. */
function usePopoverDismiss(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const close = () => useDesktopStore.getState().setOverlay(null);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (ref.current?.contains(target) || target.closest('.os-tray')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref]);
}

function Tile({
  icon,
  label,
  sub,
  on,
  onClick,
  wide,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  on?: boolean;
  onClick: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      className="os-cc__tile"
      data-on={on || undefined}
      data-wide={wide || undefined}
      aria-pressed={on}
      onClick={onClick}
    >
      <span className="os-cc__tile-icon">{icon}</span>
      <span className="os-cc__tile-text">
        <span>{label}</span>
        {sub && <span className="os-cc__tile-sub">{sub}</span>}
      </span>
    </button>
  );
}

export function ControlCenter() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  usePopoverDismiss(ref);
  const snap = useEngineStore((s) => s.snapshot);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const dark = document.documentElement.dataset.theme !== 'light';
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  return (
    <div ref={ref} className="os-popover os-cc" role="dialog" aria-label={t('cc.title')} tabIndex={-1}>
      <div className="os-cc__grid">
        {snap && (
          <Tile
            wide
            icon={snap.running ? <Pause size={16} /> : <Play size={16} />}
            label={t('cc.simulation')}
            sub={snap.running ? t('cc.running', { scale: snap.timeScale }) : t('sim.paused')}
            on={snap.running}
            onClick={() => void setRunning(!snap.running)}
          />
        )}
        <Tile
          icon={<Contrast size={16} />}
          label={t('cc.dark')}
          sub={dark ? t('common.enabled') : t('common.disabled')}
          on={dark}
          onClick={toggleTheme}
        />
        <Tile
          icon={<BellOff size={16} />}
          label={t('settings.notifications.dnd')}
          sub={settings.notifications.doNotDisturb ? t('common.enabled') : t('common.disabled')}
          on={settings.notifications.doNotDisturb}
          onClick={() => update({ notifications: { doNotDisturb: !settings.notifications.doNotDisturb } })}
        />
        <Tile
          icon={<Maximize size={16} />}
          label={t('menu.fullscreen')}
          on={fullscreen}
          onClick={() => void toggleFullscreen()}
        />
      </div>
      {snap && (
        <section className="os-cc__section">
          <span className="os-cc__label">{t('sim.timeScale')}</span>
          <div className="os-cc__segments" role="radiogroup" aria-label={t('sim.timeScale')}>
            {[1, 10, 60, 300, 1800].map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={snap.timeScale === x}
                onClick={() => void setTimeScale(x)}
              >
                {x}×
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="os-cc__section">
        <span className="os-cc__label">{t('setup.appearance.accent')}</span>
        <div className="os-cc__accents" role="radiogroup" aria-label={t('setup.appearance.accent')}>
          {(Object.keys(ACCENTS) as AccentName[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={settings.appearance.accent === k}
              aria-label={ACCENTS[k].label}
              style={{ ['--sw' as string]: `oklch(0.7 ${k === 'graphite' ? 0.03 : 0.13} ${ACCENTS[k].hue})` }}
              onClick={() => update({ appearance: { accent: k } })}
            />
          ))}
        </div>
      </section>
      <section className="os-cc__section">
        <span className="os-cc__label">{t('setup.appearance.fontScale')}</span>
        <Slider
          label={t('setup.appearance.fontScale')}
          value={settings.appearance.fontScale}
          min={0.85}
          max={1.25}
          step={0.05}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => update({ appearance: { fontScale: Math.round(v * 100) / 100 } })}
        />
      </section>
      <button
        type="button"
        className="os-cc__footer"
        onClick={() => {
          useDesktopStore.getState().setOverlay(null);
          openSettings();
        }}
      >
        <Settings2 size={14} /> {t('menu.settings')}
      </button>
    </div>
  );
}

export function NotificationCenter() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  usePopoverDismiss(ref);
  const items = useNotificationStore((s) => s.items);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const remove = useNotificationStore((s) => s.remove);
  const clear = useNotificationStore((s) => s.clear);
  const alerts = useAlertStore((s) => s.alerts);
  const alertList = Object.values(alerts);

  return (
    <aside ref={ref} className="os-nc" role="dialog" aria-label={t('ws.notifications')} tabIndex={-1}>
      <header className="os-nc__head">
        <h2>{t('ws.notifications')}</h2>
        <div className="os-nc__actions">
          <Button size="sm" variant="ghost" onClick={markAllRead} disabled={items.length === 0}>
            {t('ws.markAllRead')}
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={items.length === 0}>
            {t('ws.clear')}
          </Button>
        </div>
      </header>
      {alertList.length > 0 && (
        <section className="os-nc__alerts" aria-label={t('ws.alerts')}>
          <span className="os-nc__label">{t('ws.alerts')}</span>
          {alertList.map((a) => (
            <div key={a.id} className="os-nc__alert" data-level={a.level}>
              {a.level === 'critical' ? <XCircle size={15} /> : <AlertTriangle size={15} />}
              <div>
                <strong>{a.title}</strong>
                <span>{a.body}</span>
              </div>
            </div>
          ))}
        </section>
      )}
      <div className="os-nc__list">
        {items.length === 0 ? (
          <p className="os-nc__empty">{t('ws.noNotifications')}</p>
        ) : (
          items.slice(0, 150).map((n) => (
            <article
              key={n.id}
              className="os-nc__item"
              data-read={n.read || undefined}
              onClick={() => markRead(n.id)}
            >
              <header>
                <Badge tone={SEVERITY_TONE[n.severity]} dot>
                  {t(severityKey(n.severity))}
                </Badge>
                <span className="os-nc__time">{fmt.clockTime(n.createdAt)}</span>
                <button
                  type="button"
                  className="os-nc__dismiss"
                  aria-label={t('common.close')}
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(n.id);
                  }}
                >
                  ×
                </button>
              </header>
              <div className="os-nc__title">{n.title}</div>
              <div className="os-nc__body">{n.body}</div>
              {n.source && <div className="os-nc__source mono">{n.source}</div>}
            </article>
          ))
        )}
      </div>
      <footer className="os-nc__foot">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            useDesktopStore.getState().setOverlay(null);
            openApp('events');
          }}
        >
          {t('nc.openEvents')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            useDesktopStore.getState().setOverlay(null);
            openSettings('notifications');
          }}
        >
          {t('menu.settings')}
        </Button>
      </footer>
    </aside>
  );
}

function monthMatrix(year: number, month: number, mondayFirst: boolean): (number | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const offset = mondayFirst ? (first + 6) % 7 : first;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function CalendarPanel() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  usePopoverDismiss(ref);
  const now = useClock();
  const settings = useSettingsStore((s) => s.settings);
  const snap = useEngineStore((s) => s.snapshot);
  const topo = useEngineStore((s) => s.topology);
  const { locale, timeZone, hourCycle } = settings.region;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const today = { y: Number(parts.year), m: Number(parts.month) - 1, d: Number(parts.day) };
  const [view, setView] = useState({ y: today.y, m: today.m });
  const mondayFirst = !locale.startsWith('en-US');
  const cells = monthMatrix(view.y, view.m, mondayFirst);
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2024, 0, (mondayFirst ? 1 : 7) + i)),
    ),
  );
  const monthName = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(view.y, view.m, 1)));
  const fmtTime = (tz: string, ms: number) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: hourCycle === 'h12',
    }).format(ms);

  return (
    <div ref={ref} className="os-popover os-cal" role="dialog" aria-label={t('cal.title')} tabIndex={-1}>
      <div className="os-cal__now">
        <span className="os-cal__time num">{fmtTime(timeZone, now)}</span>
        <span className="sf-muted">
          {new Intl.DateTimeFormat(locale, {
            timeZone,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }).format(now)}
        </span>
      </div>
      <div className="os-cal__head">
        <strong>{monthName}</strong>
        <span>
          <button
            type="button"
            aria-label={t('cal.prev')}
            onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            aria-label={t('cal.next')}
            onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
          >
            <ChevronRight size={14} />
          </button>
        </span>
      </div>
      <div className="os-cal__grid" role="grid" aria-label={monthName}>
        {weekdays.map((w, i) => (
          <span key={`w${i}`} className="os-cal__wd">
            {w}
          </span>
        ))}
        {cells.map((d, i) => (
          <span
            key={i}
            className="os-cal__day"
            data-today={(d === today.d && view.m === today.m && view.y === today.y) || undefined}
          >
            {d ?? ''}
          </span>
        ))}
      </div>
      <dl className="os-cal__zones">
        <div>
          <dt>{timeZone.replace(/_/g, ' ')}</dt>
          <dd className="num">{fmtTime(timeZone, now)}</dd>
        </div>
        <div>
          <dt>UTC</dt>
          <dd className="num">{fmtTime('UTC', now)}</dd>
        </div>
        {snap && (
          <div>
            <dt>{t('cal.simTime', { site: topo?.spec.site.code ?? '' })}</dt>
            <dd className="num">{fmt.dateTime(snap.time)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
