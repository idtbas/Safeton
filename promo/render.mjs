/**
 * Renders the Safeton film: the real production build is operated by a script inside a "director"
 * page that adds camera moves, cursor, typography and transitions. Every frame is rendered on a
 * virtual clock (see vt.js) and piped into ffmpeg, so the result is smooth regardless of speed.
 *
 *   npm run build && node promo/render.mjs            → promo/out/safeton-film.mp4 (60 fps)
 *   FPS=24 STILLS=1 node promo/render.mjs             → quick draft + review stills
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from './server.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const FPS = Number(process.env.FPS ?? 60);
const OUT_DIR = `${here}out`;
const OUT = process.env.OUT ?? `${OUT_DIR}/safeton-film-silent.mp4`;
const STILLS = process.env.STILLS ? `${OUT_DIR}/stills` : null;
const PORT = 4319;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'Correct-Horse-42!';
mkdirSync(OUT_DIR, { recursive: true });
if (STILLS) mkdirSync(STILLS, { recursive: true });

// ---- Easing / tweens --------------------------------------------------------------------------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;
const EASE = {
  linear: (p) => p,
  out: (p) => 1 - Math.pow(1 - p, 3),
  in: (p) => p * p * p,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  // Cinematic: slow start, long settle.
  cine: (p) => (p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2),
  outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  sine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
};

const W = 1536;
const H = 864;
const FULL = { cx: W / 2, cy: H / 2, z: 1.25, rx: 0, ry: 0, rz: 0, ox: 0, oy: 0, oz: 0, blur: 0, dim: 0 };

const S = {
  t: 0,
  a: { ...FULL, opacity: 0 },
  b: { ...FULL, z: 0.6, ox: 1400, ry: -24, opacity: 0 },
  cursor: { sx: 1000, sy: 640, vis: 0, press: false, scale: 1, x: 0, y: 0 },
  ripples: [],
  keys: null,
  intro: null,
  end: null,
  fade: 0,
  bg: 1,
  floor: 0,
};
const events = [];
const sound = (kind, extra = {}) => events.push({ t: S.t, kind, ...extra });

let tweens = [];
function anim(obj, props, dur, ease = 'inOut', delay = 0) {
  tweens.push({
    obj,
    props,
    dur: Math.max(dur, 1e-6),
    ease: EASE[ease] ?? ease,
    start: S.t + delay,
    from: null,
  });
}
function applyTweens() {
  for (const tw of tweens) {
    if (S.t < tw.start) continue;
    if (!tw.from) {
      // A newer tween takes over the properties it animates.
      for (const other of tweens)
        if (other !== tw && other.obj === tw.obj && other.from)
          for (const k of Object.keys(tw.props)) delete other.props[k];
      tw.from = Object.fromEntries(Object.keys(tw.props).map((k) => [k, tw.obj[k] ?? 0]));
    }
    const p = clamp((S.t - tw.start) / tw.dur);
    for (const [k, v] of Object.entries(tw.props)) tw.obj[k] = lerp(tw.from[k], v, tw.ease(p));
    if (p >= 1) tw.done = true;
  }
  tweens = tweens.filter((tw) => !tw.done);
}

// ---- Browser ------------------------------------------------------------------------------------
const server = await serve(PORT);
const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  screen: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  locale: 'de-DE',
  timezoneId: 'Europe/Berlin',
  serviceWorkers: 'block',
  colorScheme: 'dark',
});
await ctx.addInitScript({ content: readFileSync(`${here}vt.js`, 'utf8') });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text().slice(0, 200)));
await page.goto(`${ORIGIN}/__promo/director.html`);
const fonts = readdirSync(`${here}../dist/assets`);
const font = (prefix) => fonts.find((f) => f.startsWith(prefix) && f.endsWith('.woff2'));
await page.addStyleTag({
  content: `
@font-face{font-family:'Inter';font-weight:100 900;src:url(/assets/${font('inter-latin-wght-normal')}) format('woff2')}
@font-face{font-family:'Inter';font-weight:100 900;src:url(/assets/${font('inter-latin-ext-wght-normal')}) format('woff2');unicode-range:U+0100-02AF,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'JetBrains Mono';font-weight:100 900;src:url(/assets/${font('jetbrains-mono-latin-wght-normal')}) format('woff2')}`,
});
await page.evaluate(() =>
  document.fonts.load('600 40px Inter').then(() => document.fonts.load('500 16px "JetBrains Mono"')),
);
const cdp = await ctx.newCDPSession(page);

// ---- Encoder ------------------------------------------------------------------------------------
const ffmpeg = spawn(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    String(FPS),
    '-c:v',
    'mjpeg',
    '-i',
    '-',
    '-c:v',
    'libx264',
    '-preset',
    process.env.PRESET ?? 'slow',
    '-crf',
    process.env.CRF ?? '16',
    '-pix_fmt',
    'yuv420p',
    '-tune',
    'film',
    '-movflags',
    '+faststart',
    OUT,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const ffDone = new Promise((r) => ffmpeg.on('close', r));
const write = (buf) => (ffmpeg.stdin.write(buf) ? null : new Promise((r) => ffmpeg.stdin.once('drain', r)));

// ---- Frame loop ---------------------------------------------------------------------------------
let frameNo = 0;
const perf = { ev: 0, shot: 0 };
let lastMouse = null;
let mouseLive = false;
let gateClock = false;
const toScreen = (x, y, cam = S.a) => ({
  x: 960 + cam.ox + (x - cam.cx) * cam.z,
  y: 540 + cam.oy + (y - cam.cy) * cam.z,
});

async function frame({ appSpeed = 1, capture = true } = {}) {
  applyTweens();
  const c = S.cursor;
  const p = toScreen(c.sx, c.sy);
  c.x = p.x;
  c.y = p.y;
  c.scale = S.a.z * 0.82;
  for (const r of S.ripples) {
    const rp = toScreen(r.sx, r.sy);
    r.x = rp.x;
    r.y = rp.y;
  }
  if (mouseLive) {
    const mx = Math.round(p.x * 4) / 4;
    const my = Math.round(p.y * 4) / 4;
    if (!lastMouse || lastMouse.x !== mx || lastMouse.y !== my) {
      await page.mouse.move(mx, my);
      lastMouse = { x: mx, y: my };
    }
  }
  const dt = (1000 / FPS) * appSpeed;
  const p0 = performance.now();
  await page.evaluate(
    async ([s, dt, dtGate]) => {
      const a = document.getElementById('app').contentWindow;
      const g = document.getElementById('gate').contentWindow;
      if (a?.__vt) a.__vt.advance(dt);
      if (dtGate && g?.__vt) g.__vt.advance(dtGate);
      await window.__vt.tick();
      if (a?.__vt) await a.__vt.tick();
      window.renderFrame(s);
    },
    [S, dt, gateClock ? dt : 0],
  );
  perf.ev += performance.now() - p0;
  if (!capture) return;
  const p1 = performance.now();
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 94,
    optimizeForSpeed: true,
  });
  const buf = Buffer.from(data, 'base64');
  perf.shot += performance.now() - p1;
  await write(buf);
  if (frameNo % 200 === 199) {
    console.log(
      `t=${S.t.toFixed(1)} eval ${(perf.ev / 200).toFixed(0)} ms, shot ${(perf.shot / 200).toFixed(0)} ms`,
    );
    perf.ev = perf.shot = 0;
  }
  if (STILLS && frameNo % Math.round(FPS / 2) === 0)
    writeFileSync(`${STILLS}/${String(frameNo).padStart(5, '0')}-${S.t.toFixed(1)}.jpg`, buf);
  frameNo++;
  S.t += 1 / FPS;
  S.ripples = S.ripples.filter((r) => (r.age += 1 / FPS) < 0.6);
}

async function hold(sec, opts = {}) {
  const n = Math.round(sec * FPS);
  for (let i = 0; i < n; i++) await frame(opts);
}

const find = (q, frameId = 'app') => page.evaluate(([f, q]) => window.find(f, q), [frameId, q]);

/** Records frames until the element exists (or skips app time without recording). */
async function waitFor(q, { max = 60, capture = true, appSpeed = 1 } = {}) {
  const limit = Math.round(max * FPS);
  for (let i = 0; i < limit; i++) {
    const r = await find(q);
    if (r) return r;
    await frame({ capture, appSpeed });
  }
  throw new Error(`waitFor timed out: ${JSON.stringify(q)}`);
}

