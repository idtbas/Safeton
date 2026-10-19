/*
 * Virtual clock injected into every frame before any page script runs. Timers, requestAnimationFrame,
 * performance.now, Date and all CSS/Web animations advance only when the renderer calls
 * __vt.advance(ms), so every video frame is rendered deterministically regardless of capture speed.
 */
(() => {
  if (window.__vt) return;
  const RealDate = Date;
  const nativeTimeout = window.setTimeout.bind(window);
  const EPOCH = RealDate.UTC(2026, 9, 19, 7, 41, 0); // 09:41 in Berlin
  let now = 0;
  let seq = 1;
  const timers = new Map();
  const rafs = new Map();
  const tracked = new WeakSet();

  window.setTimeout = (fn, ms, ...args) => {
    const id = seq++;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args, every: 0, id });
    return id;
  };
  window.setInterval = (fn, ms, ...args) => {
    const id = seq++;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + every, fn, args, every, id });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => void timers.delete(id);
  window.requestAnimationFrame = (fn) => {
    const id = seq++;
    rafs.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => void rafs.delete(id);
  performance.now = () => now;
  class VDate extends RealDate {
    constructor(...a) {
      if (a.length === 0) super(EPOCH + now);
      else super(...a);
    }
    static now() {
      return EPOCH + now;
    }
  }
  window.Date = VDate;

  const call = (fn, args) => {
    try {
      typeof fn === 'function' ? fn(...args) : (0, eval)(String(fn));
    } catch (e) {
      console.error(e);
    }
  };

  function syncAnimations(dt) {
    for (const a of document.getAnimations()) {
      if (!tracked.has(a)) {
        tracked.add(a);
        if (a.playState === 'running') {
          a.pause();
          a.currentTime = 0;
        }
        continue;
      }
      if (a.playState !== 'paused') continue;
      const ct = (a.currentTime ?? 0) + dt * (a.playbackRate || 1);
      const end = a.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end) && ct >= end) a.finish();
      else a.currentTime = ct;
    }
  }

  window.__vt = {
    /** Real (wall-clock) yield, so the renderer can let pending tasks settle. */
    tick: () => new Promise((r) => nativeTimeout(r, 0)),
    get now() {
      return now;
    },
    advance(dt) {
      const target = now + dt;
      for (let guard = 0; guard < 20000; guard++) {
        let next = null;
        for (const t of timers.values()) if (t.at <= target && (!next || t.at < next.at)) next = t;
        if (!next) break;
        now = Math.max(now, next.at);
        if (next.every) next.at += next.every;
        else timers.delete(next.id);
        call(next.fn, next.args);
      }
      now = target;
      syncAnimations(dt);
      const cbs = [...rafs.values()];
      rafs.clear();
      for (const cb of cbs) call(cb, [now]);
    },
  };

  // The installed-application display mode cannot be emulated through DevTools: report it here,
  // except for the frame that shows the installation screen.
  if (!location.search.includes('gate') && !location.pathname.startsWith('/__promo')) {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (q) =>
      q.includes('display-mode: standalone')
        ? {
            matches: true,
            media: q,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => false,
          }
        : original(q);
  }
})();
