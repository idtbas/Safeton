/**
 * Boot sequence: firmware/POST → kernel & services → infrastructure initialisation → handover.
 *
 * Every line shown is derived from real data — browser host facts, measured kernel boot steps,
 * the catalog, the expanded topology and live engine snapshots. Pacing only spaces the
 * presentation (≈ 6–10 s in total); the work itself is never faked. A cold start waits until the
 * configured share of nodes has completed POST and OS boot (accelerated simulation time).
 */
import { AlertTriangle, Check, Loader2, RotateCcw, SkipForward, TerminalSquare } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG_VERSION, part } from '../../catalog';
import {
  NODE_STATE_NAMES,
  deriveMetrics,
  expandTopology,
  type Snapshot,
  type TopologyInfo,
} from '../../engine';
import { useEngineStore } from '../../os/engine/store';
import { useT, type MessageKey, type Translate } from '../../os/i18n';
import {
  APP_VERSION,
  bootCore,
  controlEngine,
  infrastructureStartKind,
  onBootProgress,
  resetAndReconfigure,
  startInfrastructure,
  type BootStep,
} from '../../os/kernel';
import { useSettingsStore } from '../../os/settings/store';
import type { ShellEvent, ShellPhase } from '../../os/shell/machine';
import { Button, Kbd, Progress, fmt } from '../../ui';
import { collectHostInfo } from './hostInfo';

type Stage = 'firmware' | 'kernel' | 'infrastructure' | 'handover';
const STAGES: Stage[] = ['firmware', 'kernel', 'infrastructure', 'handover'];
const STAGE_KEY: Record<Stage, MessageKey> = {
  firmware: 'boot.stage.firmware',
  kernel: 'boot.stage.kernel',
  infrastructure: 'boot.stage.infrastructure',
  handover: 'boot.stage.handover',
};

type Level = 'info' | 'ok' | 'warn' | 'fail';
interface LogLine {
  id: number;
  at: number;
  stage: Stage;
  level: Level;
  text: string;
}

type CheckId = 'fabric' | 'nodes' | 'power' | 'cooling' | 'start';
interface Check {
  id: CheckId;
  label: string;
  detail: string;
  status: 'pending' | 'running' | 'ok' | 'warn';
  progress?: number;
}

/** Simulated seconds per real second while waiting for a cold start (POST + OS boot ≈ 4 min). */
const COLD_BOOT_TIME_SCALE = 60;
/** Upper bound for the cold-start wait in real time before handing over anyway. */
const COLD_BOOT_TIMEOUT_MS = 60_000;
/** Racks listed individually in the verbose log before summarising. */
const VERBOSE_RACK_LINES = 48;

const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
let lineId = 0;

