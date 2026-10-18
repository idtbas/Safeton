import { AppWindow, Cpu, Gauge, Layers, Plus, Thermometer, Zap } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACCENTS, type AccentName } from '../os/settings/schema';
import { useSettingsStore } from '../os/settings/store';
import { useNotificationStore } from '../os/notifications/store';
import { WindowFrame } from '../os/windows/WindowFrame';
import { useWindowStore } from '../os/windows/store';
import {
  Badge,
  Button,
  ButtonGroup,
  Dialog,
  Input,
  Kbd,
  KeyValue,
  Meter,
  MetricTile,
  Panel,
  Progress,
  Segments,
  Select,
  Slider,
  Sparkline,
  StatusBadge,
  Table,
  Tabs,
  Toggle,
  Tooltip,
  fmt,
  type Column,
} from '../ui';

function wave(n: number, seed: number, base = 0.5, amp = 0.3): number[] {
  return Array.from({ length: n }, (_, i) => base + amp * Math.sin(i / 6 + seed) + amp * 0.35 * Math.sin(i / 2.3 + seed * 2));
}

export function Gallery() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const push = useNotificationStore((s) => s.push);
  const [tab, setTab] = useState<'controls' | 'data' | 'feedback'>('controls');
  const [dialog, setDialog] = useState(false);
  const [toggle, setToggle] = useState(true);
  const [slider, setSlider] = useState(700);
  const [sel, setSel] = useState('h100');
  const rows = useMemo(
    () =>
      Array.from({ length: 10_000 }, (_, i) => ({
        id: i,
        host: `gpu-h${1 + (i % 4)}a${String(1 + ((i >> 2) % 32)).padStart(2, '0')}-${String(1 + (i % 4)).padStart(2, '0')}`,
        util: (Math.sin(i * 1.7) + 1) / 2,
        temp: 40 + ((i * 37) % 45),
        power: 2000 + ((i * 7919) % 9000),
      })),
    [],
  );
  const cols: Column<(typeof rows)[number]>[] = [
    { id: 'id', header: '#', width: '70px', cell: (r) => <span className="mono sf-muted">{r.id}</span>, sortValue: (r) => r.id },
    { id: 'host', header: 'Hostname', width: 'minmax(140px,1fr)', cell: (r) => <span className="mono">{r.host}</span>, sortValue: (r) => r.host },
    { id: 'util', header: 'Util', width: '90px', align: 'right', cell: (r) => fmt.percent(r.util, 0), sortValue: (r) => r.util },
    { id: 'temp', header: 'Temp', width: '90px', align: 'right', cell: (r) => fmt.temperature(r.temp), sortValue: (r) => r.temp },
    { id: 'power', header: 'Power', width: '100px', align: 'right', cell: (r) => fmt.q(fmt.power(r.power)), sortValue: (r) => r.power },
  ];

  return (
    <main className="pv-gallery">
      <div className="pv-gallery__intro">
        <h1>Design system</h1>
        <p className="sf-secondary">Tokens, components and window chrome shared by every Safeton surface. Theme and accent apply live.</p>
        <div className="pv-btn-row">
          <ButtonGroup label="Theme">
            {(['dark', 'light', 'system'] as const).map((t) => (
              <Button key={t} pressed={settings.appearance.theme === t} onClick={() => update({ appearance: { theme: t } })}>
                {t}
              </Button>
            ))}
          </ButtonGroup>
          <ButtonGroup label="Density">
            {(['compact', 'comfortable'] as const).map((d) => (
              <Button key={d} pressed={settings.appearance.density === d} onClick={() => update({ appearance: { density: d } })}>
                {d}
              </Button>
            ))}
          </ButtonGroup>
          <div className="pv-accents" role="radiogroup" aria-label="Accent colour">
            {(Object.keys(ACCENTS) as AccentName[]).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={settings.appearance.accent === a}
                aria-label={ACCENTS[a].label}
                title={ACCENTS[a].label}
                className="pv-accent"
                style={{ ['--h' as string]: ACCENTS[a].hue, ['--c' as string]: a === 'graphite' ? 0.03 : 0.13 }}
                onClick={() => update({ appearance: { accent: a } })}
              />
            ))}
          </div>
          <Select
            aria-label="Reduced motion"
            value={settings.appearance.reducedMotion}
            options={[
              { value: 'system', label: 'Motion: system' },
              { value: 'on', label: 'Motion: reduced' },
              { value: 'off', label: 'Motion: full' },
            ]}
            onChange={(v) => update({ appearance: { reducedMotion: v } })}
          />
        </div>
      </div>

      <Tabs
        items={[
          { id: 'controls', label: 'Controls' },
          { id: 'data', label: 'Data display' },
          { id: 'feedback', label: 'Feedback & windows' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'controls' && (
        <div className="pv-gallery__grid">
          <Panel title="Buttons">
            <div className="pv-stack">
              <div className="pv-btn-row">
                <Button variant="primary">Primary</Button>
                <Button>Default</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Danger</Button>
                <Button disabled>Disabled</Button>
                <Button loading>Working</Button>
              </div>
              <div className="pv-btn-row">
                <Button size="sm" icon={<Plus size={12} />}>
                  Small
                </Button>
                <Button iconOnly icon={<Cpu size={14} />} aria-label="Icon button" />
                <ButtonGroup label="Segmented">
                  <Button pressed>1×</Button>
                  <Button>10×</Button>
                  <Button>60×</Button>
                </ButtonGroup>
                <span>
                  <Kbd>⌘</Kbd> <Kbd>K</Kbd>
                </span>
              </div>
            </div>
          </Panel>
          <Panel title="Inputs">
            <div className="pv-form-grid">
              <Input label="Hostname" defaultValue="gpu-h1a01-01" mono />
              <Input label="Power limit" defaultValue="700" suffix="W" mono hint="H100 range 200–700 W" />
              <Input label="Seed" defaultValue="abc" error="Must be an integer" mono />
              <Select
                label="GPU model"
                value={sel}
                onChange={setSel}
                options={[
                  { value: 'h100', label: 'H100 SXM5 80GB' },
                  { value: 'h200', label: 'H200 SXM5 141GB' },
                  { value: 'b200', label: 'B200 SXM6 180GB' },
                ]}
              />
            </div>
          </Panel>
          <Panel title="Toggle & slider">
            <div className="pv-stack">
              <Toggle checked={toggle} onChange={setToggle} label="Automated remediation" />
              <Toggle checked={false} onChange={() => undefined} label="Disabled toggle" disabled />
              <Slider value={slider} min={200} max={700} step={10} onChange={setSlider} format={(v) => `${v} W`} label="GPU power limit" />
            </div>
          </Panel>
          <Panel title="Badges & status">
            <div className="pv-btn-row">
              <StatusBadge tone="good" label="Online" />
              <StatusBadge tone="warning" label="Degraded" />
              <StatusBadge tone="serious" label="Restarting" />
              <StatusBadge tone="critical" label="Failed" />
              <StatusBadge tone="info" label="Booting" pulse />
              <StatusBadge tone="neutral" label="Offline" />
              <Badge tone="accent">job 1004</Badge>
              <Badge outline>NDR 400G</Badge>
              <Badge tone="warning" dot>
                Lagging
              </Badge>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'data' && (
        <div className="pv-gallery__grid">
          <div className="pv-kpis" style={{ gridColumn: '1 / -1' }}>
            <MetricTile label="IT load" value="5.21" unit="MW" icon={<Zap size={12} />} trend={wave(60, 1, 5, 0.3)} trendFormat={(v) => `${fmt.formatNumber(v, 2, 2)} MW`} foot="GPUs 3.4 MW" />
            <MetricTile label="PUE" value="1.142" icon={<Gauge size={12} />} trend={wave(60, 2, 1.15, 0.02)} trendFormat={(v) => fmt.formatNumber(v, 3, 3)} delta={{ text: '−0.011 vs 24 h', direction: 'down', good: true }} />
            <MetricTile label="GPU temperature" value="71.4" unit="°C avg" icon={<Thermometer size={12} />} trend={wave(60, 3, 72, 4)} trendColor="var(--series-2)" foot="max 83.9 °C" />
            <MetricTile label="Utilisation" value="93.8" unit="%" icon={<Layers size={12} />} trend={wave(60, 4, 0.9, 0.05)} foot="3 842 / 4 096 GPUs" />
          </div>
          <Panel title="Progress & meters">
            <div className="pv-stack">
              <Progress value={0.42} label="Training progress" />
              <Meter value={0.86} label="Rack power (warning above 80 %)" />
              <Meter value={0.97} label="Hall air load (critical above 95 %)" />
              <Progress indeterminate label="Initialising" />
              <Segments total={6} on={5} label="PSUs healthy" />
            </div>
          </Panel>
          <Panel title="Sparklines">
            <div className="pv-stack">
              <Sparkline values={wave(80, 5)} width={260} height={32} format={(v) => fmt.formatNumber(v, 2, 2)} label="Series 1" />
              <Sparkline values={wave(80, 6)} width={260} height={32} color="var(--series-2)" format={(v) => fmt.formatNumber(v, 2, 2)} label="Series 2" />
              <Sparkline values={wave(80, 7)} width={260} height={32} color="var(--series-3)" area={false} label="Series 3" />
            </div>
          </Panel>
          <Panel title="Key / value">
            <KeyValue
              items={[
                ['Peak BF16 (dense)', '4 052.6 PFLOP/s'],
                ['HBM', '577.5 TB · 19.7 PB/s'],
                ['Fabric', 'rail-optimized, 2-tier, 8 planes'],
                ['PUE annual / peak', '1.148 / 1.331'],
              ]}
            />
          </Panel>
          <Panel title="Virtualised table — 10 000 rows" flush style={{ gridColumn: '1 / -1' }}>
            <div style={{ height: 320 }}>
              <Table rows={rows} columns={cols} rowKey={(r) => r.id} label="Demo table" initialSort={{ id: 'id', dir: 'asc' }} />
            </div>
          </Panel>
          <Panel title="Categorical palette (validated)" style={{ gridColumn: '1 / -1' }}>
            <div className="pv-swatches">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="pv-swatch">
                  <span style={{ background: `var(--series-${i})` }} />
                  <span className="mono sf-muted">series-{i}</span>
                </div>
              ))}
              {(['good', 'warning', 'serious', 'critical'] as const).map((s) => (
                <div key={s} className="pv-swatch">
                  <span style={{ background: `var(--status-${s})` }} />
                  <span className="mono sf-muted">status-{s}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {tab === 'feedback' && (
        <div className="pv-gallery__grid">
          <Panel title="Dialog, tooltip, notifications">
            <div className="pv-btn-row">
              <Button onClick={() => setDialog(true)}>Open dialog</Button>
              <Tooltip content="Tooltips appear on hover and keyboard focus">
                <Button>Hover me</Button>
              </Tooltip>
              <Button onClick={() => push({ severity: 'warning', title: 'PSU failed', body: 'gpu-h1a03-02: PSU3 output fault — redundancy reduced to N+1', source: 'demo' })}>
                Warning toast
              </Button>
              <Button variant="danger" onClick={() => push({ severity: 'critical', title: 'Node failed', body: 'gpu-h2b11-04: Kernel panic — not syncing: Fatal exception', source: 'demo' })}>
                Critical toast
              </Button>
            </div>
          </Panel>
          <WindowSandbox />
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="Drain 4 nodes?"
            description="Running jobs continue; no new work is scheduled on these nodes."
            footer={
              <>
                <Button onClick={() => setDialog(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => setDialog(false)}>
                  Drain
                </Button>
              </>
            }
          >
            <p className="sf-secondary">gpu-h1a01-01, gpu-h1a01-02, gpu-h1a01-03, gpu-h1a01-04</p>
          </Dialog>
        </div>
      )}
    </main>
  );
}

function WindowSandbox() {
  const ref = useRef<HTMLDivElement>(null);
  const windows = useWindowStore((s) => s.windows);
  const order = useWindowStore((s) => s.order);
  const open = useWindowStore((s) => s.open);
  const setViewport = useWindowStore((s) => s.setViewport);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientWidth, el.clientHeight));
    ro.observe(el);
    setViewport(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, [setViewport]);

  return (
    <Panel
      title="Window manager sandbox"
      subtitle={`${order.length} window${order.length === 1 ? '' : 's'} · drag, resize, double-click title to maximise`}
      icon={<AppWindow size={14} />}
      actions={
        <Button size="sm" icon={<Plus size={12} />} onClick={() => open('demo', { title: `Window ${order.length + 1}`, size: { w: 360, h: 220 }, minSize: { w: 240, h: 140 } })}>
          New window
        </Button>
      }
      flush
      style={{ gridColumn: '1 / -1' }}
    >
      <div ref={ref} className="os-workspace">
        {order.map((id) => {
          const w = windows[id];
          return w ? (
            <WindowFrame key={id} win={w}>
              <div className="pv-stack" style={{ padding: 12 }}>
                <KeyValue
                  items={[
                    ['Position', `${Math.round(w.x)}, ${Math.round(w.y)}`],
                    ['Size', `${Math.round(w.w)} × ${Math.round(w.h)}`],
                    ['z-index', w.z],
                    ['State', w.maximized ? 'maximised' : 'normal'],
                  ]}
                />
              </div>
            </WindowFrame>
          ) : null;
        })}
        {order.length === 0 && <div className="sf-empty">No windows open.</div>}
        <MinimizedDock />
      </div>
    </Panel>
  );
}

function MinimizedDock() {
  const windows = useWindowStore((s) => s.windows);
  const focus = useWindowStore((s) => s.focus);
  const minimized = Object.values(windows).filter((w) => w.minimized);
  if (minimized.length === 0) return null;
  return (
    <div className="os-dock">
      {minimized.map((w) => (
        <Button key={w.id} size="sm" onClick={() => focus(w.id)}>
          {w.title}
        </Button>
      ))}
    </div>
  );
}
