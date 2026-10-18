/**
 * Window manager state: open, close, focus, move, resize, minimise, maximise, z-order.
 * Geometry is always clamped so a window's title bar stays reachable inside the workspace.
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
  restoreBounds: Bounds | null;
  minW: number;
  minH: number;
  args?: Record<string, unknown>;
}

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
    if (!w || w.maximized) return;
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
    set({ windows: { ...s.windows, [id]: { ...w, ...b } } });
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
        windows: { ...s.windows, [id]: { ...w, ...w.restoreBounds, maximized: false, restoreBounds: null } },
      });
    } else {
      const restoreBounds = { x: w.x, y: w.y, w: w.w, h: w.h };
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
        : { ...w, ...clampBounds(w, viewport, { w: w.minW, h: w.minH }) };
    }
    set({ viewport, windows });
  },

  closeAll: () => set({ windows: {}, order: [], focusedId: null }),
}));