async function moveTo(q, dur = 0.8, { dx = 0, dy = 0, arc = 0.12, ease = 'inOut' } = {}) {
  const r = typeof q === 'object' && 'x' in q && !('sel' in q) ? q : await waitFor(q, { max: 20 });
  const tx = (r.cx ?? r.x) + dx;
  const ty = (r.cy ?? r.y) + dy;
  const c = S.cursor;
  const fx = c.sx;
  const fy = c.sy;
  const n = Math.max(1, Math.round(dur * FPS));
  const dist = Math.hypot(tx - fx, ty - fy);
  // A slight curve, like a hand on a trackpad.
  const nx = -(ty - fy) / (dist || 1);
  const ny = (tx - fx) / (dist || 1);
  for (let i = 1; i <= n; i++) {
    const p = EASE[ease](i / n);
    const bend = Math.sin(Math.PI * p) * dist * arc;
    c.sx = lerp(fx, tx, p) + nx * bend;
    c.sy = lerp(fy, ty, p) + ny * bend;
    await frame();
  }
  return r;
}

async function click({ hold: h = 0.1 } = {}) {
  S.cursor.press = true;
  await page.mouse.down();
  sound('click');
  await hold(h);
  await page.mouse.up();
  S.cursor.press = false;
  S.ripples.push({ sx: S.cursor.sx, sy: S.cursor.sy, age: 0 });
  await frame();
}

