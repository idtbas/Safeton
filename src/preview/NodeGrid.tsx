/**
 * Canvas fleet map: one cell per node, coloured by a sequential ramp (utilisation, max GPU
 * temperature or power), with state overriding the fill (offline, failed, maintenance) and a
 * ring for degraded nodes. Scales to tens of thousands of cells.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NODE_STATE_NAMES, NodeState, type Snapshot, type TopologyInfo } from '../engine';
import { fmt } from '../ui';
import { NODE_STATE_LABEL } from './shared';

export type GridMetric = 'util' | 'temp' | 'power';

const BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const ORANGE = ['#fbd9c9', '#f6b598', '#ef9167', '#e5703f', '#c95520', '#a14217', '#77300f'];

/** Low values recede toward the surface: light-to-dark on light themes, dark-to-light on dark. */
function rampFor(metric: GridMetric): string[] {
  const base = metric === 'util' ? BLUE : ORANGE;
  return document.documentElement.dataset.theme === 'light' ? base : [...base].reverse();
}

function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function NodeGrid({
  topology,
  snapshot,
  metric,
  selected,
  onSelect,
}: {
  topology: TopologyInfo;
  snapshot: Snapshot;
  metric: GridMetric;
  selected: number | null;
  onSelect: (node: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const n = topology.nodes.length;
  const cell = n <= 64 ? 22 : n <= 512 ? 12 : n <= 2048 ? 8 : 6;
  const gap = n <= 512 ? 2 : 1;
  const pitch = cell + gap;
  const cols = Math.max(1, Math.floor(width / pitch));
  const rows = Math.ceil(n / cols);
  const height = rows * pitch;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(cols * pitch * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cols * pitch, height);
    const off = readVar('--bg-4');
    const failed = readVar('--status-critical');
    const warn = readVar('--status-warning');
    const info = readVar('--status-info');
    const accent = readVar('--accent');
    const ramp = rampFor(metric);
    const s = snapshot.nodes;
    let maxPower = 1;
    if (metric === 'power') for (let i = 0; i < n; i++) maxPower = Math.max(maxPower, s.powerW[i]!);
    for (let i = 0; i < n; i++) {
      const x = (i % cols) * pitch;
      const y = Math.floor(i / cols) * pitch;
      const st = s.state[i]!;
      let color: string;
      if (st === NodeState.Offline || st === NodeState.Maintenance) color = off;
      else if (st === NodeState.Failed) color = failed;
      else if (st === NodeState.Post || st === NodeState.Booting || st === NodeState.ShuttingDown)
        color = info;
      else {
        const v =
          metric === 'util'
            ? s.gpuUtil[i]!
            : metric === 'temp'
              ? (s.gpuTempMax[i]! - 25) / 65
              : s.powerW[i]! / maxPower;
        color = ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(v * ramp.length)))]!;
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, cell, cell);
      if (st === NodeState.Degraded || st === NodeState.Draining) {
        ctx.strokeStyle = st === NodeState.Degraded ? warn : info;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }
      if (i === selected) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 1, y - 1, cell + 2, cell + 2);
      }
    }
  }, [snapshot, metric, cols, pitch, cell, height, n, selected]);

  const indexAt = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const cx = Math.floor((e.clientX - r.left) / pitch);
    const cy = Math.floor((e.clientY - r.top) / pitch);
    if (cx < 0 || cx >= cols) return -1;
    const i = cy * cols + cx;
    return i >= 0 && i < n ? i : -1;
  };

  const h = hover;
  return (
    <div ref={wrapRef} className="pv-grid">
      <canvas
        ref={canvasRef}
        style={{ width: cols * pitch, height }}
        role="img"
        aria-label={`Fleet map of ${n} nodes coloured by ${metric}`}
        onMouseMove={(e) => {
          const i = indexAt(e);
          setHover(i >= 0 ? { i, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY } : null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const i = indexAt(e);
          if (i >= 0) onSelect(i);
        }}
      />
      {h && (
        <div className="pv-grid__tip" style={{ left: Math.min(h.x + 14, width - 220), top: h.y + 14 }}>
          <div className="mono" style={{ fontWeight: 600 }}>
            {topology.nodes[h.i]!.hostname}
          </div>
          <div className="sf-muted">
            {topology.racks[topology.nodes[h.i]!.rack]!.name} ·{' '}
            {NODE_STATE_LABEL[NODE_STATE_NAMES[snapshot.nodes.state[h.i]!]!]}
          </div>
          <div className="mono">
            util {fmt.percent(snapshot.nodes.gpuUtil[h.i]!, 0)} ·{' '}
            {fmt.temperature(snapshot.nodes.gpuTempMax[h.i]!)} ·{' '}
            {fmt.q(fmt.power(snapshot.nodes.powerW[h.i]!))}
          </div>
          {snapshot.nodes.job[h.i]! >= 0 && <div className="sf-muted">job {snapshot.nodes.job[h.i]}</div>}
        </div>
      )}
      <div className="pv-grid__legend">
        <span className="sf-muted">
          {metric === 'util' ? 'GPU util' : metric === 'temp' ? 'Max GPU temp' : 'Node power'}
        </span>
        <span
          className="pv-grid__ramp"
          style={{ background: `linear-gradient(to right, ${rampFor(metric).join(',')})` }}
        />
        <span className="sf-muted mono">
          {metric === 'util' ? '0–100 %' : metric === 'temp' ? '25–90 °C' : `0–max`}
        </span>
        <span className="pv-grid__key" style={{ background: 'var(--bg-4)' }} />{' '}
        <span className="sf-muted">off / maint.</span>
        <span className="pv-grid__key" style={{ background: 'var(--status-info)' }} />{' '}
        <span className="sf-muted">booting</span>
        <span className="pv-grid__key" style={{ boxShadow: 'inset 0 0 0 1px var(--status-warning)' }} />{' '}
        <span className="sf-muted">degraded</span>
        <span className="pv-grid__key" style={{ background: 'var(--status-critical)' }} />{' '}
        <span className="sf-muted">failed</span>
      </div>
    </div>
  );
}
