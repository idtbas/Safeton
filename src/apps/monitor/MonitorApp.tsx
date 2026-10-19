/**
 * System monitor: simulation control, live key figures with trends, power balance, node state
 * distribution and engine performance — the operator's control centre.
 */
import { Gauge, Pause, Play, StepForward } from 'lucide-react';
import { NODE_STATE_NAMES } from '../../engine';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { setRunning, setTimeScale, stepSimulation } from '../../os/kernel';
import { useSettingsStore } from '../../os/settings/store';
import { Badge, Button, ButtonGroup, KeyValue, MetricTile, Select, Toggle, Tooltip, fmt } from '../../ui';
import {
  AppBody,
  AppFrame,
  AppStatusBar,
  AppToolbar,
  EmptyState,
  Section,
  ToolbarSeparator,
  ToolbarSpacer,
} from '../common/AppLayout';
import { NODE_STATE_TONE, nodeStateKey } from '../common/shared';

const SCALES = [1, 10, 60, 300, 1800];
const FAILURE_RATES = [0, 1, 10, 100, 1000];
const tail = (arr: number[] | undefined, n = 120) => (arr ? arr.slice(Math.max(0, arr.length - n)) : []);

export function SimulationControls() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  const update = useSettingsStore((s) => s.update);
  if (!snap) return null;
  return (
    <>
      <Button
        variant="primary"
        size="sm"
        icon={snap.running ? <Pause size={13} /> : <Play size={13} />}
        onClick={() => void setRunning(!snap.running)}
      >
        {snap.running ? t('sim.pause') : t('sim.run')}
      </Button>
      <ButtonGroup label={t('sim.step')}>
        <Tooltip content={t('sim.stepHint')}>
          <Button size="sm" icon={<StepForward size={13} />} onClick={() => void stepSimulation(1)}>
            1 s
          </Button>
        </Tooltip>
        <Button size="sm" onClick={() => void stepSimulation(60)}>
          1 min
        </Button>
        <Button size="sm" onClick={() => void stepSimulation(900)}>
          15 min
        </Button>
      </ButtonGroup>
      <ToolbarSeparator />
      <span className="ap-toolbar__label">{t('sim.timeScale')}</span>
      <ButtonGroup label={t('sim.timeScale')}>
        {SCALES.map((s) => (
          <Button key={s} size="sm" pressed={snap.timeScale === s} onClick={() => void setTimeScale(s)}>
            {s}×
          </Button>
        ))}
      </ButtonGroup>
      <ToolbarSeparator />
      <div style={{ width: 170 }}>
        <Select
          aria-label={t('sim.failureRate')}
          value={String(snap.failureRateMultiplier)}
          options={[
            ...FAILURE_RATES.map((r) => ({ value: String(r), label: t('sim.failures', { rate: r }) })),
            ...(!FAILURE_RATES.includes(snap.failureRateMultiplier)
              ? [
                  {
                    value: String(snap.failureRateMultiplier),
                    label: t('sim.failures', { rate: snap.failureRateMultiplier }),
                  },
                ]
              : []),
          ]}
          onChange={(v) => update({ simulation: { failureRateMultiplier: Number(v) } })}
        />
      </div>
      <Toggle
        checked={snap.autoRemediation}
        onChange={(v) => update({ simulation: { autoRemediation: v } })}
        label={t('sim.autoRemediation')}
      />
    </>
  );
}

