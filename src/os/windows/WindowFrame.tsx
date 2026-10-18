/**
 * Window chrome bound to the window store: drag by title bar, resize from edges and corners,
 * minimise / maximise / close, focus on pointer-down. Pointer capture keeps drags robust.
 */
import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useWindowStore, type WindowState } from './store';

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export function WindowFrame({ win, children }: { win: WindowState; children: ReactNode }) {
  const focused = useWindowStore((s) => s.focusedId === win.id);
  const { focus, move, resize, close, minimize, toggleMaximize } = useWindowStore.getState();
  const drag = useRef<{ kind: 'move' | Edge; sx: number; sy: number; b: { x: number; y: number; w: number; h: number } } | null>(null);

  const begin = (kind: 'move' | Edge, e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    focus(win.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, sx: e.clientX, sy: e.clientY, b: { x: win.x, y: win.y, w: win.w, h: win.h } };
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.kind === 'move') {
      move(win.id, d.b.x + dx, d.b.y + dy);
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
    drag.current = null;
  };

  if (win.minimized) return null;
  return (
    <div
      className="os-window"
      data-focused={focused || undefined}
      data-maximized={win.maximized || undefined}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onPointerDown={() => focus(win.id)}
      role="dialog"
      aria-label={win.title}
    >
      <div
        className="os-window__titlebar"
        onPointerDown={(e) => begin('move', e)}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => toggleMaximize(win.id)}
      >
        <span className="os-window__title">{win.title}</span>
        <div className="os-window__controls">
          <button type="button" aria-label="Minimise" onClick={() => minimize(win.id)}>
            <Minus size={12} />
          </button>
          <button type="button" aria-label={win.maximized ? 'Restore' : 'Maximise'} onClick={() => toggleMaximize(win.id)}>
            {win.maximized ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
          <button type="button" aria-label="Close" className="os-window__close" onClick={() => close(win.id)}>
            <X size={12} />
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
