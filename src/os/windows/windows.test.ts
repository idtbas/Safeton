import { beforeEach, describe, expect, it } from 'vitest';
import { snapBounds, useWindowStore } from './store';

const ws = () => useWindowStore.getState();

describe('window manager: snapping and arrangement', () => {
  beforeEach(() => {
    ws().closeAll();
    ws().setViewport(1400, 800);
  });

  it('docks a window to a half and restores its size when dragged out', () => {
    const id = ws().open('demo', { size: { w: 600, h: 400 }, position: { x: 100, y: 80 } });
    ws().snap(id, 'left');
    expect(ws().windows[id]).toMatchObject({ x: 0, y: 0, w: 700, h: 800, snapped: 'left', maximized: false });
    // Resizing the viewport keeps the docked layout.
    ws().setViewport(1200, 700);
    expect(ws().windows[id]).toMatchObject(snapBounds('left', { w: 1200, h: 700 }));
    ws().setViewport(1400, 800);
    const b = ws().unsnapAt(id, 350, 10)!;
    expect(b).toMatchObject({ w: 600, h: 400 });
    expect(ws().windows[id]).toMatchObject({ snapped: null, restoreBounds: null });
    // The grabbed point stays under the pointer (50 % across the title bar).
    expect(b.x).toBeCloseTo(350 - 300, 0);
  });

  it('maximises via snap and toggles back to the original bounds', () => {
    const id = ws().open('demo', { size: { w: 500, h: 300 }, position: { x: 40, y: 40 } });
    ws().snap(id, 'right');
    ws().snap(id, 'max');
    expect(ws().windows[id]).toMatchObject({ maximized: true, w: 1400, h: 800 });
    ws().toggleMaximize(id);
    expect(ws().windows[id]).toMatchObject({ maximized: false, x: 40, y: 40, w: 500, h: 300 });
  });

  it('tiles visible windows without overlap and minimises all', () => {
    const ids = ['a', 'b', 'c', 'd'].map((app) =>
      ws().open(app, { size: { w: 500, h: 400 }, minSize: { w: 200, h: 150 } }),
    );
    ws().tile();
    const rects = ids.map((id) => ws().windows[id]!);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    ws().minimizeAll();
    expect(Object.values(ws().windows).every((w) => w.minimized)).toBe(true);
    expect(ws().focusedId).toBeNull();
  });

  it('cycles focus through windows and closes all windows of an app', () => {
    const a = ws().open('x');
    const b = ws().open('y');
    const c = ws().open('x');
    expect(ws().focusedId).toBe(c);
    ws().cycle(1);
    expect(ws().focusedId).toBe(a);
    ws().cycle(1);
    expect(ws().focusedId).toBe(b);
    ws().closeApp('x');
    expect(Object.keys(ws().windows)).toEqual([b]);
  });
});