export function KeyFigures() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  const series = useEngineStore((s) => s.series);
  if (!snap) return null;
  const f = snap.facility;
  const c = snap.cluster;
  const it = fmt.power(f.itPowerW);
  const fac = fmt.power(f.facilityPowerW);
  const net = fmt.bandwidthGbps(c.fabricTrafficGbps);
  const pf = c.achievedPflops;
  const tok = fmt.count(c.trainingTokensPerSec + c.inferenceTokensPerSec);
  return (
    <div className="ap-kpis">
      <MetricTile
        label={t('kpi.itLoad')}
        value={it.value}
        unit={it.unit}
        trend={tail(series.itPowerW)}
        trendFormat={(v) => fmt.q(fmt.power(v))}
        foot={t('kpi.itLoad.foot', { gpu: fmt.q(fmt.power(c.gpuPowerW)) })}
      />
      <MetricTile
        label={t('kpi.facilityLoad')}
        value={fac.value}
        unit={fac.unit}
        trend={tail(series.facilityPowerW)}
        trendFormat={(v) => fmt.q(fmt.power(v))}
        foot={t('kpi.facilityLoad.foot', { cooling: fmt.q(fmt.power(f.coolingPowerW)) })}
      />
      <MetricTile
        label="PUE"
        value={fmt.formatNumber(f.pue, 3, 3)}
        trend={tail(series.pue)}
        trendFormat={(v) => fmt.formatNumber(v, 3, 3)}
        foot={t('kpi.pue.foot', {
          ambient: fmt.temperature(f.ambientC),
          free: fmt.percent(Math.max(f.freeCoolingChilled, f.freeCoolingWarm), 0),
        })}
      />
      <MetricTile
        label={t('kpi.gpuUtil')}
        value={fmt.formatNumber(c.gpuUtilAvg * 100, 1, 1)}
        unit="%"
        trend={tail(series.gpuUtil)}
        trendFormat={(v) => fmt.percent(v)}
        foot={t('kpi.gpuUtil.foot', {
          allocated: fmt.formatNumber(c.gpusAllocated),
          total: fmt.formatNumber(c.gpusTotal),
        })}
      />
      <MetricTile
        label={t('kpi.gpuTemp')}
        value={fmt.temperature(c.gpuTempAvg).replace(/\s?°[CF]$/, '')}
        unit={fmt.temperature(0).slice(-2)}
        trend={tail(series.gpuTempMax)}
        trendFormat={(v) => `max ${fmt.temperature(v)}`}
        trendColor="var(--series-2)"
        foot={t('kpi.gpuTemp.foot', { max: fmt.temperature(c.gpuTempMax), throttled: c.throttledGpus })}
      />
      <MetricTile
        label={t('kpi.fabric')}
        value={net.value}
        unit={net.unit}
        trend={tail(series.fabricGbps)}
        trendFormat={(v) => fmt.q(fmt.bandwidthGbps(v))}
        foot={t('kpi.fabric.foot', {
          share: fmt.percent(c.fabricCapacityGbps > 0 ? c.fabricTrafficGbps / c.fabricCapacityGbps : 0),
          down: c.switchesDown,
        })}
      />
      <MetricTile
        label={t('kpi.tokens')}
        value={tok.value}
        unit={tok.unit}
        trend={tail(series.trainTokS)}
        trendFormat={(v) => `${fmt.compact(v)}/s`}
        foot={t('kpi.tokens.foot', {
          train: fmt.compact(c.trainingTokensPerSec),
          infer: fmt.compact(c.inferenceTokensPerSec),
        })}
      />
      <MetricTile
        label={t('kpi.compute')}
        value={fmt.formatNumber(pf, pf >= 100 ? 0 : 1, pf >= 100 ? 0 : 1)}
        unit="PFLOP/s"
        trend={tail(series.achievedPflops)}
        trendFormat={(v) => `${fmt.formatNumber(v, 1, 1)} PF/s`}
        foot={t('kpi.compute.foot', {
          energy: fmt.q(fmt.energyWh(f.energyMWh * 1e6)),
          cost: fmt.currency(f.energyCostEur),
        })}
      />
    </div>
  );
}

