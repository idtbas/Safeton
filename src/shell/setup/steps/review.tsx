/**
 * Setup steps 10–13: monitoring, security & operations, summary and initialisation.
 */
import { AlertTriangle, Check, Dices, Loader2, Pencil, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { part, tryPart } from '../../../catalog';
import type { MessageKey } from '../../../os/i18n';
import { SETUP_TASKS, completeSetup, type SetupTask } from '../../../os/kernel';
import { SETUP_STEPS, validateStep, type SetupData } from '../../../os/setup/model';
import {
  Button,
  CardSelect,
  KeyValue,
  NumberInput,
  Progress,
  Select,
  Slider,
  Toggle,
  fmt,
} from '../../../ui';
import { IssueList } from '../LiveDesignPanel';
import type { StepProps } from '../types';
import { LOCALES } from '../locales';

// ---- 10 Monitoring ---------------------------------------------------------------------------

export function MonitoringStep({ data, update, t, err }: StepProps) {
  const m = data.monitoring;
  const set = (patch: Partial<SetupData['monitoring']>) =>
    update((d) => ({ ...d, monitoring: { ...d.monitoring, ...patch } }));
  const num = { increaseLabel: t('ui.number.increase'), decreaseLabel: t('ui.number.decrease') };
  return (
    <div className="sh-form">
      <fieldset className="sh-fieldset">
        <legend>{t('setup.monitoring.telemetry')}</legend>
        <div className="sh-grid2">
          <NumberInput
            label={t('setup.monitoring.snapshotHz')}
            value={m.snapshotHz}
            min={1}
            max={20}
            unit="Hz"
            error={err('monitoring.snapshotHz')}
            onChange={(snapshotHz) => set({ snapshotHz })}
            {...num}
          />
          <NumberInput
            label={t('setup.monitoring.telemetryInterval')}
            value={m.telemetryIntervalS}
            min={1}
            max={60}
            unit="s"
            error={err('monitoring.telemetryIntervalS')}
            onChange={(telemetryIntervalS) => set({ telemetryIntervalS })}
            {...num}
          />
        </div>
      </fieldset>
      <fieldset className="sh-fieldset">
        <legend>{t('setup.monitoring.thresholds')}</legend>
        <div className="sh-grid2">
          <NumberInput
            label={t('setup.monitoring.gpuWarn')}
            value={m.gpuTempWarnC}
            min={50}
            max={110}
            unit="°C"
            error={err('monitoring.gpuTempWarnC')}
            onChange={(gpuTempWarnC) => set({ gpuTempWarnC })}
            {...num}
          />
          <NumberInput
            label={t('setup.monitoring.gpuCrit')}
            value={m.gpuTempCritC}
            min={50}
            max={120}
            unit="°C"
            error={err('monitoring.gpuTempCritC')}
            onChange={(gpuTempCritC) => set({ gpuTempCritC })}
            {...num}
          />
          <NumberInput
            label={t('setup.monitoring.hallSupply')}
            value={m.hallSupplyWarnC}
            min={15}
            max={40}
            step={0.5}
            unit="°C"
            error={err('monitoring.hallSupplyWarnC')}
            onChange={(hallSupplyWarnC) => set({ hallSupplyWarnC })}
            {...num}
          />
          <NumberInput
            label={t('setup.monitoring.pue')}
            value={m.pueWarn}
            min={1}
            max={3}
            step={0.05}
            error={err('monitoring.pueWarn')}
            onChange={(pueWarn) => set({ pueWarn })}
            {...num}
          />
        </div>
      </fieldset>
      <fieldset className="sh-fieldset">
        <legend>{t('setup.monitoring.notifications')}</legend>
        <div className="sh-grid2">
          <Select
            label={t('setup.monitoring.minSeverity')}
            value={m.minSeverity}
            onChange={(minSeverity) => set({ minSeverity })}
            options={(['notice', 'warning', 'error', 'critical'] as const).map((s) => ({
              value: s,
              label: t(`severity.${s}` as MessageKey),
            }))}
          />
          <div className="sh-toggle-row">
            <Toggle
              checked={m.toasts}
              onChange={(toasts) => set({ toasts })}
              label={t('setup.monitoring.toasts')}
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
}

// ---- 11 Security & operations ----------------------------------------------------------------

const TIMEOUTS = [0, 5, 15, 30, 60, 120, 240];
const FAILURE_RATES = [0, 1, 10, 100];
const TIME_SCALES = [1, 10, 60, 300, 3600];

export function OperationsStep({ data, update, t, err }: StepProps) {
  const o = data.operations;
  const set = (patch: Partial<SetupData['operations']>) =>
    update((d) => ({ ...d, operations: { ...d.operations, ...patch } }));
  return (
    <div className="sh-form">
      <fieldset className="sh-fieldset">
        <legend>{t('setup.operations.session')}</legend>
        <Select
          label={t('setup.operations.sessionTimeout')}
          value={String(o.sessionTimeoutMin)}
          onChange={(v) => set({ sessionTimeoutMin: Number(v) })}
          options={TIMEOUTS.map((m) => ({
            value: String(m),
            label: m === 0 ? t('setup.operations.never') : `${m} min`,
          }))}
        />
        <Toggle
          checked={o.lockScreen}
          onChange={(lockScreen) => set({ lockScreen })}
          label={t('setup.operations.lockScreen')}
        />
        <Toggle
          checked={o.confirmCritical}
          onChange={(confirmCritical) => set({ confirmCritical })}
          label={t('setup.operations.confirmCritical')}
        />
      </fieldset>
      <fieldset className="sh-fieldset">
        <legend>{t('setup.operations.simulation')}</legend>
        <div className="sf-field">
          <span className="sf-label">{t('setup.operations.failureRate')}</span>
          <CardSelect
            label={t('setup.operations.failureRate')}
            value={String(o.failureRateMultiplier)}
            size="sm"
            columns={130}
            onChange={(v) => set({ failureRateMultiplier: Number(v) })}
            options={[
              ...FAILURE_RATES.map((r) => ({
                value: String(r),
                title: t(`setup.operations.failureRate.${r}` as MessageKey),
              })),
              ...(FAILURE_RATES.includes(o.failureRateMultiplier)
                ? []
                : [{ value: String(o.failureRateMultiplier), title: `${o.failureRateMultiplier}×` }]),
            ]}
          />
        </div>
        <Toggle
          checked={o.autoRemediation}
          onChange={(autoRemediation) => set({ autoRemediation })}
          label={t('setup.operations.autoRemediation')}
        />
        <div className="sh-grid2">
          <div className="sh-inline">
            <NumberInput
              label={t('setup.operations.seed')}
              value={o.seed}
              min={0}
              max={4_294_967_295}
              error={err('operations.seed')}
              increaseLabel={t('ui.number.increase')}
              decreaseLabel={t('ui.number.decrease')}
              onChange={(seed) => set({ seed })}
            />
            <Button
              icon={<Dices size={14} />}
              onClick={() => set({ seed: crypto.getRandomValues(new Uint32Array(1))[0]! })}
            >
              {t('setup.operations.randomize')}
            </Button>
          </div>
          <Select
            label={t('setup.operations.timeScale')}
            value={String(o.timeScale)}
            onChange={(v) => set({ timeScale: Number(v) })}
            options={(TIME_SCALES.includes(o.timeScale) ? TIME_SCALES : [...TIME_SCALES, o.timeScale]).map(
              (s) => ({
                value: String(s),
                label: `${s}×`,
              }),
            )}
          />
        </div>
        <div className="sf-field">
          <span className="sf-label">{t('setup.operations.startMode')}</span>
          <CardSelect
            label={t('setup.operations.startMode')}
            value={o.startMode}
            size="sm"
            columns={220}
            onChange={(startMode) => set({ startMode })}
            options={(['warm', 'cold'] as const).map((m) => ({
              value: m,
              title: t(`setup.operations.${m}` as MessageKey),
              description: t(`setup.operations.${m}.desc` as MessageKey),
            }))}
          />
        </div>
        {o.startMode === 'cold' && (
          <div className="sf-field">
            <span className="sf-label">{t('setup.operations.bootMinCapacity')}</span>
            <Slider
              label={t('setup.operations.bootMinCapacity')}
              value={o.bootMinCapacity}
              min={0.5}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)} %`}
              onChange={(bootMinCapacity) =>
                set({ bootMinCapacity: Math.round(bootMinCapacity * 100) / 100 })
              }
            />
          </div>
        )}
      </fieldset>
    </div>
  );
}

// ---- 12 Summary ------------------------------------------------------------------------------

function Section({
  title,
  step,
  goto,
  t,
  items,
  invalid,
}: {
  title: string;
  step: number;
  goto: (s: number) => void;
  t: StepProps['t'];
  items: [string, string][];
  invalid?: boolean;
}) {
  return (
    <section className="sh-summary__section" data-invalid={invalid || undefined}>
      <header>
        <h3>
          {invalid && <XCircle size={13} aria-label={t('severity.error')} />} {title}
        </h3>
        <Button size="sm" variant="ghost" icon={<Pencil size={12} />} onClick={() => goto(step)}>
          {t('setup.summary.edit')}
        </Button>
      </header>
      <KeyValue items={items} />
    </section>
  );
}

export function SummaryStep({ data, t, goto, design }: StepProps) {
  const d = data.infra.design;
  const report = design.report;
  const m = report.metrics;
  const idx = (s: (typeof SETUP_STEPS)[number]) => SETUP_STEPS.indexOf(s);
  const invalid = (s: (typeof SETUP_STEPS)[number]) => Object.keys(validateStep(s, data)).length > 0;
  const sys = d.compute.system;
  const sysName =
    sys.kind === 'platform'
      ? `${sys.nodesPerRack} × ${tryPart('platform', sys.platformId)?.name ?? sys.platformId} / rack`
      : (tryPart('rack-system', sys.rackSystemId)?.name ?? sys.rackSystemId);
  const blocked = report.errors > 0;
  const yes = (b: boolean) => t(b ? 'common.enabled' : 'common.disabled');
  return (
    <div className="sh-summary">
      <p className="sh-note" data-tone={blocked ? 'critical' : 'good'} role="status">
        {blocked ? <XCircle size={14} /> : <Check size={14} />}
        {t(blocked ? 'setup.summary.blocked' : 'setup.summary.ready')}
      </p>
      <div className="sh-summary__grid">
        <Section
          title={t('setup.step.region.title')}
          step={idx('region')}
          goto={goto}
          t={t}
          invalid={invalid('region')}
          items={[
            [
              t('setup.region.language'),
              LOCALES.find((l) => l.value === data.region.locale)?.label ?? data.region.locale,
            ],
            [t('setup.region.timeZone'), data.region.timeZone],
            [
              t('setup.region.temperature'),
              `°${data.region.temperatureUnit} · ${t(data.region.hourCycle === 'h23' ? 'setup.region.h23' : 'setup.region.h12')}`,
            ],
          ]}
        />
        <Section
          title={t('setup.step.admin.title')}
          step={idx('admin')}
          goto={goto}
          t={t}
          invalid={invalid('admin')}
          items={[
            [t('setup.admin.displayName'), data.admin.displayName || '—'],
            [t('setup.admin.username'), data.admin.username || '—'],
            [t('setup.admin.role'), t(`role.${data.admin.role}` as MessageKey)],
            [
              t('setup.admin.password'),
              data.admin.credential
                ? `PBKDF2-SHA256 · ${fmt.formatNumber(data.admin.credential.iterations)}`
                : '—',
            ],
          ]}
        />
        <Section
          title={t('setup.step.system.title')}
          step={idx('system')}
          goto={goto}
          t={t}
          invalid={invalid('system')}
          items={[
            [t('setup.system.hostname'), data.system.hostname],
            [t('setup.system.siteName'), `${data.system.siteName} (${data.system.siteCode})`],
            [t('setup.system.infraName'), data.system.infraName],
          ]}
        />
        <Section
          title={t('setup.step.hardware.title')}
          step={idx('hardware')}
          goto={goto}
          t={t}
          invalid={invalid('hardware')}
          items={[
            [t('setup.hardware.system'), sysName],
            [t('setup.hardware.layout'), `${d.compute.racks} × ${d.halls} · ${d.racksPerRow}/row`],
            [t('setup.hardware.cooling'), t(`setup.hardware.cooling.${d.compute.cooling}` as MessageKey)],
            [
              t('setup.hardware.pdu'),
              `${d.compute.pdu.perFeed * d.compute.pdu.feeds} × ${part('pdu', d.compute.pdu.pduId).name}`,
            ],
          ]}
        />
        <Section
          title={t('setup.step.network.title')}
          step={idx('network')}
          goto={goto}
          t={t}
          invalid={invalid('network')}
          items={[
            [t('setup.network.topology'), t(`setup.network.topology.${d.fabric.topology}` as MessageKey)],
            ...(d.fabric.topology !== 'none'
              ? ([
                  [t('setup.network.switch'), part('switch', d.fabric.switchId).name],
                  [t('setup.network.oversubscription'), `${d.fabric.oversubscription}:1`],
                ] as [string, string][])
              : []),
            ...(m
              ? ([[t('setup.network.switches'), fmt.formatNumber(m.counts.switches)]] as [string, string][])
              : []),
          ]}
        />
        <Section
          title={t('setup.step.site.title')}
          step={idx('site')}
          goto={goto}
          t={t}
          invalid={invalid('site')}
          items={[
            [t('setup.site.climate'), `${d.site.city} · Ø ${fmt.temperature(d.site.climate.annualMeanC)}`],
            [t('setup.site.energyPrice'), `${fmt.formatNumber(d.site.energyPriceEurPerKWh, 2, 2)} €/kWh`],
            [t('setup.site.storage'), `${d.storage.count} × ${part('storage', d.storage.systemId).name}`],
          ]}
        />
        <Section
          title={t('setup.step.monitoring.title')}
          step={idx('monitoring')}
          goto={goto}
          t={t}
          invalid={invalid('monitoring')}
          items={[
            [
              t('setup.monitoring.snapshotHz'),
              `${data.monitoring.snapshotHz} Hz · ${data.monitoring.telemetryIntervalS} s`,
            ],
            [
              t('setup.monitoring.thresholds'),
              `${data.monitoring.gpuTempWarnC}/${data.monitoring.gpuTempCritC} °C · PUE ${data.monitoring.pueWarn}`,
            ],
            [t('setup.monitoring.minSeverity'), t(`severity.${data.monitoring.minSeverity}` as MessageKey)],
          ]}
        />
        <Section
          title={t('setup.step.operations.title')}
          step={idx('operations')}
          goto={goto}
          t={t}
          invalid={invalid('operations')}
          items={[
            [
              t('setup.operations.sessionTimeout'),
              data.operations.sessionTimeoutMin
                ? `${data.operations.sessionTimeoutMin} min`
                : t('setup.operations.never'),
            ],
            [
              t('setup.operations.confirmCritical').split('(')[0]!.trim(),
              yes(data.operations.confirmCritical),
            ],
            [
              t('setup.operations.failureRate'),
              `${data.operations.failureRateMultiplier}× · seed ${data.operations.seed}`,
            ],
            [
              t('setup.operations.startMode'),
              data.operations.startMode === 'cold'
                ? `${t('setup.operations.cold')} (${Math.round(data.operations.bootMinCapacity * 100)} %)`
                : t('setup.operations.warm'),
            ],
          ]}
        />
      </div>
      {m && (
        <section className="sh-derived">
          <span className="sf-label">{data.system.infraName}</span>
          <KeyValue
            items={[
              [
                t('setup.live.gpus'),
                `${fmt.formatNumber(m.counts.gpus)} · ${fmt.formatNumber(m.counts.nodes)} ${t('setup.profile.nodes')}`,
              ],
              [t('setup.live.bf16'), fmt.q(fmt.flops(m.compute.peakDense.bf16 * 1e15))],
              [t('setup.live.itPeak'), fmt.q(fmt.power(m.power.itPeakKW * 1000))],
              [t('setup.live.facility'), fmt.q(fmt.power(m.power.facilityPeakKW * 1000))],
              [t('setup.live.pue'), fmt.formatNumber(m.power.pueAnnual, 2, 2)],
              [t('setup.live.capex'), fmt.currency(m.cost.totalUsd, 'USD')],
            ]}
          />
        </section>
      )}
      {report.issues.length > 0 && (
        <section aria-label={t('setup.summary.issues')}>
          <span className="sf-label">
            {t('setup.summary.issues')} ·{' '}
            <span className="sh-issue-count" data-severity="error">
              {t('setup.live.errors', { n: report.errors })}
            </span>{' '}
            · {t('setup.live.warnings', { n: report.warnings })}
          </span>
          <IssueList issues={report.issues} t={t} goto={goto} limit={20} current={idx('summary')} />
        </section>
      )}
    </div>
  );
}

// ---- 13 Initialisation -----------------------------------------------------------------------

const TASK_KEY: Record<SetupTask, MessageKey> = {
  settings: 'setup.init.settings',
  account: 'setup.init.account',
  infra: 'setup.init.infra',
  engine: 'setup.init.engine',
  handover: 'setup.init.handover',
};

export function InitializeStep({ data, t, onDone }: StepProps & { onDone: () => void }) {
  const [status, setStatus] = useState<Partial<Record<SetupTask, 'running' | 'done'>>>({});
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeSetup(data, (task, s) => setStatus((x) => ({ ...x, [task]: s })))
      .then(() => onDone())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [data, onDone]);
  const done = SETUP_TASKS.filter((k) => status[k] === 'done').length;
  return (
    <div className="sh-form" aria-live="polite">
      <Progress value={done / SETUP_TASKS.length} label={t('setup.step.initialize.title')} />
      <ul className="sh-tasks">
        {SETUP_TASKS.map((k) => (
          <li key={k} data-status={status[k] ?? 'pending'}>
            <span aria-hidden>
              {status[k] === 'done' ? (
                <Check size={13} strokeWidth={3} />
              ) : status[k] === 'running' ? (
                error ? (
                  <AlertTriangle size={13} />
                ) : (
                  <Loader2 size={13} className="sh-spin" />
                )
              ) : null}
            </span>
            {t(TASK_KEY[k])}
          </li>
        ))}
      </ul>
      {error && (
        <div className="sh-note" data-tone="critical" role="alert">
          <XCircle size={14} />
          <span>
            <strong>{t('setup.init.failed')}:</strong> <span className="mono">{error}</span>
          </span>
          <Button size="sm" onClick={() => location.reload()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
