/**
 * Window chrome bound to the window store: drag by title bar, resize from edges and corners,
 * minimise / maximise / close, focus on pointer-down, edge snapping (left / right half, top =
 * maximise) with a preview, and dragging a maximised or docked window back out of its slot.
 */
import { Copy, Minus, Square, X } from 'lucide-react';
import {
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useWindowStore, type SnapZone, type WindowState } from './store';

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
/** Distance from a workspace edge (px) that triggers snapping. */
const SNAP_EDGE = 6;
/** Pointer travel before a maximised/docked window detaches. */
const DETACH_THRESHOLD = 6;

export interface WindowFrameLabels {
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
}

const DEFAULT_LABELS: WindowFrameLabels = {
  minimize: 'Minimise',
  maximize: 'Maximise',
  restore: 'Restore',
  close: 'Close',
};

export function WindowFrame({
  win,
  children,
  title,
  icon,
  snap = true,
  labels = DEFAULT_LABELS,
  onTitleContextMenu,
}: {
  win: WindowState;
  children: ReactNode;
  /** Rendered title (defaults to the stored title). */
  title?: ReactNode;
  icon?: ReactNode;
  /** Enables edge snapping while dragging. */
  snap?: boolean;
  labels?: WindowFrameLabels;
  onTitleContextMenu?: (e: ReactMouseEvent) => void;
}) {
  const focused = useWindowStore((s) => s.focusedId === win.id);
  const { focus, move, resize, close, minimize, toggleMaximize } = useWindowStore.getState();
  const drag = useRef<{
    kind: 'move' | Edge;
    sx: number;
    sy: number;
    b: { x: number; y: number; w: number; h: number };
    area: DOMRect | null;
    detached: boolean;
    zone: SnapZone | null;
  } | null>(null);

  const begin = (kind: 'move' | Edge, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    focus(win.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const area =
      (e.currentTarget as HTMLElement).closest('[data-window-area]')?.getBoundingClientRect() ?? null;
    drag.current = {
      kind,
      sx: e.clientX,
      sy: e.clientY,
      b: { x: win.x, y: win.y, w: win.w, h: win.h },
      area,
      detached: !(win.maximized || win.snapped),
      zone: null,
    };
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const store = useWindowStore.getState();
    let dx = e.clientX - d.sx;
    let dy = e.clientY - d.sy;
    if (d.kind === 'move') {
      if (!d.detached) {
        if (Math.hypot(dx, dy) < DETACH_THRESHOLD) return;
        const ax = d.area ? e.clientX - d.area.left : e.clientX;
        const ay = d.area ? e.clientY - d.area.top : e.clientY;
        const b = store.unsnapAt(win.id, ax, ay);
        if (!b) return;
        d.detached = true;
        d.b = b;
        d.sx = e.clientX;
        d.sy = e.clientY;
        dx = 0;
        dy = 0;
      }
      move(win.id, d.b.x + dx, d.b.y + dy);
      if (snap && d.area) {
        const px = e.clientX - d.area.left;
        const py = e.clientY - d.area.top;
        d.zone =
          py <= SNAP_EDGE
            ? 'max'
            : px <= SNAP_EDGE
              ? 'left'
              : px >= d.area.width - SNAP_EDGE
                ? 'right'
                : null;
        store.setSnapPreview(d.zone);
      }
      return;
    }
    let { x, y, w, h } = d.b;
    if (d.kind.includes('e')) w = d.b.w + dx;
    if (d.kind.includes('s')) h = d.b.h + dy;
    if (d.kind.includes('w')) {
      w = Math.max(win.minW, d.b.w - dx);
      x = d.b.x + (d.b.w - w);
    }
    if (d.kind.includes('n')) {
      h = Math.max(win.minH, d.b.h - dy);
      y = d.b.y + (d.b.h - h);
    }
    resize(win.id, { x, y, w, h });
  };

  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const store = useWindowStore.getState();
    if (d.zone) store.snap(win.id, d.zone);
    store.setSnapPreview(null);
  };

  if (win.minimized) return null;
  const restored = win.maximized || !!win.snapped;
  return (
    <div
      className="os-window"
      data-window-id={win.id}
      data-app={win.appId}
      data-focused={focused || undefined}
      data-maximized={win.maximized || undefined}
      data-snapped={win.snapped ?? undefined}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDown={() => focus(win.id)}
      role="dialog"
      aria-label={typeof title === 'string' ? title : win.title}
    >
      <div
        className="os-window__titlebar"
        onPointerDown={(e) => begin('move', e)}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest('button')) toggleMaximize(win.id);
        }}
        onContextMenu={onTitleContextMenu}
      >
        {icon && <span className="os-window__icon">{icon}</span>}
        <span className="os-window__title">{title ?? win.title}</span>
        <div className="os-window__controls">
          <button
            type="button"
            aria-label={labels.minimize}
            title={labels.minimize}
            onClick={() => minimize(win.id)}
          >
            <Minus size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label={restored ? labels.restore : labels.maximize}
            title={restored ? labels.restore : labels.maximize}
            onClick={() =>
              win.snapped ? useWindowStore.getState().snap(win.id, 'max') : toggleMaximize(win.id)
            }
          >
            {win.maximized ? <Copy size={11} strokeWidth={1.8} /> : <Square size={10} strokeWidth={1.9} />}
          </button>
          <button
            type="button"
            aria-label={labels.close}
            title={labels.close}
            className="os-window__close"
            onClick={() => close(win.id)}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div className="os-window__body">{children}</div>
      {!win.maximized &&
        EDGES.map((edge) => (
          <div
            key={edge}
            className={`os-window__edge os-window__edge--${edge}`}
            onPointerDown={(e) => begin(edge, e)}
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
    </div>
  );
}
