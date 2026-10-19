/**
 * Window manager state: open, close, focus, move, resize, minimise, maximise, snap, tile,
 * z-order. Geometry is always clamped so a window's title bar stays reachable inside the
 * workspace.
 */
import { create } from 'zustand';

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowState extends Bounds {
  id: string;
  appId: string;
  title: string;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Docked to the left or right half of the workspace. */
  snapped: SnapSide | null;
  restoreBounds: Bounds | null;
  minW: number;
  minH: number;
  args?: Record<string, unknown>;
}

export type SnapSide = 'left' | 'right';
export type SnapZone = SnapSide | 'max';

export interface OpenOptions {
  title?: string;
  size?: { w: number; h: number };
  minSize?: { w: number; h: number };
  position?: { x: number; y: number };
  singleton?: boolean;
  args?: Record<string, unknown>;
}

interface WindowManagerState {
  windows: Record<string, WindowState>;
  order: string[];
  focusedId: string | null;
  viewport: { w: number; h: number };
  nextZ: number;
  counter: number;
  open: (appId: string, opts?: OpenOptions) => string;
  close: (id: string) => void;
  focus: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, bounds: Partial<Bounds>) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  restore: (id: string) => void;
  setViewport: (w: number, h: number) => void;
  closeAll: () => void;
  /** Docks a window to a half of the workspace or maximises it. */
  snap: (id: string, zone: SnapZone) => void;
  /** Leaves a maximised/snapped state while dragging: restores the size under the pointer. */
  unsnapAt: (id: string, pointerX: number, pointerY: number) => Bounds | null;
  /** Zone highlighted while a window is dragged against a workspace edge. */
  snapPreview: SnapZone | null;
  setSnapPreview: (zone: SnapZone | null) => void;
  setArgs: (id: string, args: Record<string, unknown>) => void;
  setTitle: (id: string, title: string) => void;
  minimizeAll: () => void;
  /** Arranges all visible windows in a grid. */
  tile: () => void;
  /** Focuses the next (or previous) window in stacking order. */
  cycle: (direction?: 1 | -1) => void;
  closeApp: (appId: string) => void;
}

/** Minimum visible part of a window that must stay inside the workspace. */
export const GRAB_MARGIN = 96;
export const TITLEBAR_HEIGHT = 34;

export function clampBounds(b: Bounds, vp: { w: number; h: number }, min: { w: number; h: number }): Bounds {
  const w = Math.max(min.w, Math.min(b.w, Math.max(min.w, vp.w)));
  const h = Math.max(min.h, Math.min(b.h, Math.max(min.h, vp.h)));
  const x = Math.min(Math.max(b.x, GRAB_MARGIN - w), Math.max(0, vp.w - GRAB_MARGIN));
  const y = Math.min(Math.max(b.y, 0), Math.max(0, vp.h - TITLEBAR_HEIGHT));
  return { x, y, w, h };
}

function topVisible(state: Pick<WindowManagerState, 'windows'>, exclude?: string): string | null {
  let best: WindowState | null = null;
  for (const w of Object.values(state.windows)) {
    if (w.id === exclude || w.minimized) continue;
    if (!best || w.z > best.z) best = w;
  }
  return best?.id ?? null;
}

