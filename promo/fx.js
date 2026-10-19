/*
 * Visual effects layer of the film. Every effect is a pure function of the film time `t` and the
 * parameters it was registered with (window.addFx), so frames render deterministically.
 *
 * Back canvas (behind the screens): bokeh, light rays, orbit (rear half), hologram.
 * Front canvas (over the screens):  particles, flares, speed lines, rings, HUD brackets, links,
 *                                   orbit (front half), counters, glitch slices, flashes.
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    out: (p) => 1 - Math.pow(1 - p, 3),
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    in: (p) => p * p * p,
  };
  const prog = (t, t0, d, f = E.out) => f(clamp((t - t0) / d));
  const bell = (t, t0, t1, a = 0.25, r = 0.35) => prog(t, t0, a) * (1 - prog(t, t1 - r, r, E.in));
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }
  const hash = (i) => {
    let x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  const back = $('#fxBack').getContext('2d');
  const front = $('#fxFront').getContext('2d');
  const fx = [];
  window.addFx = (o) => fx.push(o);

  // ---- Particle system for the brand mark --------------------------------------------------------
  const CUBE = [
    [
      [8, 11.5],
      [16, 7],
      [24, 11.5],
      [24, 20.5],
      [16, 25],
      [8, 20.5],
      [8, 11.5],
    ],
    [
      [8, 11.5],
      [16, 16],
      [24, 11.5],
    ],
    [
      [16, 16],
      [16, 25],
    ],
  ];
  function cubePoints(n) {
    const segs = [];
    for (const path of CUBE)
      for (let i = 0; i < path.length - 1; i++) {
        const [a, b] = [path[i], path[i + 1]];
        segs.push([a, b, Math.hypot(b[0] - a[0], b[1] - a[1])]);
      }
    const total = segs.reduce((s, x) => s + x[2], 0);
    const out = [];
    for (let k = 0; k < n; k++) {
      let d = (k / n) * total;
      for (const [a, b, l] of segs) {
        if (d <= l) {
          const p = d / l;
          out.push([lerp(a[0], b[0], p), lerp(a[1], b[1], p)]);
          break;
        }
        d -= l;
      }
    }
    return out;
  }
  const R = rng(42);
  const PARTS = cubePoints(1600).map(([tx, ty]) => {
    const ang = R() * Math.PI * 2;
    const rad = 500 + R() * 900;
    return {
      tx,
      ty,
      sx: Math.cos(ang) * rad * 1.5,
      sy: Math.sin(ang) * rad * 0.8,
      d: R(),
      a: R() * Math.PI * 2,
      sp: 0.35 + R() * 0.65,
      sz: 1 + R() * 1.6,
      jx: R() * 2 - 1,
      jy: R() * 2 - 1,
    };
  });

  /** Particles converge into the mark (cx, cy, scale = px per viewBox unit). */
  function particlesForm(c, f, t) {
    const lt = t - f.t0;
    const fadeOut = 1 - prog(lt, f.hold, 0.9);
    if (fadeOut <= 0) return;
    c.globalCompositeOperation = 'lighter';
    for (const p of PARTS) {
      const k = E.inOut(clamp((lt - p.d * 0.7) / f.dur));
      const swirl = (1 - k) * 2.4;
      const cs = Math.cos(swirl);
      const sn = Math.sin(swirl);
      const sx = p.sx * cs - p.sy * sn;
      const sy = p.sx * sn + p.sy * cs;
      const tx = (p.tx - 16) * f.scale;
      const ty = (p.ty - 16) * f.scale;
      const jit = (1 - k) * 0 + k * Math.sin(t * 3 + p.a) * 1.2;
      const x = f.cx + lerp(sx, tx, k) + p.jx * jit;
      const y = f.cy + lerp(sy, ty, k) + p.jy * jit;
      const a = clamp(lt / 0.5) * fadeOut * (0.35 + 0.65 * k);
      c.fillStyle = `rgba(127,224,245,${a * 0.9})`;
      c.fillRect(x, y, p.sz, p.sz);
      c.fillStyle = `rgba(63,193,224,${a * 0.12})`;
      c.fillRect(x - p.sz * 2, y - p.sz * 2, p.sz * 5, p.sz * 5);
    }
    c.globalCompositeOperation = 'source-over';
  }

  /** Particles burst out of a point as light streaks. */
  function particlesBurst(c, f, t) {
    const lt = t - f.t0;
    if (lt < 0 || lt > f.dur) return;
    const p = lt / f.dur;
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (let i = 0; i < PARTS.length; i += 2) {
      const q = PARTS[i];
      const r = q.sp * f.radius * E.outExpo(p) + 20;
      const dx = Math.cos(q.a);
      const dy = Math.sin(q.a) * 0.62;
      const x = f.cx + dx * r;
      const y = f.cy + dy * r;
      const len = 60 * (1 - p) * q.sp;
      const a = Math.pow(1 - p, 1.6) * (0.4 + 0.6 * q.d);
      c.strokeStyle = `rgba(160,235,250,${a})`;
      c.lineWidth = q.sz * 0.9;
      c.beginPath();
      c.moveTo(x - dx * len, y - dy * len);
      c.lineTo(x, y);
      c.stroke();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ---- Lens flare ------------------------------------------------------------------------------------
  function flare(c, f, t) {
    const lt = t - f.t0;
    const I = prog(lt, 0, 0.12) * (1 - prog(lt, 0.12, f.dur, (p) => Math.sqrt(p))) * (f.gain ?? 1);
    if (I <= 0.001) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    // Anamorphic streak
    c.translate(f.x, f.y);
    c.scale(1, 0.018);
    let g = c.createRadialGradient(0, 0, 0, 0, 0, 1100);
    g.addColorStop(0, `rgba(200,245,255,${0.85 * I})`);
    g.addColorStop(0.25, `rgba(63,193,224,${0.35 * I})`);
    g.addColorStop(1, 'rgba(63,193,224,0)');
    c.fillStyle = g;
    c.fillRect(-1100, -1100, 2200, 2200);
    c.restore();
    c.save();
    c.globalCompositeOperation = 'lighter';
    g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, 260);
    g.addColorStop(0, `rgba(255,255,255,${0.55 * I})`);
    g.addColorStop(0.2, `rgba(127,224,245,${0.22 * I})`);
    g.addColorStop(1, 'rgba(63,193,224,0)');
    c.fillStyle = g;
    c.fillRect(f.x - 260, f.y - 260, 520, 520);
    // Ghosts along the axis through the frame centre
    const ghosts = [
      [-0.35, 40, '127,224,245'],
      [0.45, 22, '150,130,255'],
      [0.8, 70, '63,193,224'],
      [1.3, 34, '150,130,255'],
    ];
    for (const [k, r, col] of ghosts) {
      const gx = lerp(f.x, 960, k * 2);
      const gy = lerp(f.y, 540, k * 2);
      const gg = c.createRadialGradient(gx, gy, 0, gx, gy, r);
      gg.addColorStop(0, `rgba(${col},${0.0})`);
      gg.addColorStop(0.7, `rgba(${col},${0.07 * I})`);
      gg.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = gg;
      c.fillRect(gx - r, gy - r, r * 2, r * 2);
    }
    c.restore();
  }

  // ---- Light rays -------------------------------------------------------------------------------------
  function rays(c, f, t) {
    const I = bell(t, f.t0, f.t1, 0.8, 0.8) * (f.gain ?? 1);
    if (I <= 0) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.translate(f.x, f.y);
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 0.06 + Math.sin(i * 7.1) * 0.08;
      const w = 0.02 + hash(i) * 0.04;
      const len = 700 + hash(i + 9) * 500;
      const g = c.createRadialGradient(0, 0, 40, 0, 0, len);
      const al = I * (0.035 + 0.05 * hash(i + 3)) * (0.6 + 0.4 * Math.sin(t * 0.9 + i));
      g.addColorStop(0, `rgba(127,224,245,${al})`);
      g.addColorStop(1, 'rgba(127,224,245,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, len, a - w, a + w);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  // ---- Bokeh dust ----------------------------------------------------------------------------------------
  const BOKEH = Array.from({ length: 64 }, (_, i) => ({
    x: hash(i) * 2200 - 140,
    y: hash(i + 100) * 1200 - 60,
    z: hash(i + 200),
    ph: hash(i + 300) * 6.28,
    hue: hash(i + 400) > 0.7 ? '150,130,255' : '127,224,245',
  }));
  function bokeh(c, f, t) {
    const I = bell(t, f.t0, f.t1, 1.2, 1.2) * (f.gain ?? 1);
    if (I <= 0) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const b of BOKEH) {
      const r = 3 + b.z * b.z * 34;
      const x = ((b.x + t * (6 + b.z * 22)) % 2200) - 140;
      const y = ((b.y - t * (4 + b.z * 14) + 1200 * 4) % 1200) - 60 + Math.sin(t * 0.5 + b.ph) * 14;
      const a = I * (0.05 + 0.13 * (1 - b.z)) * (0.6 + 0.4 * Math.sin(t * 0.8 + b.ph));
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${b.hue},${a})`);
      g.addColorStop(0.65, `rgba(${b.hue},${a * 0.7})`);
      g.addColorStop(1, `rgba(${b.hue},0)`);
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.restore();
  }

  // ---- Speed lines (whip transitions) ------------------------------------------------------------------
  const SPEED = Array.from({ length: 140 }, (_, i) => ({
    a: hash(i + 1) * Math.PI * 2,
    r: 220 + hash(i + 2) * 500,
    l: 160 + hash(i + 3) * 520,
    v: 0.6 + hash(i + 4) * 1.2,
    w: 0.6 + hash(i + 5) * 1.8,
  }));
  function speed(c, f, t) {
    const I = Math.sin(Math.PI * clamp((t - f.t0) / (f.t1 - f.t0))) ** 1.5 * (f.gain ?? 1);
    if (I <= 0.01) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.translate(f.x ?? 960, f.y ?? 540);
    for (const s of SPEED) {
      const off = ((t - f.t0) * 1400 * s.v) % 900;
      const r0 = s.r + off;
      const len = s.l * I;
      const dx = Math.cos(s.a);
      const dy = Math.sin(s.a);
      const g = c.createLinearGradient(dx * r0, dy * r0, dx * (r0 + len), dy * (r0 + len));
      g.addColorStop(0, 'rgba(180,240,255,0)');
      g.addColorStop(1, `rgba(180,240,255,${0.32 * I})`);
      c.strokeStyle = g;
      c.lineWidth = s.w;
      c.beginPath();
      c.moveTo(dx * r0, dy * r0);
      c.lineTo(dx * (r0 + len), dy * (r0 + len));
      c.stroke();
    }
    c.restore();
  }

  // ---- Rings / flashes ------------------------------------------------------------------------------------
  function ring(c, f, t, s) {
    const lt = t - f.t0;
    if (lt < 0 || lt > f.dur + 0.3) return;
    const pt = f.stage ? mapA(s, f.x, f.y) : { x: f.x, y: f.y };
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < (f.count ?? 2); k++) {
      const p = clamp((lt - k * 0.14) / f.dur);
      if (p <= 0 || p >= 1) continue;
      const r = E.outExpo(p) * f.r;
      c.strokeStyle = `rgba(${f.color},${(1 - p) ** 1.4 * (k ? 0.45 : 0.9)})`;
      c.lineWidth = 2 + (1 - p) * (k ? 6 : 14);
      c.beginPath();
      c.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      c.stroke();
    }
    const p0 = clamp(lt / f.dur);
    const g = c.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, f.r * 0.5);
    g.addColorStop(0, `rgba(${f.color},${0.35 * (1 - p0) ** 2})`);
    g.addColorStop(1, `rgba(${f.color},0)`);
    c.fillStyle = g;
    c.fillRect(pt.x - f.r, pt.y - f.r, f.r * 2, f.r * 2);
    c.restore();
  }
  function flash(c, f, t) {
    const I = bell(t, f.t0, f.t0 + f.dur, f.dur * 0.25, f.dur * 0.75) * (f.gain ?? 1);
    if (I <= 0) return;
    c.save();
    if (f.vignette) {
      const g = c.createRadialGradient(960, 540, 420, 960, 540, 1200);
      g.addColorStop(0, `rgba(${f.color},0)`);
      g.addColorStop(1, `rgba(${f.color},${0.42 * I})`);
      c.fillStyle = g;
    } else {
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = `rgba(${f.color},${0.35 * I})`;
    }
    c.fillRect(0, 0, 1920, 1080);
    c.restore();
  }
  function edge(c, f, t, s) {
    const I = bell(t, f.t0, f.t0 + 0.9, 0.12, 0.7);
    if (I <= 0) return;
    const top = mapA(s, 0, 0);
    const bot = mapA(s, 0, 864);
    const x = mapA(s, f.side === 'left' ? 0 : 1536, 0).x;
    const w = 220;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(x, 0, f.side === 'left' ? x + w : x - w, 0);
    g.addColorStop(0, `rgba(127,224,245,${0.45 * I})`);
    g.addColorStop(1, 'rgba(127,224,245,0)');
    c.fillStyle = g;
    c.fillRect(Math.min(x, x + (f.side === 'left' ? w : -w)), top.y, w, bot.y - top.y);
    c.fillStyle = `rgba(200,245,255,${0.9 * I})`;
    c.fillRect(x - (f.side === 'left' ? 0 : 3), top.y, 3, bot.y - top.y);
    c.restore();
  }

  // ---- HUD brackets around a stage rectangle ------------------------------------------------------------
  function brackets(c, f, t, s) {
    const lt = t - f.t0;
    const p = prog(lt, 0, 0.8, E.outExpo);
    const out = prog(t, f.t1 - 0.4, 0.4, E.in);
    const A = p * (1 - out);
    if (A <= 0) return;
    const a = mapA(s, f.x, f.y);
    const b = mapA(s, f.x + f.w, f.y + f.h);
    const pad = (1 - p) * 60 + 10;
    const x0 = a.x - pad;
    const y0 = a.y - pad;
    const x1 = b.x + pad;
    const y1 = b.y + pad;
    const L = 42;
    c.save();
    c.strokeStyle = `rgba(127,224,245,${0.95 * A})`;
    c.lineWidth = 2.5;
    c.shadowColor = 'rgba(63,193,224,0.8)';
    c.shadowBlur = 0;
    const corner = (x, y, sx, sy) => {
      c.beginPath();
      c.moveTo(x + sx * L, y);
      c.lineTo(x, y);
      c.lineTo(x, y + sy * L);
      c.stroke();
    };
    corner(x0, y0, 1, 1);
    corner(x1, y0, -1, 1);
    corner(x0, y1, 1, -1);
    corner(x1, y1, -1, -1);
    // Tick marks along the top edge
    c.strokeStyle = `rgba(127,224,245,${0.35 * A})`;
    c.lineWidth = 1;
    for (let i = 1; i < 24; i++) {
      const x = lerp(x0 + L + 8, x1 - L - 8, i / 24);
      c.beginPath();
      c.moveTo(x, y0);
      c.lineTo(x, y0 + (i % 4 === 0 ? 8 : 4));
      c.stroke();
    }
    // Label (typed)
    const txt = f.label ?? '';
    const n = Math.floor(clamp((lt - 0.2) / 0.7) * txt.length);
    c.font = '600 17px "JetBrains Mono", monospace';
    c.fillStyle = `rgba(4,20,26,${0.92 * A})`;
    const tw = c.measureText(txt).width;
    c.fillStyle = `rgba(127,224,245,${0.95 * A})`;
    c.fillRect(x0, y0 - 34, Math.max(0, tw * (n / Math.max(1, txt.length))) + 20, 26);
    c.fillStyle = `rgba(4,20,26,${A})`;
    c.fillText(txt.slice(0, n), x0 + 10, y0 - 15);
    // Scan beam
    c.save();
    c.beginPath();
    c.rect(a.x, a.y, b.x - a.x, b.y - a.y);
    c.clip();
    const sy = a.y + ((lt * 0.55) % 1) * (b.y - a.y);
    const g = c.createLinearGradient(0, sy - 80, 0, sy);
    g.addColorStop(0, 'rgba(127,224,245,0)');
    g.addColorStop(1, `rgba(127,224,245,${0.22 * A})`);
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = g;
    c.fillRect(a.x, sy - 80, b.x - a.x, 80);
    c.fillStyle = `rgba(200,245,255,${0.7 * A})`;
    c.fillRect(a.x, sy, b.x - a.x, 1.5);
    // Pings
    for (let k = 0; k < 6; k++) {
      const cyc = (lt + k * 0.37) % 1.6;
      const px = lerp(a.x, b.x, 0.1 + 0.8 * hash(k * 13 + Math.floor((lt + k * 0.37) / 1.6)));
      const py = lerp(a.y, b.y, 0.1 + 0.8 * hash(k * 29 + 7 + Math.floor((lt + k * 0.37) / 1.6)));
      const pr = clamp(cyc / 0.9);
      c.strokeStyle = `rgba(127,224,245,${(1 - pr) * 0.8 * A})`;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(px, py, 4 + pr * 26, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
    c.restore();
  }

  // ---- Hologram data centre (64 × 64 = 4 096 nodes) -------------------------------------------------------
  const N = 64;
  const HEIGHT = new Float32Array(N * N);
  const FAILED = new Uint8Array(N * N);
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const v =
        0.55 +
        0.25 * Math.sin(i * 0.21 + j * 0.13) * Math.cos(j * 0.17 - i * 0.05) +
        0.2 * hash(i * N + j) +
        (Math.floor(i / 8) % 2 === Math.floor(j / 16) % 2 ? 0.1 : -0.1);
      HEIGHT[i * N + j] = clamp(v, 0.08, 1);
      FAILED[i * N + j] = hash(i * N + j + 9999) < 0.004 ? 1 : 0;
    }
  function hologram(c, f, t) {
    const A = bell(t, f.t0, f.t1, 0.5, 0.6);
    if (A <= 0) return;
    const lt = t - f.t0;
    const s = f.size;
    const hmax = f.hmax;
    c.save();
    // Base plate glow
    const g = c.createRadialGradient(f.x, f.y + N * s * 0.5, 0, f.x, f.y + N * s * 0.5, N * s * 1.1);
    g.addColorStop(0, `rgba(63,193,224,${0.22 * A})`);
    g.addColorStop(1, 'rgba(63,193,224,0)');
    c.fillStyle = g;
    c.fillRect(f.x - N * s * 1.2, f.y - 100, N * s * 2.4, N * s * 1.4);
    c.strokeStyle = `rgba(127,224,245,${0.4 * A})`;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(f.x, f.y - s * 0.5);
    c.lineTo(f.x + N * s, f.y + N * s * 0.5 - s * 0.5);
    c.lineTo(f.x, f.y + N * s - s * 0.5);
    c.lineTo(f.x - N * s, f.y + N * s * 0.5 - s * 0.5);
    c.closePath();
    c.stroke();
    const scan = ((lt * 0.45) % 1.4) * N;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const k = i * N + j;
        const dist = Math.hypot(i - 31.5, j - 31.5) / 45;
        const p = E.outExpo(clamp((lt - 0.15 - dist * 1.1) / 0.7));
        if (p <= 0) continue;
        const hv = HEIGHT[k] * (0.92 + 0.08 * Math.sin(t * 2 + i * 0.3 + j * 0.2));
        const h = hv * hmax * p + 1;
        const x = f.x + (i - j) * s;
        const y = f.y + (i + j) * s * 0.5;
        const near = Math.max(0, 1 - Math.abs(i + j * 0.0 - scan) / 2.2);
        const failed = FAILED[k] && lt > 1.6 && Math.floor(t * 3) % 2 === 0;
        const hue = failed ? 355 : 182 + hv * 42;
        const light = 40 + hv * 24 + near * 28;
        c.fillStyle = `hsla(${hue},85%,${light * 0.45}%,${A * 0.9})`;
        c.beginPath();
        c.moveTo(x - s, y - h);
        c.lineTo(x, y - h + s * 0.5);
        c.lineTo(x + s, y - h);
        c.lineTo(x + s, y);
        c.lineTo(x, y + s * 0.5);
        c.lineTo(x - s, y);
        c.closePath();
        c.fill();
        c.fillStyle = `hsla(${hue},95%,${light}%,${A})`;
        c.beginPath();
        c.moveTo(x, y - h - s * 0.5);
        c.lineTo(x + s, y - h);
        c.lineTo(x, y - h + s * 0.5);
        c.lineTo(x - s, y - h);
        c.closePath();
        c.fill();
      }
    }
    c.restore();
  }

  /** Large rolling number with a label. */
  function counter(c, f, t) {
    const A = bell(t, f.t0, f.t1, 0.4, 0.5);
    if (A <= 0) return;
    const p = prog(t, f.t0 + 0.2, f.dur, E.inOut);
    const v = Math.round(f.value * p);
    const txt = v.toLocaleString('de-DE').replace(/\./g, ' ');
    c.save();
    c.globalAlpha = A;
    c.font = '500 17px "JetBrains Mono", monospace';
    c.fillStyle = '#7fe0f5';
    c.letterSpacing = '4px';
    c.fillText(f.label, f.x, f.y - 120);
    c.letterSpacing = '0px';
    c.font = '650 136px Inter, sans-serif';
    c.fillStyle = '#f3f6fa';
    c.fillText(txt, f.x - 6, f.y);
    if (f.sub) {
      c.font = '450 26px Inter, sans-serif';
      c.fillStyle = 'rgba(226,234,243,0.72)';
      c.fillText(f.sub, f.x, f.y + 56);
    }
    c.restore();
  }

  // ---- Orbit + links around the screen (hero) ------------------------------------------------------------
  function orbit(cb, cf, f, t) {
    const A = bell(t, f.t0, f.t1, 1.2, 0.8);
    if (A <= 0) return;
    const r = $('#screen-a').getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rings = [
      { rx: r.width * 0.66, ry: r.height * 0.2, tilt: -0.12, v: 0.22, n: 150, col: '127,224,245' },
      { rx: r.width * 0.58, ry: r.height * 0.32, tilt: 0.18, v: -0.15, n: 110, col: '150,130,255' },
    ];
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const ang = (i / ring.n) * Math.PI * 2 + t * ring.v;
        const ex = Math.cos(ang) * ring.rx;
        const ey = Math.sin(ang) * ring.ry;
        const x = cx + ex * Math.cos(ring.tilt) - ey * Math.sin(ring.tilt);
        const y = cy + ex * Math.sin(ring.tilt) + ey * Math.cos(ring.tilt);
        const front = Math.sin(ang) > 0;
        const c = front ? cf : cb;
        const depth = (Math.sin(ang) + 1) / 2;
        const a = A * (0.25 + 0.6 * depth) * (0.5 + 0.5 * Math.sin(i * 1.7 + t * 2));
        const sz = 1.2 + depth * 2.2;
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = `rgba(${ring.col},${a})`;
        c.fillRect(x - sz / 2, y - sz / 2, sz, sz);
        c.globalCompositeOperation = 'source-over';
      }
    }
  }
  function links(c, f, t) {
    const A = bell(t, f.t0, f.t1, 1.0, 0.6);
    if (A <= 0) return;
    const r = $('#screen-a').getBoundingClientRect();
    const chips = [...document.querySelectorAll('.chip')];
    c.save();
    c.globalCompositeOperation = 'lighter';
    chips.forEach((el, i) => {
      const op = Number(el.style.opacity || 0);
      if (op <= 0.02) return;
      const cr = el.getBoundingClientRect();
      const sx = cr.left + cr.width / 2 < r.left + r.width / 2 ? cr.right + 6 : cr.left - 6;
      const sy = cr.top + cr.height / 2;
      const tx = clamp(sx, r.left + r.width * 0.12, r.right - r.width * 0.12);
      const ty = clamp(sy, r.top + r.height * 0.15, r.bottom - r.height * 0.15);
      const mx = (sx + tx) / 2;
      const g = c.createLinearGradient(sx, sy, tx, ty);
      g.addColorStop(0, `rgba(127,224,245,${0.55 * op * A})`);
      g.addColorStop(1, 'rgba(127,224,245,0)');
      c.strokeStyle = g;
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(sx, sy);
      c.bezierCurveTo(mx, sy, mx, ty, tx, ty);
      c.stroke();
      const q = (t * 0.6 + i * 0.23) % 1;
      const bx = (1 - q) ** 3 * sx + 3 * (1 - q) ** 2 * q * mx + 3 * (1 - q) * q * q * mx + q ** 3 * tx;
      const by = (1 - q) ** 3 * sy + 3 * (1 - q) ** 2 * q * sy + 3 * (1 - q) * q * q * ty + q ** 3 * ty;
      const gg = c.createRadialGradient(bx, by, 0, bx, by, 10);
      gg.addColorStop(0, `rgba(200,245,255,${0.9 * op * A})`);
      gg.addColorStop(1, 'rgba(127,224,245,0)');
      c.fillStyle = gg;
      c.fillRect(bx - 10, by - 10, 20, 20);
    });
    c.restore();
  }

  // ---- Glitch ---------------------------------------------------------------------------------------------
  function glitchAmount(t) {
    let I = 0;
    for (const f of fx)
      if (f.type === 'glitch') I = Math.max(I, Math.sin(Math.PI * clamp((t - f.t0) / f.dur)) * (f.gain ?? 1));
    return I;
  }
  function glitchSlices(c, I, t) {
    if (I <= 0.02) return;
    const fr = Math.floor(t * 60);
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 9; k++) {
      if (hash(fr * 17 + k) > I) continue;
      const y = hash(fr * 31 + k) * 1080;
      const h = 2 + hash(fr * 7 + k) * 26;
      const x = (hash(fr * 13 + k) - 0.5) * 300;
      c.fillStyle = k % 2 ? `rgba(255,60,120,${0.16 * I})` : `rgba(60,220,255,${0.18 * I})`;
      c.fillRect(x, y, 1920, h);
    }
    c.restore();
  }

  // ---- Mapping ----------------------------------------------------------------------------------------------
  function mapA(s, x, y) {
    const a = s.a;
    return { x: 960 + (a.ox ?? 0) + (x - a.cx) * a.z, y: 540 + (a.oy ?? 0) + (y - a.cy) * a.z };
  }

  // ---- Frame ------------------------------------------------------------------------------------------------
  window.renderFx = (s) => {
    const t = s.t;
    back.clearRect(0, 0, 1920, 1080);
    front.clearRect(0, 0, 1920, 1080);

    // Camera shake on the world, effects and cursor
    let shx = 0;
    let shy = 0;
    for (const f of fx)
      if (f.type === 'shake') {
        const p = clamp((t - f.t0) / f.dur);
        if (p > 0 && p < 1) {
          const amp = f.amp * (1 - p) ** 2;
          shx += Math.sin(t * 91) * amp + Math.sin(t * 53) * amp * 0.5;
          shy += Math.cos(t * 77) * amp * 0.7;
        }
      }
    const gI = glitchAmount(t);
    const fr = Math.floor(t * 60);
    const gx = gI > 0.02 ? (hash(fr) - 0.5) * 30 * gI : 0;
    const tf = `translate(${shx + gx}px, ${shy}px)`;
    $('#world').style.transform = tf;
    $('#fxFront').style.transform = tf;
    $('#ui').style.transform = tf;
    if (gI > 0.02) {
      const d = (6 + 10 * hash(fr + 5)) * gI;
      $('#rgb-r').setAttribute('dx', d);
      $('#rgb-b').setAttribute('dx', -d);
      $('#world').style.filter = 'url(#rgb)';
    } else $('#world').style.filter = 'none';

    // Glare sweep across the main screen
    const glare = $('#screen-a .glare');
    for (const f of fx)
      if (f.type === 'sweep') {
        const p = clamp((t - f.t0) / f.dur);
        if (p > 0 && p < 1) {
          glare.style.opacity = Math.sin(Math.PI * p) * (f.gain ?? 0.9);
          glare.style.backgroundSize = '300% 100%';
          glare.style.backgroundPosition = `${lerp(110, -10, E.inOut(p))}% 0`;
        }
      }

    for (const f of fx) {
      switch (f.type) {
        case 'bokeh':
          bokeh(back, f, t);
          break;
        case 'rays':
          rays(back, f, t);
          break;
        case 'hologram':
          hologram(back, f, t);
          break;
        case 'orbit':
          orbit(back, front, f, t);
          break;
      }
    }
    for (const f of fx) {
      switch (f.type) {
        case 'form':
          particlesForm(front, f, t);
          break;
        case 'burst':
          particlesBurst(front, f, t);
          break;
        case 'flare':
          flare(front, f, t);
          break;
        case 'speed':
          speed(front, f, t);
          break;
        case 'ring':
          ring(front, f, t, s);
          break;
        case 'flash':
          flash(front, f, t);
          break;
        case 'edge':
          edge(front, f, t, s);
          break;
        case 'brackets':
          brackets(front, f, t, s);
          break;
        case 'counter':
          counter(front, f, t);
          break;
        case 'links':
          links(front, f, t);
          break;
      }
    }
    glitchSlices(front, gI, t);
  };
})();