function PowerBalance() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  if (!snap) return null;
  const f = snap.facility;
  const other = Math.max(0, f.facilityPowerW - f.itPowerW - f.coolingPowerW - f.upsLossW);
  const parts = [
    { key: 'it', label: t('monitor.power.it'), w: f.itPowerW, color: 'var(--series-1)' },
    { key: 'cool', label: t('monitor.power.cooling'), w: f.coolingPowerW, color: 'var(--series-3)' },
    { key: 'ups', label: t('monitor.power.ups'), w: f.upsLossW, color: 'var(--series-4)' },
    { key: 'other', label: t('monitor.power.other'), w: other, color: 'var(--viz-deemphasis)' },
  ];
  const total = Math.max(1, f.facilityPowerW);
  return (
    <Section
      title={t('monitor.power')}
      description={t('monitor.power.desc', { total: fmt.q(fmt.power(f.facilityPowerW)) })}
    >
      <div className="ap-stack-bar" role="img" aria-label={t('monitor.power')}>
        {parts.map((p) => (
          <span
            key={p.key}
            style={{ flexGrow: p.w / total, background: p.color }}
            title={`${p.label}: ${fmt.q(fmt.power(p.w))}`}
          />
        ))}
      </div>
      <ul className="ap-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="ap-legend__swatch" style={{ background: p.color }} />
            {p.label}
            <span className="num">{fmt.q(fmt.power(p.w))}</span>
            <span className="sf-muted num">{fmt.percent(p.w / total, 1)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function NodeStates() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  if (!snap) return null;
  const total = Math.max(1, snap.cluster.nodesTotal);
  const entries = NODE_STATE_NAMES.map((name, i) => ({ name, n: snap.cluster.nodesByState[i] ?? 0 })).filter(
    (e) => e.n > 0,
  );
  const color = (tone: string) =>
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warning'
        ? 'var(--status-warning)'
        : tone === 'critical'
          ? 'var(--status-critical)'
          : tone === 'info'
            ? 'var(--status-info)'
            : 'var(--status-neutral)';
  return (
    <Section
      title={t('monitor.nodes')}
      description={t('monitor.nodes.desc', { total: snap.cluster.nodesTotal })}
    >
      <div className="ap-stack-bar" role="img" aria-label={t('monitor.nodes')}>
        {entries.map((e) => (
          <span key={e.name} style={{ flexGrow: e.n / total, background: color(NODE_STATE_TONE[e.name]) }} />
        ))}
      </div>
      <ul className="ap-legend">
        {entries.map((e) => (
          <li key={e.name}>
            <span className="ap-legend__swatch" style={{ background: color(NODE_STATE_TONE[e.name]) }} />
            {t(nodeStateKey(e.name))}
            <span className="num">{e.n}</span>
            <span className="sf-muted num">{fmt.percent(e.n / total, 1)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function EnginePerf() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  const mode = useEngineStore((s) => s.mode);
  if (!snap) return null;
  const p = snap.perf;
  return (
    <Section title={t('monitor.engine')}>
      <KeyValue
        items={[
          [
            t('monitor.engine.thread'),
            mode === 'worker' ? t('monitor.engine.worker') : t('monitor.engine.inProcess'),
          ],
          [
            t('monitor.engine.tick'),
            `${fmt.formatNumber(p.tickMsAvg, 2, 2)} ms · p95 ${fmt.formatNumber(p.tickMsP95, 2, 2)} ms`,
          ],
          [t('monitor.engine.rate'), `${fmt.formatNumber(p.ticksPerSecond, 1, 1)} ticks/s`],
          [
            t('monitor.engine.speed'),
            `${fmt.formatNumber(p.simSecondsPerSecond, 1, 1)}× ${t('monitor.engine.realtime')}`,
          ],
          [
            t('monitor.engine.state'),
            p.lagging ? (
              <Badge tone="warning">{t('monitor.engine.lagging')}</Badge>
            ) : (
              <Badge tone="good">{t('monitor.engine.realtimeOk')}</Badge>
            ),
          ],
        ]}
      />
    </Section>
  );
}

export function MonitorApp() {
  const t = useT();
  const snap = useEngineStore((s) => s.snapshot);
  if (!snap) return <EmptyState icon={<Gauge size={28} />} title={t('app.waiting')} />;
  return (
    <AppFrame>
      <AppToolbar>
        <SimulationControls />
        <ToolbarSpacer />
        {!snap.running && <Badge tone="warning">{t('sim.paused')}</Badge>}
      </AppToolbar>
      <AppBody>
        <KeyFigures />
        <div className="ap-grid-3">
          <PowerBalance />
          <NodeStates />
          <EnginePerf />
        </div>
      </AppBody>
      <AppStatusBar>
        <span className="mono">SIM {fmt.dateTime(snap.time)}</span>
        <span className="mono">tick {fmt.formatNumber(snap.tick)}</span>
        <span className="mono">Δt {snap.dt} s</span>
        <span className="mono">{snap.timeScale}×</span>
      </AppStatusBar>
    </AppFrame>
  );
}