async function clickOn(q, dur = 0.8, opts = {}) {
  const r = await moveTo(q, dur, opts);
  await hold(0.08);
  await click();
  return r;
}

async function type(text, cps = 15) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    sound('key');
    await hold(1 / cps + (Math.sin(S.t * 37) + 1) * 0.012);
  }
}

async function shortcut(combo, label, { x = 960, y = 880, show = 1.1 } = {}) {
  S.keys = { text: label, alpha: 0, x, y, press: false };
  anim(S.keys, { alpha: 1 }, 0.25, 'out');
  await hold(0.32);
  S.keys.press = true;
  sound('key', { strong: true });
  await page.keyboard.press(combo);
  await hold(0.12);
  S.keys.press = false;
  anim(S.keys, { alpha: 0 }, 0.35, 'in', show - 0.5);
}

const title = (o) => page.evaluate((o) => window.addTitle(o), o);
const chip = (o) => page.evaluate((o) => window.addChip(o), o);
const cam = (props, dur, ease = 'cine', delay = 0) => anim(S.a, props, dur, ease, delay);
const loadApp = (frameId, url) =>
  page.evaluate(([f, u]) => (document.getElementById(f).src = u), [frameId, url]);
const footerBtn = (label) => ({ sel: '.sh-setup__footer button', re: `^${label}` });
const heading = (text) => ({ sel: '.sh-setup__heading h1', text, exact: true });