function useReducedMotion(): boolean {
  const pref = useSettingsStore((s) => s.settings.appearance.reducedMotion);
  const [system, setSystem] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setSystem(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return pref === 'on' || (pref === 'system' && system);
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

function waitForSnapshot(predicate: (s: Snapshot) => boolean, signal: { cancelled: boolean }) {
  return new Promise<Snapshot | null>((resolve) => {
    const check = (s: Snapshot | null) => {
      if (signal.cancelled) {
        unsub();
        resolve(null);
      } else if (s && predicate(s)) {
        unsub();
        resolve(s);
      }
    };
    const unsub = useEngineStore.subscribe((st) => check(st.snapshot));
    check(useEngineStore.getState().snapshot);
  });
}

export function BootScreen({ phase, send }: { phase: ShellPhase; send: (e: ShellEvent) => void }) {
  const t = useT();
  const reduced = useReducedMotion();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [stageState, setStageState] = useState<Record<Stage, 'pending' | 'running' | 'done' | 'failed'>>({
    firmware: 'pending',
    kernel: 'pending',
    infrastructure: 'pending',
    handover: 'pending',
  });
  const [checks, setChecks] = useState<Check[]>([]);
  const [kernelSteps, setKernelSteps] = useState<BootStep[]>([]);
  const [verbose, setVerbose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipRef = useRef(false);
  const skipWaiters = useRef(new Set<() => void>());
  const logRef = useRef<HTMLDivElement>(null);

  const log = useCallback((stage: Stage, text: string, level: Level = 'info') => {
    const line = { id: ++lineId, at: performance.now() - t0, stage, level, text };
    setLines((l) => (l.length > 4000 ? [...l.slice(-3000), line] : [...l, line]));
  }, []);

  const setStage = useCallback(
    (stage: Stage, state: 'pending' | 'running' | 'done' | 'failed') =>
      setStageState((s) => ({ ...s, [stage]: state })),
    [],
  );

  const upsertCheck = useCallback((c: Check) => {
    setChecks((list) => {
      const i = list.findIndex((x) => x.id === c.id);
      if (i < 0) return [...list, c];
      const next = list.slice();
      next[i] = c;
      return next;
    });
  }, []);

  /** Presentation delay that resolves immediately once the boot is skipped. */
  const pace = useCallback((ms: number) => {
    if (skipRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        skipWaiters.current.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      skipWaiters.current.add(done);
    });
  }, []);

  const skip = useCallback(() => {
    skipRef.current = true;
    for (const w of [...skipWaiters.current]) w();
  }, []);

  const fail = useCallback(
    (stage: Stage, err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log(stage, msg, 'fail');
      setStage(stage, 'failed');
      setError(msg);
    },
    [log, setStage],
  );

  // Keyboard: Esc skips the animation, V toggles the verbose text log.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') skip();
      else if (e.key === 'v' || e.key === 'V') setVerbose((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skip]);

  useEffect(() => onBootProgress(setKernelSteps), []);

  // ---- Firmware ----------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'firmware') return;
    const signal = { cancelled: false };
    void (async () => {
      setStage('firmware', 'running');
      const host = await collectHostInfo();
      const steps: [string, Level][] = [
        [`Safeton management firmware ${APP_VERSION} · catalog ${CATALOG_VERSION}`, 'info'],
        [`Host platform: ${host.platform} · ${host.browser}`, 'info'],
        [
          `CPU: ${host.logicalCores ?? '?'} logical cores` +
            (host.memoryGB ? ` · memory ≥ ${host.memoryGB} GB (reported)` : ''),
          'ok',
        ],
        [
          `Display: ${host.screen} @ ${host.pixelRatio}× · locale ${host.language} · TZ ${host.timeZone}`,
          'ok',
        ],
        [
          `Secure context: ${host.secureContext ? 'yes' : 'no'} · Web Crypto: ${host.webCrypto ? 'available' : 'missing'}`,
          host.webCrypto ? 'ok' : 'warn',
        ],
        [
          `Worker threads: ${host.workers ? 'available' : 'unavailable'} · IndexedDB: ${host.indexedDB ? 'available' : 'unavailable'}`,
          host.workers && host.indexedDB ? 'ok' : 'warn',
        ],
        [
          host.storageQuotaGB !== null
            ? `Storage quota ${host.storageQuotaGB.toFixed(1)} GB · in use ${host.storageUsageMB?.toFixed(1) ?? '?'} MB`
            : 'Storage quota: not reported by this browser',
          'ok',
        ],
        ['POST complete — handing off to kernel', 'ok'],
      ];
      for (const [text, level] of steps) {
        if (signal.cancelled) return;
        log('firmware', text, level);
        await pace(220);
      }
      if (signal.cancelled) return;
      setStage('firmware', 'done');
      send({ type: 'FIRMWARE_DONE' });
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [phase, log, pace, send, setStage]);

  // ---- Kernel & services -------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'kernel') return;
    const signal = { cancelled: false };
    void (async () => {
      setStage('kernel', 'running');
      let info;
      try {
        info = await bootCore();
      } catch (err) {
        if (!signal.cancelled) fail('kernel', err);
        return;
      }
      // The core boot takes a few hundred milliseconds; report each measured step in turn.
      const steps = await new Promise<BootStep[]>((resolve) => {
        const unsub = onBootProgress((s) => resolve(s));
        unsub();
      });
      for (const s of steps.filter(
        (x) => x.status === 'done' && ['storage', 'settings', 'catalog', 'account', 'engine'].includes(x.id),
      )) {
        if (signal.cancelled) return;
        log('kernel', `${s.label}…`);
        await pace(320);
        log('kernel', `[ OK ] ${s.label} — ${s.detail ?? ''} (${(s.ms ?? 0).toFixed(1)} ms)`, 'ok');
      }
      if (signal.cancelled) return;
      log(
        'kernel',
        `Storage backend: ${info.storageKind === 'indexeddb' ? 'IndexedDB' : 'volatile memory'} · engine: ${info.engineMode} · ${info.catalogItems} catalog parts`,
        info.storageKind === 'indexeddb' ? 'ok' : 'warn',
      );
      log(
        'kernel',
        info.setupRequired
          ? 'No committed configuration — starting the setup assistant'
          : `Configuration committed by ${info.account?.username ?? 'unknown'}`,
      );
      await pace(300);
      if (signal.cancelled) return;
      setStage('kernel', 'done');
      send({ type: 'CORE_READY', setupRequired: info.setupRequired });
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [phase, log, pace, send, setStage, fail]);

  // ---- Infrastructure ----------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'infrastructure') return;
    const signal = { cancelled: false };
    void (async () => {
      setStageState((s) => ({
        firmware: s.firmware === 'pending' ? 'done' : s.firmware,
        kernel: s.kernel === 'pending' ? 'done' : s.kernel,
        infrastructure: 'running',
        handover: 'pending',
      }));
      let topo: TopologyInfo;
      try {
        topo = (await startInfrastructure()).topology;
        await waitForSnapshot(() => true, signal);
      } catch (err) {
        if (!signal.cancelled) fail('infrastructure', err);
        return;
      }
      if (signal.cancelled) return;
      await runInfraChecks(topo, signal, { t, log, pace, upsertCheck, skipRef });
      if (signal.cancelled) return;
      setStage('infrastructure', 'done');
      setStage('handover', 'running');
      const snap = useEngineStore.getState().snapshot;
      log(
        'handover',
        t('boot.readyDetail', {
          site: topo.spec.site.name,
          nodes: topo.nodes.length,
          gpus: snap?.cluster.gpusHealthy ?? topo.gpuCount,
        }),
        'ok',
      );
      await pace(800);
      if (signal.cancelled) return;
      setStage('handover', 'done');
      send({ type: 'INFRA_READY' });
    })();
    return () => {
      signal.cancelled = true;
    };
  }, [phase, log, pace, send, setStage, upsertCheck, fail, t]);

  useEffect(() => {
    if (verbose && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines, verbose]);

  const progress = useMemo(() => {
    const weights: Record<Stage, number> = {
      firmware: 0.15,
      kernel: 0.25,
      infrastructure: 0.5,
      handover: 0.1,
    };
    let p = 0;
    for (const s of STAGES) {
      if (stageState[s] === 'done') p += weights[s];
      else if (stageState[s] === 'running') {
        const inner =
          s === 'infrastructure' && checks.length
            ? checks.reduce(
                (a, c) => a + (c.status === 'ok' || c.status === 'warn' ? 1 : (c.progress ?? 0)),
                0,
              ) / 5
            : s === 'kernel' && kernelSteps.length
              ? kernelSteps.filter((k) => k.status === 'done').length / kernelSteps.length
              : 0.4;
        p += weights[s] * Math.min(1, inner);
      }
    }
    return p;
  }, [stageState, checks, kernelSteps]);

  const current = STAGES.find((s) => stageState[s] === 'running' || stageState[s] === 'failed') ?? 'handover';
  const recent = lines.slice(-6);

  return (
    <main className="sh-boot" data-reduced={reduced || undefined} aria-busy={!error}>
      <div className="sh-boot__inner">
        <header className="sh-boot__brand">
          <BrandMark />
          <div>
            <div className="sh-boot__name">SAFETON</div>
            <div className="sh-boot__sub">AI Infrastructure OS · {APP_VERSION}</div>
          </div>
        </header>

        {verbose ? (
          <div
            ref={logRef}
            className="sh-boot__log"
            role="log"
            aria-live="polite"
            aria-label={t('boot.verbose')}
            tabIndex={0}
          >
            {lines.map((l) => (
              <div key={l.id} className="sh-boot__logline" data-level={l.level}>
                <span className="sh-boot__ts">[{(l.at / 1000).toFixed(6).padStart(11, ' ')}]</span> {l.text}
              </div>
            ))}
          </div>
        ) : (
          <>
            <ol className="sh-boot__stages" aria-label="Boot stages">
              {STAGES.map((s) => (
                <li key={s} data-state={stageState[s]}>
                  <span className="sh-boot__stage-mark" aria-hidden>
                    {stageState[s] === 'done' ? (
                      <Check size={12} strokeWidth={3} />
                    ) : stageState[s] === 'running' ? (
                      <Loader2 size={12} className="sh-spin" />
                    ) : stageState[s] === 'failed' ? (
                      <AlertTriangle size={12} />
                    ) : null}
                  </span>
                  {t(STAGE_KEY[s])}
                </li>
              ))}
            </ol>
            <Progress value={progress} label={t(STAGE_KEY[current])} />
            {checks.length > 0 && (
              <ul className="sh-boot__checks">
                {checks.map((c) => (
                  <li key={c.id} data-status={c.status}>
                    <span className="sh-boot__check-mark" aria-hidden>
                      {c.status === 'ok' ? (
                        <Check size={12} strokeWidth={3} />
                      ) : c.status === 'warn' ? (
                        <AlertTriangle size={12} />
                      ) : c.status === 'running' ? (
                        <Loader2 size={12} className="sh-spin" />
                      ) : null}
                    </span>
                    <span className="sh-boot__check-label">{c.label}</span>
                    <span className="sh-boot__check-detail mono">{c.detail}</span>
                    {c.status === 'running' && c.progress !== undefined && (
                      <span className="sh-boot__check-bar">
                        <Progress value={c.progress} thin />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="sh-boot__tail mono" aria-live="polite">
              {recent.map((l) => (
                <div key={l.id} data-level={l.level}>
                  {l.text}
                </div>
              ))}
            </div>
          </>
        )}

        {error ? (
          <div className="sh-boot__error" role="alert">
            <strong>{t('boot.failed')}</strong>
            <span className="mono">{error}</span>
            <div className="sh-row">
              <Button icon={<RotateCcw size={14} />} onClick={() => location.reload()}>
                {t('common.retry')}
              </Button>
              <Button variant="danger" onClick={() => void resetAndReconfigure()}>
                {t('boot.reset')}
              </Button>
            </div>
          </div>
        ) : (
          <footer className="sh-boot__footer">
            <span className="sf-muted">
              <Kbd>Esc</Kbd> {t('boot.skip')} · <Kbd>V</Kbd> {t('boot.verbose')}
            </span>
            <span className="sh-row">
              <Button
                size="sm"
                variant="ghost"
                icon={<TerminalSquare size={13} />}
                pressed={verbose}
                onClick={() => setVerbose((v) => !v)}
              >
                {t('boot.verbose')}
              </Button>
              <Button size="sm" variant="ghost" icon={<SkipForward size={13} />} onClick={skip}>
                {t('boot.skip')}
              </Button>
            </span>
          </footer>
        )}
      </div>
    </main>
  );
}

/** Product mark (isometric node), shared with the Engineering Preview header. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="sh-brandmark">
      <path
        d="M8 11.5 16 7l8 4.5v9L16 25l-8-4.5z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M8 11.5 16 16l8-4.5M16 16v9"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity=".55"
      />
    </svg>
  );
}

// ---- Infrastructure checks -------------------------------------------------------------------

interface InfraCtx {
  t: Translate;
  log: (stage: Stage, text: string, level?: Level) => void;
  pace: (ms: number) => Promise<void>;
  upsertCheck: (c: Check) => void;
  skipRef: { current: boolean };
}

async function runInfraChecks(topo: TopologyInfo, signal: { cancelled: boolean }, ctx: InfraCtx) {
  const { t, log, pace, upsertCheck } = ctx;
  const spec = topo.spec;
  const snap0 = useEngineStore.getState().snapshot!;
  const metrics = deriveMetrics(expandTopology(spec));
  const stateCount = (s: Snapshot, name: (typeof NODE_STATE_NAMES)[number]) =>
    s.cluster.nodesByState[NODE_STATE_NAMES.indexOf(name)] ?? 0;

  // 1. Fabric subnet manager
  const fabricLabel = t('boot.infra.fabric');
  if (topo.fabric.topology === 'none' || topo.switches.length === 0) {
    upsertCheck({ id: 'fabric', label: fabricLabel, detail: t('boot.infra.fabricNone'), status: 'ok' });
    log('infrastructure', 'Fabric: no backend fabric configured (single-node workloads)', 'ok');
  } else {
    upsertCheck({ id: 'fabric', label: fabricLabel, detail: '…', status: 'running', progress: 0 });
    const tiers = new Map<number, number>();
    for (const sw of topo.switches) tiers.set(sw.tier, (tiers.get(sw.tier) ?? 0) + 1);
    const tierNames = ['leaf', 'spine', 'core'];
    log(
      'infrastructure',
      `SM: sweeping ${topo.fabric.planes} plane(s), ${topo.fabric.switchModel ?? 'switch'} @ ${topo.fabric.portSpeedGbps} Gb/s`,
    );
    await pace(240);
    log(
      'infrastructure',
      `SM: discovered ${topo.switches.length} switches (${[...tiers.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([tier, n]) => `${n} ${tierNames[tier] ?? `tier-${tier}`}`)
        .join(', ')}) · ${metrics.counts.links} links`,
      'ok',
    );
    const down = snap0.cluster.switchesDown;
    const linksDown = snap0.cluster.linksDown;
    await pace(240);
    log(
      'infrastructure',
      `SM: routing tables computed (${topo.fabric.tiers}-tier ${topo.fabric.topology}, oversubscription ${spec.fabric.oversubscription}:1) — bisection ${metrics.network.bisectionTbps.toFixed(1)} Tb/s`,
      down || linksDown ? 'warn' : 'ok',
    );
    upsertCheck({
      id: 'fabric',
      label: fabricLabel,
      detail: t('boot.infra.fabricDetail', {
        switches: topo.switches.length,
        links: metrics.counts.links,
        tiers: topo.fabric.tiers,
        topology: topo.fabric.topology,
      }),
      status: down || linksDown ? 'warn' : 'ok',
    });
  }
  if (signal.cancelled) return;

  // 2. Node registration per hall / rack
  const nodesLabel = t('boot.infra.nodes');
  const total = topo.nodes.length;
  const computeRacks = topo.racks.filter((r) => r.nodeCount > 0);
  let registered = 0;
  let racksLogged = 0;
  const batches = Math.min(12, computeRacks.length);
  const perBatch = Math.ceil(computeRacks.length / Math.max(1, batches));
  for (const hall of topo.halls) {
    const racks = hall.racks.map((i) => ({ i, r: topo.racks[i]! })).filter((x) => x.r.nodeCount > 0);
    const hallNodes = racks.reduce((n, x) => n + x.r.nodeCount, 0);
    log('infrastructure', `${hall.id} ${hall.name}: registering ${hallNodes} nodes in ${racks.length} racks`);
    for (let k = 0; k < racks.length; k += perBatch) {
      const chunk = racks.slice(k, k + perBatch);
      for (const { r } of chunk) {
        registered += r.nodeCount;
        if (racksLogged < VERBOSE_RACK_LINES) {
          const first = topo.nodes[r.nodeStart]!;
          const last = topo.nodes[r.nodeStart + r.nodeCount - 1]!;
          log(
            'infrastructure',
            `  rack ${r.name} (row ${r.row}, ${r.cooling}): ${r.nodeCount} × ${first.platform} ${first.hostname}${r.nodeCount > 1 ? `…${last.hostname}` : ''}`,
          );
        } else if (racksLogged === VERBOSE_RACK_LINES) {
          log('infrastructure', `  … ${computeRacks.length - VERBOSE_RACK_LINES} further racks`);
        }
        racksLogged++;
      }
      upsertCheck({
        id: 'nodes',
        label: nodesLabel,
        detail: t('boot.infra.nodesDetail', { registered, total, gpus: topo.gpuCount }),
        status: 'running',
        progress: registered / Math.max(1, total),
      });
      await pace(Math.max(40, 900 / Math.max(1, batches)));
      if (signal.cancelled) return;
    }
  }
  const failed = stateCount(snap0, 'failed');
  upsertCheck({
    id: 'nodes',
    label: nodesLabel,
    detail: t('boot.infra.nodesDetail', { registered: total, total, gpus: topo.gpuCount }),
    status: failed ? 'warn' : 'ok',
  });
  log(
    'infrastructure',
    `Inventory: ${total} nodes, ${topo.gpuCount} GPUs (${topo.nodes[0]?.gpuModel ?? 'n/a'}), ${topo.storage.length} storage appliance(s)` +
      (failed ? ` · ${failed} node(s) failed` : ''),
    failed ? 'warn' : 'ok',
  );

  // 3. Power distribution
  const snap = useEngineStore.getState().snapshot ?? snap0;
  const ups = part('ups', spec.site.ups.upsId);
  const upsKW = ups.moduleKW.v * spec.site.ups.modules;
  const itKW = snap.facility.itPowerW / 1000;
  upsertCheck({ id: 'power', label: t('boot.infra.power'), detail: '…', status: 'running', progress: 0.5 });
  await pace(260);
  log(
    'infrastructure',
    `Power: utility ${spec.site.utility.feeds} × ${spec.site.utility.feedMW} MW · UPS ${spec.site.ups.modules} × ${ups.name} (${spec.site.ups.redundancy}) · generators ${spec.site.generators.count} × ${spec.site.generators.unitMW} MW (${spec.site.generators.redundancy})`,
    'ok',
  );
  log(
    'infrastructure',
    `Power: IT load ${fmt.q(fmt.power(snap.facility.itPowerW))} of ${fmt.q(fmt.power(metrics.power.itPeakKW * 1000))} design peak · UPS loading ${pct(itKW / upsKW)}`,
    'ok',
  );
  upsertCheck({
    id: 'power',
    label: t('boot.infra.power'),
    detail: t('boot.infra.powerDetail', {
      it: fmt.q(fmt.power(snap.facility.itPowerW)),
      ups: pct(itKW / upsKW),
      feed: `${spec.site.utility.feeds} × ${spec.site.utility.feedMW} MW`,
    }),
    status: 'ok',
  });
  if (signal.cancelled) return;

  // 4. Cooling plant
  upsertCheck({
    id: 'cooling',
    label: t('boot.infra.cooling'),
    detail: '…',
    status: 'running',
    progress: 0.5,
  });
  await pace(260);
  let coolingWarn = false;
  for (const h of snap.halls) {
    const degraded = h.airUnitsHealthy < h.airUnitsInstalled || h.liquidUnitsHealthy < h.liquidUnitsInstalled;
    coolingWarn ||= degraded;
    log(
      'infrastructure',
      `Cooling ${h.id}: supply air ${fmt.temperature(h.supplyAirC)} (setpoint ${fmt.temperature(h.supplyAirSetpointC)}) · air units ${h.airUnitsHealthy}/${h.airUnitsInstalled}` +
        (h.liquidUnitsInstalled
          ? ` · CDUs ${h.liquidUnitsHealthy}/${h.liquidUnitsInstalled}, warm water ${fmt.temperature(h.liquidSupplyC ?? 0)}`
          : ''),
      degraded ? 'warn' : 'ok',
    );
  }
  const f = snap.facility;
  coolingWarn ||= f.chillersHealthy < f.chillersInstalled;
  log(
    'infrastructure',
    `Plant: chillers ${f.chillersHealthy}/${f.chillersInstalled} · chilled water ${fmt.temperature(f.chilledWaterSupplyC)} · ambient ${fmt.temperature(f.ambientC)} · free cooling ${pct(f.freeCoolingChilled)}`,
    f.chillersHealthy < f.chillersInstalled ? 'warn' : 'ok',
  );
  const hottest = snap.halls.reduce((m, h) => Math.max(m, h.supplyAirC), -Infinity);
  upsertCheck({
    id: 'cooling',
    label: t('boot.infra.cooling'),
    detail: t('boot.infra.coolingDetail', {
      halls: snap.halls.length,
      supply: fmt.temperature(hottest),
      chillers: `${f.chillersHealthy}/${f.chillersInstalled}`,
    }),
    status: coolingWarn ? 'warn' : 'ok',
  });
  if (signal.cancelled) return;

  // 5. Cold start: wait for POST + OS boot of the required share of nodes
  const kind = infrastructureStartKind();
  const settings = useSettingsStore.getState().settings;
  if (kind === 'cold') {
    const target = Math.ceil(settings.simulation.bootMinCapacity * total);
    const label = t('boot.infra.cold');
    log(
      'infrastructure',
      `Cold start: powering on ${total} nodes, handing over at ${target} online (${pct(settings.simulation.bootMinCapacity)})`,
    );
    await controlEngine({ running: true, timeScale: COLD_BOOT_TIME_SCALE });
    const started = performance.now();
    let lastLogged = -1;
    const online = (s: Snapshot) => stateCount(s, 'online') + stateCount(s, 'degraded');
    const result = await new Promise<'ready' | 'timeout' | 'skipped' | 'cancelled'>((resolve) => {
      const tick = () => {
        if (signal.cancelled) return finish('cancelled');
        if (ctx.skipRef.current) return finish('skipped');
        const s = useEngineStore.getState().snapshot;
        if (s) {
          const on = online(s);
          upsertCheck({
            id: 'start',
            label,
            detail: t('boot.infra.coldDetail', {
              online: on,
              total,
              post: stateCount(s, 'post'),
              booting: stateCount(s, 'booting'),
              target,
            }),
            status: 'running',
            progress: target ? Math.min(1, on / target) : 1,
          });
          const decile = Math.floor((on / Math.max(1, total)) * 10);
          if (decile !== lastLogged) {
            lastLogged = decile;
            log(
              'infrastructure',
              `Cold start: ${on}/${total} online · ${stateCount(s, 'post')} POST · ${stateCount(s, 'booting')} OS boot · ${stateCount(s, 'offline')} off`,
            );
          }
          if (on >= target) return finish('ready');
        }
        if (performance.now() - started > COLD_BOOT_TIMEOUT_MS) return finish('timeout');
      };
      const unsub = useEngineStore.subscribe(tick);
      const timer = setInterval(tick, 250);
      function finish(r: 'ready' | 'timeout' | 'skipped' | 'cancelled') {
        unsub();
        clearInterval(timer);
        resolve(r);
      }
      tick();
    });
    await controlEngine({
      running: settings.simulation.startRunning,
      timeScale: settings.simulation.timeScale,
    });
    if (result === 'cancelled') return;
    const s = useEngineStore.getState().snapshot!;
    const on = online(s);
    upsertCheck({
      id: 'start',
      label,
      detail: t('boot.infra.coldDetail', {
        online: on,
        total,
        post: stateCount(s, 'post'),
        booting: stateCount(s, 'booting'),
        target,
      }),
      status: result === 'ready' ? 'ok' : 'warn',
    });
    log(
      'infrastructure',
      result === 'ready'
        ? `Cold start: capacity target reached (${on}/${total} online)`
        : `Cold start: handing over with ${on}/${total} online (${result}); remaining nodes continue booting`,
      result === 'ready' ? 'ok' : 'warn',
    );
  } else {
    const on = stateCount(snap, 'online') + stateCount(snap, 'degraded');
    upsertCheck({
      id: 'start',
      label: t('boot.infra.warm'),
      detail: `${on} / ${total} online · ${kind === 'restored' ? 'state restored' : 'new commissioning'}`,
      status: 'ok',
    });
    log(
      'infrastructure',
      kind === 'restored'
        ? `Attached to persisted cluster state at ${new Date(snap.time).toISOString()} (${on}/${total} online)`
        : `Warm start: ${on}/${total} nodes online`,
      'ok',
    );
  }
}