export const useWindowStore = create<WindowManagerState>((set, get) => ({
  windows: {},
  order: [],
  focusedId: null,
  viewport: { w: 1440, h: 900 },
  nextZ: 1,
  counter: 0,

  open: (appId, opts = {}) => {
    const s = get();
    if (opts.singleton) {
      const existing = Object.values(s.windows).find((w) => w.appId === appId);
      if (existing) {
        get().restore(existing.id);
        get().focus(existing.id);
        return existing.id;
      }
    }
    const counter = s.counter + 1;
    const id = `${appId}#${counter}`;
    const size = opts.size ?? { w: 720, h: 480 };
    const min = opts.minSize ?? { w: 320, h: 200 };
    const cascade = (Object.keys(s.windows).length % 8) * 28;
    const pos = opts.position ?? {
      x: Math.max(0, (s.viewport.w - size.w) / 2 - 120 + cascade),
      y: Math.max(0, (s.viewport.h - size.h) / 2 - 80 + cascade),
    };
    const bounds = clampBounds({ ...pos, ...size }, s.viewport, min);
    const win: WindowState = {
      id,
      appId,
      title: opts.title ?? appId,
      ...bounds,
      z: s.nextZ,
      minimized: false,
      maximized: false,
      snapped: null,
      restoreBounds: null,
      minW: min.w,
      minH: min.h,
      ...(opts.args ? { args: opts.args } : {}),
    };
    set({
      windows: { ...s.windows, [id]: win },
      order: [...s.order, id],
      focusedId: id,
      nextZ: s.nextZ + 1,
      counter,
    });
    return id;
  },

  close: (id) => {
    const s = get();
    if (!s.windows[id]) return;
    const windows = { ...s.windows };
    delete windows[id];
    set({
      windows,
      order: s.order.filter((x) => x !== id),
      focusedId: s.focusedId === id ? topVisible({ windows }) : s.focusedId,
    });
  },

  focus: (id) => {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    if (s.focusedId === id && w.z === s.nextZ - 1 && !w.minimized) return;
    set({
      windows: { ...s.windows, [id]: { ...w, z: s.nextZ, minimized: false } },
      focusedId: id,
      nextZ: s.nextZ + 1,
    });
  },

  move: (id, x, y) => {
    const s = get();
    const w = s.windows[id];
    if (!w || w.maximized || w.snapped) return;
    const b = clampBounds({ x, y, w: w.w, h: w.h }, s.viewport, { w: w.minW, h: w.minH });
    set({ windows: { ...s.windows, [id]: { ...w, ...b } } });
  },

  resize: (id, bounds) => {
    const s = get();
    const w = s.windows[id];
    if (!w || w.maximized) return;
    const b = clampBounds({ x: w.x, y: w.y, w: w.w, h: w.h, ...bounds }, s.viewport, {
      w: w.minW,
      h: w.minH,
    });
    // Resizing a docked window detaches it (its new size becomes its own).
    set({ windows: { ...s.windows, [id]: { ...w, ...b, snapped: null, restoreBounds: null } } });
  },

  minimize: (id) => {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    const windows = { ...s.windows, [id]: { ...w, minimized: true } };
    set({ windows, focusedId: s.focusedId === id ? topVisible({ windows }, id) : s.focusedId });
  },

  toggleMaximize: (id) => {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    if (w.maximized && w.restoreBounds) {
      set({
        windows: {
          ...s.windows,
          [id]: { ...w, ...w.restoreBounds, maximized: false, snapped: null, restoreBounds: null },
        },
      });
    } else {
      const restoreBounds = w.restoreBounds ?? { x: w.x, y: w.y, w: w.w, h: w.h };
      set({
        windows: {
          ...s.windows,
          [id]: {
            ...w,
            x: 0,
            y: 0,
            w: s.viewport.w,
            h: s.viewport.h,
            maximized: true,
            snapped: null,
            restoreBounds,
            z: s.nextZ,
          },
        },
        focusedId: id,
        nextZ: s.nextZ + 1,
      });
    }
  },

  restore: (id) => {
    const s = get();
    const w = s.windows[id];
    if (!w || !w.minimized) return;
    set({ windows: { ...s.windows, [id]: { ...w, minimized: false } } });
  },

  setViewport: (vw, vh) => {
    const s = get();
    const viewport = { w: Math.max(320, vw), h: Math.max(240, vh) };
    const windows: Record<string, WindowState> = {};
    for (const [id, w] of Object.entries(s.windows)) {
      windows[id] = w.maximized
        ? { ...w, x: 0, y: 0, w: viewport.w, h: viewport.h }
        : w.snapped
          ? { ...w, ...snapBounds(w.snapped, viewport) }
          : { ...w, ...clampBounds(w, viewport, { w: w.minW, h: w.minH }) };
    }
    set({ viewport, windows });
  },

  closeAll: () => set({ windows: {}, order: [], focusedId: null }),

  snap: (id, zone) => {
    const s = get();
    const w = s.windows[id];
    if (!w) return;
    const restoreBounds = w.restoreBounds ?? { x: w.x, y: w.y, w: w.w, h: w.h };
    const next: WindowState =
      zone === 'max'
        ? {
            ...w,
            x: 0,
            y: 0,
            w: s.viewport.w,
            h: s.viewport.h,
            maximized: true,
            snapped: null,
            restoreBounds,
          }
        : { ...w, ...snapBounds(zone, s.viewport), maximized: false, snapped: zone, restoreBounds };
    set({
      windows: { ...s.windows, [id]: { ...next, minimized: false, z: s.nextZ } },
      focusedId: id,
      nextZ: s.nextZ + 1,
      snapPreview: null,
    });
  },

  unsnapAt: (id, px, py) => {
    const s = get();
    const w = s.windows[id];
    if (!w || (!w.maximized && !w.snapped)) return null;
    const rb = w.restoreBounds ?? { x: w.x, y: w.y, w: Math.min(w.w, 960), h: Math.min(w.h, 640) };
    // Keep the grabbed point of the title bar under the pointer.
    const rel = w.w > 0 ? (px - w.x) / w.w : 0.5;
    const b = clampBounds(
      { x: px - rb.w * rel, y: Math.max(0, py - Math.min(16, py - w.y)), w: rb.w, h: rb.h },
      s.viewport,
      { w: w.minW, h: w.minH },
    );
    set({
      windows: { ...s.windows, [id]: { ...w, ...b, maximized: false, snapped: null, restoreBounds: null } },
    });
    return b;
  },

  snapPreview: null,
  setSnapPreview: (zone) => {
    if (get().snapPreview !== zone) set({ snapPreview: zone });
  },

  setArgs: (id, args) => {
    const s = get();
    const w = s.windows[id];
    if (w) set({ windows: { ...s.windows, [id]: { ...w, args } } });
  },

  setTitle: (id, title) => {
    const s = get();
    const w = s.windows[id];
    if (w && w.title !== title) set({ windows: { ...s.windows, [id]: { ...w, title } } });
  },

  minimizeAll: () => {
    const s = get();
    const windows: Record<string, WindowState> = {};
    for (const [id, w] of Object.entries(s.windows)) windows[id] = { ...w, minimized: true };
    set({ windows, focusedId: null });
  },

  tile: () => {
    const s = get();
    const visible = Object.values(s.windows)
      .filter((w) => !w.minimized)
      .sort((a, b) => a.z - b.z);
    if (visible.length === 0) return;
    const cols = Math.ceil(Math.sqrt(visible.length));
    const rows = Math.ceil(visible.length / cols);
    const gap = 8;
    const cw = (s.viewport.w - gap * (cols + 1)) / cols;
    const ch = (s.viewport.h - gap * (rows + 1)) / rows;
    const windows = { ...s.windows };
    visible.forEach((w, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      windows[w.id] = {
        ...w,
        x: Math.round(gap + c * (cw + gap)),
        y: Math.round(gap + r * (ch + gap)),
        w: Math.round(Math.max(w.minW, cw)),
        h: Math.round(Math.max(w.minH, ch)),
        maximized: false,
        snapped: null,
        restoreBounds: null,
      };
    });
    set({ windows });
  },

  cycle: (direction = 1) => {
    const s = get();
    const list = Object.values(s.windows).sort((a, b) => a.z - b.z);
    if (list.length === 0) return;
    if (direction === 1) {
      // Bring the bottom-most window to the front.
      get().focus(list[0]!.id);
    } else {
      // Send the front window to the back: re-focus all others in order.
      const front = list[list.length - 1]!;
      const others = list.slice(0, -1);
      let z = s.nextZ;
      const windows = { ...s.windows, [front.id]: { ...front, z: (list[0]?.z ?? 1) - 1 } };
      for (const w of others) windows[w.id] = { ...w, z: z++ };
      const target = others[others.length - 1];
      set({ windows, nextZ: z, focusedId: target?.id ?? front.id });
      if (target?.minimized) get().restore(target.id);
    }
  },

  closeApp: (appId) => {
    for (const w of Object.values(get().windows)) if (w.appId === appId) get().close(w.id);
  },
}));

export function snapBounds(side: SnapSide, vp: { w: number; h: number }): Bounds {
  const w = Math.round(vp.w / 2);
  return { x: side === 'left' ? 0 : vp.w - w, y: 0, w, h: vp.h };
}