// =================================================================================================
// FILM
// =================================================================================================
const T = {}; // scene markers (seconds) for the soundtrack
async function film() {
  // ---- 0 · Intro: beam, mark, name, claim → match cut into the boot screen ----------------------
  T.intro = S.t;
  S.intro = { t0: 0, cut: 5.0, cutScale: 0.536, cutY: 0 };
  sound('rise', { dur: 5.4 });
  await hold(3.5);
  await loadApp('app', `${ORIGIN}/`);
  await hold(1.0, { appSpeed: 0.6 });
  const mark = await waitFor({ sel: '.sh-boot .sh-brandmark' }, { max: 10 });
  const mp = toScreen(mark.cx, mark.cy);
  S.intro.cutY = mp.y - 540;
  S.intro.cutScale = (mark.w * S.a.z) / 168;
  await hold(Math.max(0, 5.0 - S.t), { appSpeed: 0.6 });
  sound('boom');
  anim(S.a, { opacity: 1 }, 0.7, 'inOut', 0.45);
  await hold(1.3, { appSpeed: 0.6 });
  S.intro = null;

  // ---- 1 · Boot in 3D ---------------------------------------------------------------------------
  T.boot = S.t;
  cam({ z: 0.74, rx: 7, ry: -17, ox: 330, oy: 10 }, 2.6);
  await title({
    t0: S.t + 0.9,
    t1: S.t + 5.6,
    kicker: 'Boot',
    lines: ['Startet wie ein', '*echtes System.*'],
    sub: 'Firmware, Kernel, Engine — jede Zeile beruht auf echten Daten des Hosts.',
    x: 140,
    y: 340,
  });
  sound('whoosh');
  await hold(2.0, { appSpeed: 0.6 });
  await page.keyboard.press('v');
  await hold(2.6, { appSpeed: 0.6 });
  await page.keyboard.press('v');
  await waitFor(heading('Willkommen'), { max: 15 });
  cam({ ...FULL }, 2.0);
  sound('whoosh');
  await hold(2.1);

  // ---- 2 · Setup ----------------------------------------------------------------------------------
  T.setup = S.t;
  mouseLive = true;
  anim(S.cursor, { vis: 1 }, 0.4, 'out');
  const capSetup = S.t;
  await title({
    kind: 'cap',
    t0: capSetup + 0.2,
    t1: capSetup + 6.6,
    kicker: '01',
    text: 'Ersteinrichtung <span>· 13 Schritte, jeder live validiert</span>',
  });
  await clickOn(footerBtn('Weiter'), 0.9);
  await waitFor(heading('Sprache & Region'));
  await hold(0.5);
  await clickOn(footerBtn('Weiter'), 0.35, { arc: 0 });
  await waitFor(heading('Administrator'));
  const nameField = await waitFor({ field: 'Vollständiger Name' });
  cam({ cx: nameField.x + 330, cy: nameField.cy + 110, z: 1.85 }, 1.3);
  await clickOn({ field: 'Vollständiger Name' }, 0.9);
  await type('Ada Lovelace', 13);
  await clickOn({ field: 'Passwort' }, 0.55);
  await type(PASSWORD, 20);
  await clickOn({ field: 'Passwort bestätigen' }, 0.45);
  await type(PASSWORD, 24);
  await hold(0.4);
  cam({ ...FULL }, 1.1);
  await clickOn(footerBtn('Weiter'), 0.8);
  await waitFor(heading('System & Standort'));
  await hold(0.35);
  await clickOn(footerBtn('Weiter'), 0.3, { arc: 0 });
  await waitFor(heading('Erscheinungsbild'));
  await hold(0.35);
  await clickOn(footerBtn('Weiter'), 0.3, { arc: 0 });
  await waitFor(heading('Infrastrukturprofil'));

  // Profiles
  await title({
    kind: 'cap',
    t0: S.t + 0.3,
    t1: S.t + 4.6,
    kicker: '02',
    text: 'Vom 8-GPU-Server bis zum Campus <span>mit 32 768 GPUs</span>',
  });
  await moveTo({ sel: '[role="radio"]', text: 'Single AI Server' }, 0.7);
  await moveTo({ sel: '[role="radio"]', text: 'GPU Rack' }, 0.45);
  await moveTo({ sel: '[role="radio"]', text: 'Enterprise AI' }, 0.45);
  await clickOn({ sel: '[role="radio"]', text: 'Hyperscale AI Campus' }, 0.55);
  await hold(0.9);
  await clickOn(footerBtn('Weiter'), 0.6);
  await waitFor(heading('Hardware'));
  const live = await waitFor({ sel: '.sh-live' });
  cam({ cx: Math.min(live.cx, W - 768 / 1.7), cy: live.y + 190, z: 1.7 }, 1.3);
  await title({
    kind: 'cap',
    t0: S.t + 0.4,
    t1: S.t + 3.4,
    kicker: '03',
    text: 'Ingenieurprüfung <span>· Platz, Leistung, Kühlung, Redundanz</span>',
  });
  await hold(2.8);
  cam({ ...FULL }, 0.9);
  await hold(0.5);
  for (const step of ['Netzwerk', 'Standort & Anlage', 'Monitoring', 'Sicherheit & Betrieb', 'Überprüfung']) {
    await clickOn(footerBtn('Weiter'), 0.22, { arc: 0 });
    await waitFor(heading(step));
    await hold(0.18);
  }
  await hold(0.5);
  await clickOn(footerBtn('System initialisieren'), 0.6);

  // ---- 3 · Infrastructure boot ---------------------------------------------------------------------
  T.infra = S.t;
  anim(S.cursor, { vis: 0 }, 0.3);
  await waitFor({ sel: '.sh-boot' }, { max: 20 });
  mouseLive = false;
  cam({ z: 0.74, rx: 6, ry: 16, ox: -330, oy: 10 }, 2.4);
  sound('whoosh');
  await title({
    t0: S.t + 0.8,
    t1: S.t + 5.4,
    kicker: 'Inbetriebnahme',
    lines: ['4 096 Nodes.', '*Hochgefahren.*'],
    sub: 'Fabric, Kühlung, Stromversorgung — in Sekunden simuliert.',
    x: 1190,
    y: 360,
  });
  await hold(4.6, { appSpeed: 1.4 });
  await waitFor({ sel: '.sh-login' }, { max: 60, appSpeed: 2 });
  cam({ ...FULL }, 1.8);
  await hold(1.0);

  // ---- 4 · Sign-in -------------------------------------------------------------------------------------
  T.login = S.t;
  const pw = await waitFor({ sel: 'input', label: 'Passwort' });
  cam({ cx: pw.cx, cy: pw.cy - 60, z: 1.6 }, 1.6);
  mouseLive = true;
  S.cursor.sx = pw.cx + 140;
  S.cursor.sy = pw.cy + 160;
  anim(S.cursor, { vis: 1 }, 0.4, 'out');
  await title({
    kind: 'cap',
    t0: S.t + 0.5,
    t1: S.t + 4.0,
    kicker: '04',
    text: 'Anmeldung <span>· PBKDF2 mit 600 000 Iterationen</span>',
  });
  await hold(0.6);
  await clickOn({ sel: 'input', label: 'Passwort' }, 0.6);
  await type(PASSWORD, 17);
  await hold(0.2);
  sound('key', { strong: true });
  await page.keyboard.press('Enter');
  await waitFor({ sel: '.os-desktop' }, { max: 20 });
  cam({ ...FULL }, 1.6);
  sound('whoosh');
  await hold(1.4);

  // ---- 5 · Desktop -------------------------------------------------------------------------------------
  T.desktop = S.t;
  await title({
    kind: 'cap',
    t0: S.t,
    t1: S.t + 4.0,
    kicker: '05',
    text: 'Ein vollständiger Desktop <span>· Menüleiste, Dock, Fenster</span>',
  });
  const dockFirst = await find({ sel: '.os-dock button', nth: 0 });
  await moveTo({ x: dockFirst.cx - 40, y: dockFirst.cy + 8 }, 1.0);
  const wlBtn = await find({ sel: '.os-dock button', label: 'Workloads' });
  await moveTo({ x: wlBtn.cx, y: wlBtn.cy + 4 }, 1.1, { arc: 0, ease: 'sine' });
  await hold(0.15);
  await click();
  await waitFor({ sel: '.os-window[data-app="workloads"]' });
  await hold(0.6);
  const gpus = await waitFor({ field: 'GPUs' });
  const win = await find({ sel: '.os-window[data-app="workloads"]' });
  cam({ cx: win.cx, cy: win.cy, z: 1.6 }, 1.4);
  await title({
    kind: 'cap',
    t0: S.t + 0.6,
    t1: S.t + 5.2,
    kicker: '06',
    text: 'Training auf 8 192 GPUs <span>· automatisch geplant</span>',
  });
  await clickOn({ field: 'GPUs' }, 0.8);
  await page.keyboard.press('Control+a');
  await type('8192', 9);
  await hold(1.4);
  await clickOn({ sel: '.os-window[data-app="workloads"] button', text: 'Job starten' }, 0.8);
  await hold(0.8);
  cam({ ...FULL }, 1.2);
  await hold(0.6);

  // System search → Cluster
  await shortcut('Control+k', 'Strg+K');
  await hold(0.3);
  await type('Cluster', 11);
  await hold(0.4);
  sound('key', { strong: true });
  await page.keyboard.press('Enter');
  await waitFor({ sel: '.os-window[data-app="cluster"]' });
  await hold(0.8);

  // Snap windows by dragging them to the screen edges
  await title({
    kind: 'cap',
    t0: S.t + 0.2,
    t1: S.t + 5.0,
    kicker: '07',
    text: 'Fenster einrasten <span>· ziehen, kacheln, wechseln</span>',
  });
  const cl = await find({ sel: '.os-window[data-app="cluster"] .os-window__title' });
  await moveTo({ x: cl.cx, y: cl.cy }, 0.7);
  await page.mouse.down();
  S.cursor.press = true;
  sound('click');
  await hold(0.15);
  await moveTo({ x: W - 1, y: cl.cy + 120 }, 0.9, { arc: 0.05 });
  await hold(0.45);
  await page.mouse.up();
  S.cursor.press = false;
  sound('snap');
  await hold(0.5);
  const wl = await find({ sel: '.os-window[data-app="workloads"] .os-window__title' });
  await moveTo({ x: wl.cx, y: wl.cy }, 0.7);
  await page.mouse.down();
  S.cursor.press = true;
  sound('click');
  await hold(0.15);
  await moveTo({ x: 1, y: wl.cy + 160 }, 0.9, { arc: -0.05 });
  await hold(0.45);
  await page.mouse.up();
  S.cursor.press = false;
  sound('snap');
  await hold(0.8);

  // Cluster map close-up
  const map = await find({ sel: '.os-window[data-app="cluster"] .ap-cluster__map' });
  cam({ cx: map.cx, cy: map.cy + 30, z: 2.0 }, 1.6);
  await title({
    kind: 'cap',
    t0: S.t + 0.6,
    t1: S.t + 5.6,
    kicker: '08',
    text: '4 096 Nodes, live <span>· Auslastung, Temperatur, Leistung</span>',
  });
  await moveTo({ x: map.cx + 60, y: map.cy + 20 }, 1.4);
  await hold(1.0);
  const sel = await find({ sel: '.os-window[data-app="cluster"] select', label: 'Karte' });
  await moveTo({ x: sel.cx, y: sel.cy }, 0.8);
  await page.evaluate(() => {
    const doc = document.getElementById('app').contentDocument;
    doc.querySelector('.os-window[data-app="cluster"] select[aria-label="Karte"]').focus();
  });
  S.ripples.push({ sx: S.cursor.sx, sy: S.cursor.sy, age: 0 });
  sound('click');
  await page.keyboard.press('ArrowDown');
  await hold(1.6);
  await moveTo({ x: map.x + map.w * 0.3, y: map.y + map.h * 0.45 }, 0.9);
  await click();
  await hold(0.6);

  // Fault injection → alarm
  cam({ cx: W / 2 + 200, cy: H / 2, z: 1.4 }, 1.2);
  await clickOn({ sel: '.os-window[data-app="cluster"] button', text: 'GPU Xid 79' }, 0.9);
  await waitFor({ sel: '[role="dialog"] button, [role="alertdialog"] button', text: 'Fehler injizieren' });
  await hold(0.5);
  await title({
    kind: 'cap',
    t0: S.t,
    t1: S.t + 4.6,
    kicker: '09',
    text: 'Fehler injizieren <span>· Alarme in Echtzeit</span>',
  });
  await clickOn(
    { sel: '[role="dialog"] button, [role="alertdialog"] button', text: 'Fehler injizieren' },
    0.7,
  );
  sound('alert');
  cam({ cx: W - 300, cy: 160, z: 1.7 }, 1.4);
  await hold(2.6);
  cam({ ...FULL }, 1.3);

  // Control centre → light mode
  await clickOn({ sel: '.os-tray button', label: 'Kontrollzentrum' }, 1.1);
  await hold(0.5);
  await title({
    kind: 'cap',
    t0: S.t,
    t1: S.t + 3.6,
    kicker: '10',
    text: 'Hell oder dunkel <span>· systemweit</span>',
  });
  await clickOn({ sel: 'button', text: 'Dunkelmodus' }, 0.8);
  sound('snap');
  await hold(1.4);
  await page.keyboard.press('Escape');
  await hold(0.8);

  // ---- 6 · Hero orbit with features ----------------------------------------------------------------------
  T.hero = S.t;
  anim(S.cursor, { vis: 0 }, 0.4);
  mouseLive = false;
  await page.mouse.move(1919, 1079);
  cam({ z: 0.6, rx: 9, ry: -20, ox: 0, oy: 40 }, 2.6);
  anim(S, { floor: 1 }, 2.4, 'inOut', 0.6);
  sound('whoosh');
  await title({
    align: 'center',
    t0: S.t + 1.0,
    t1: S.t + 7.6,
    kicker: 'Alles in einem',
    lines: ['Ein System. *Ganz im Browser.*'],
    y: 92,
    size: 58,
  });
  const feats = [
    ['Deterministische Simulation', 120, 300],
    ['Offline-fähig', 1480, 280],
    ['Installierbar als App', 1500, 520],
    ['Tausende GPUs in Echtzeit', 90, 560],
    ['Deutsch · English', 1520, 760],
    ['Ereignisprotokoll & Alarme', 110, 820],
  ];
  feats.forEach(([text, x, y], i) =>
    chip({ text, x, y, t0: S.t + 1.6 + i * 0.32, t1: S.t + 7.6, phase: i * 1.7, vx: x < 900 ? 4 : -4 }),
  );
  await hold(2.6);
  cam({ ry: 14, rx: 7 }, 5.0, 'sine');
  await hold(5.0);

  // ---- 7 · Install ------------------------------------------------------------------------------------------
  T.install = S.t;
  await loadApp('gate', `${ORIGIN}/?gate`);
  gateClock = true;
  await waitFor({ sel: '.os-gate' }, { max: 10, capture: false }).catch(() => undefined);
  cam({ ox: -1500, oz: -700, ry: 34, rx: 4, dim: 0.7, z: 0.5, opacity: 0 }, 1.8);
  anim(S, { floor: 0.6 }, 1.6);
  anim(S.b, { ox: 330, z: 0.68, ry: -14, rx: 4, opacity: 1, cx: W / 2, cy: H / 2 }, 1.9, 'cine', 0.1);
  sound('whoosh');
  await title({
    t0: S.t + 0.9,
    t1: S.t + 5.8,
    kicker: 'Installation',
    lines: ['Installiert wie', 'eine App.'],
    sub: 'Ohne Browserleiste, offline startfähig — für Desktop und Tablet im Desktopmodus.',
    x: 130,
    y: 330,
    size: 70,
  });
  await hold(5.8);

  // ---- 8 · End card ------------------------------------------------------------------------------------------
  T.end = S.t;
  cam({ blur: 18, opacity: 0, z: 0.5 }, 1.2, 'inOut');
  anim(S.b, { blur: 18, opacity: 0, z: 0.5 }, 1.2, 'inOut');
  anim(S, { floor: 0 }, 1.2);
  await hold(0.6);
  S.end = { t0: S.t };
  sound('boom', { soft: true });
  await hold(5.6);
  anim(S, { fade: 1 }, 1.2, 'inOut');
  await hold(1.4);
}

const started = Date.now();
try {
  await film();
} catch (e) {
  console.error('FILM ERROR at t=', S.t.toFixed(2), e);
  await page.screenshot({ path: `${OUT_DIR}/error.png` });
}
ffmpeg.stdin.end();
await ffDone;
writeFileSync(
  `${OUT_DIR}/timeline.json`,
  JSON.stringify({ fps: FPS, duration: S.t, scenes: T, events }, null, 1),
);
console.log(
  `frames ${frameNo}, duration ${S.t.toFixed(2)} s, render ${((Date.now() - started) / 1000).toFixed(0)} s`,
);
await browser.close();
server.close();
