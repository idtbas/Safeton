/**
 * System settings. Every control writes through the validated settings store (persisted by the
 * kernel) or the kernel API, so changes take effect immediately across the whole system.
 */
import {
  Bell,
  Cpu,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  Laptop,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  ThermometerSun,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TEMPLATES } from '../../engine';
import type { AppWindowProps } from '../../os/apps/registry';
import { assessPassword } from '../../os/auth/credentials';
import { useT, type MessageKey } from '../../os/i18n';
import { changePassword, currentAccount, setTimeScale, updateDisplayName } from '../../os/kernel';
import {
  ACCENTS,
  DEFAULT_DOCK,
  WALLPAPERS,
  type AccentName,
  type SettingsPatch,
} from '../../os/settings/schema';
import { useSettingsStore } from '../../os/settings/store';
import { HOSTNAME_RE } from '../../os/setup/model';
import {
  Button,
  ButtonGroup,
  CardSelect,
  Input,
  NumberInput,
  PasswordInput,
  Select,
  Slider,
  Toggle,
} from '../../ui';
import { AppBody, AppFrame, AppSidebar, AppSplit } from '../common/AppLayout';
import { BackupSection } from './BackupSection';
import { SETTINGS_SECTIONS, type SectionId } from './sections';
import { SystemInfo } from './SystemInfo';

const ICONS: Record<SectionId, ReactNode> = {
  account: <UserRound size={15} />,
  appearance: <Palette size={15} />,
  desktop: <Monitor size={15} />,
  region: <Globe size={15} />,
  notifications: <Bell size={15} />,
  monitoring: <ThermometerSun size={15} />,
  security: <ShieldCheck size={15} />,
  simulation: <Cpu size={15} />,
  backup: <HardDrive size={15} />,
  about: <Info size={15} />,
};

// ---- Layout primitives -------------------------------------------------------------------------

function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="st-group">
      {title && <h3 className="st-group__title">{title}</h3>}
      <div className="st-group__box">{children}</div>
      {footer && <p className="st-group__footer">{footer}</p>}
    </section>
  );
}

function Row({
  label,
  description,
  children,
  error,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  error?: string | null;
}) {
  return (
    <div className="st-row">
      <div className="st-row__text">
        <div className="st-row__label">{label}</div>
        {description && <div className="st-row__desc">{description}</div>}
        {error && (
          <div className="st-row__error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="st-row__control">{children}</div>
    </div>
  );
}

function useSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [error, setError] = useState<string | null>(null);
  const apply = (patch: SettingsPatch) => setError(update(patch));
  return { settings, apply, error };
}

const num = (t: ReturnType<typeof useT>) => ({
  increaseLabel: t('ui.number.increase'),
  decreaseLabel: t('ui.number.decrease'),
});

// ---- Sections ------------------------------------------------------------------------------------

function AccountSection() {
  const t = useT();
  const { settings, apply } = useSettings();
  const account = currentAccount();
  const [name, setName] = useState(account?.displayName ?? settings.system.operatorName);
  const [hostname, setHostname] = useState(settings.system.hostname);
  const hostOk = HOSTNAME_RE.test(hostname);
  return (
    <>
      <div className="st-profile">
        <span className="st-profile__avatar">
          {(account?.displayName ?? '?')
            .split(/\s+/)
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </span>
        <div>
          <div className="st-profile__name">{account?.displayName}</div>
          <div className="sf-muted">
            {account?.username} · {account ? t(`role.${account.role}` as MessageKey) : ''}
          </div>
        </div>
      </div>
      <Group title={t('settings.account.profile')}>
        <Row label={t('setup.admin.displayName')}>
          <div className="st-inline">
            <Input
              aria-label={t('setup.admin.displayName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!name.trim() || name === account?.displayName}
              onClick={() => void updateDisplayName(name.trim())}
            >
              {t('settings.apply')}
            </Button>
          </div>
        </Row>
        <Row label={t('setup.admin.username')} description={t('settings.account.usernameFixed')}>
          <span className="mono">{account?.username}</span>
        </Row>
        <Row label={t('settings.account.created')}>
          <span>{account ? new Date(account.createdAt).toLocaleString(settings.region.locale) : '—'}</span>
        </Row>
      </Group>
      <Group title={t('settings.account.system')}>
        <Row
          label={t('setup.system.hostname')}
          description={t('setup.system.hostnameHint')}
          error={hostOk ? null : t('validation.hostname')}
        >
          <div className="st-inline">
            <Input
              aria-label={t('setup.system.hostname')}
              mono
              value={hostname}
              onChange={(e) => setHostname(e.target.value.toLowerCase().trim())}
            />
            <Button
              size="sm"
              disabled={!hostOk || hostname === settings.system.hostname}
              onClick={() => apply({ system: { hostname } })}
            >
              {t('settings.apply')}
            </Button>
          </div>
        </Row>
      </Group>
    </>
  );
}

function AppearanceSection() {
  const t = useT();
  const { settings, apply } = useSettings();
  const a = settings.appearance;
  return (
    <>
      <Group title={t('setup.appearance.theme')}>
        <div className="st-pad">
          <CardSelect
            label={t('setup.appearance.theme')}
            value={a.theme}
            size="sm"
            columns={130}
            onChange={(theme) => apply({ appearance: { theme } })}
            options={[
              { value: 'dark', title: t('setup.appearance.dark'), icon: <Moon size={14} /> },
              { value: 'light', title: t('setup.appearance.light'), icon: <Sun size={14} /> },
              { value: 'system', title: t('setup.appearance.system'), icon: <Laptop size={14} /> },
            ]}
          />
        </div>
      </Group>
      <Group title={t('setup.appearance.accent')}>
        <div className="st-pad">
          <div className="st-swatches" role="radiogroup" aria-label={t('setup.appearance.accent')}>
            {(Object.keys(ACCENTS) as AccentName[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={a.accent === k}
                aria-label={ACCENTS[k].label}
                title={ACCENTS[k].label}
                className="st-swatch"
                style={{
                  ['--sw' as string]: `oklch(0.7 ${k === 'graphite' ? 0.03 : 0.13} ${ACCENTS[k].hue})`,
                }}
                onClick={() => apply({ appearance: { accent: k } })}
              />
            ))}
          </div>
        </div>
      </Group>
      <Group>
        <Row label={t('setup.appearance.density')}>
          <ButtonGroup label={t('setup.appearance.density')}>
            {(['compact', 'comfortable'] as const).map((d) => (
              <Button
                key={d}
                size="sm"
                pressed={a.density === d}
                onClick={() => apply({ appearance: { density: d } })}
              >
                {t(d === 'compact' ? 'setup.appearance.compact' : 'setup.appearance.comfortable')}
              </Button>
            ))}
          </ButtonGroup>
        </Row>
        <Row label={t('setup.appearance.fontScale')}>
          <div style={{ width: 240 }}>
            <Slider
              label={t('setup.appearance.fontScale')}
              value={a.fontScale}
              min={0.85}
              max={1.25}
              step={0.05}
              format={(v) => `${Math.round(v * 100)} %`}
              onChange={(v) => apply({ appearance: { fontScale: Math.round(v * 100) / 100 } })}
            />
          </div>
        </Row>
        <Row label={t('setup.appearance.motion')}>
          <div style={{ width: 200 }}>
            <Select
              aria-label={t('setup.appearance.motion')}
              value={a.reducedMotion}
              onChange={(reducedMotion) => apply({ appearance: { reducedMotion } })}
              options={[
                { value: 'system', label: t('setup.appearance.motionSystem') },
                { value: 'off', label: t('setup.appearance.motionOff') },
                { value: 'on', label: t('setup.appearance.motionOn') },
              ]}
            />
          </div>
        </Row>
        <Row label={t('settings.windows.animate')}>
          <Toggle
            checked={settings.windows.animate}
            onChange={(v) => apply({ windows: { animate: v } })}
            label={undefined}
          />
        </Row>
      </Group>
    </>
  );
}

function DesktopSection() {
  const t = useT();
  const { settings, apply } = useSettings();
  const d = settings.desktop;
  return (
    <>
      <Group title={t('settings.desktop.wallpaper')}>
        <div className="st-pad">
          <div className="st-wallpapers" role="radiogroup" aria-label={t('settings.desktop.wallpaper')}>
            {WALLPAPERS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={d.wallpaper === w}
                className="st-wallpaper"
                onClick={() => apply({ desktop: { wallpaper: w } })}
              >
                <span className="os-wallpaper st-wallpaper__preview" data-wallpaper={w} />
                <span>{t(`wallpaper.${w}` as MessageKey)}</span>
              </button>
            ))}
          </div>
        </div>
      </Group>
      <Group title={t('settings.desktop.layout')}>
        <Row label={t('settings.desktop.icons')}>
          <Toggle checked={d.showIcons} onChange={(v) => apply({ desktop: { showIcons: v } })} />
        </Row>
        <Row label={t('settings.desktop.widget')} description={t('settings.desktop.widgetDesc')}>
          <Toggle checked={d.showWidget} onChange={(v) => apply({ desktop: { showWidget: v } })} />
        </Row>
        <Row label={t('settings.desktop.magnify')}>
          <Toggle checked={d.dockMagnify} onChange={(v) => apply({ desktop: { dockMagnify: v } })} />
        </Row>
        <Row label={t('settings.desktop.clockSeconds')}>
          <Toggle checked={d.clockSeconds} onChange={(v) => apply({ desktop: { clockSeconds: v } })} />
        </Row>
        <Row
          label={t('settings.desktop.dock')}
          description={t('settings.desktop.dockDesc', { n: d.dockApps.length })}
        >
          <Button
            size="sm"
            disabled={d.dockApps.join() === DEFAULT_DOCK.join()}
            onClick={() => apply({ desktop: { dockApps: [...DEFAULT_DOCK] } })}
          >
            {t('settings.reset')}
          </Button>
        </Row>
      </Group>
      <Group title={t('settings.windows')}>
        <Row label={t('settings.windows.snap')} description={t('settings.windows.snapDesc')}>
          <Toggle
            checked={settings.windows.snapToEdges}
            onChange={(v) => apply({ windows: { snapToEdges: v } })}
          />
        </Row>
      </Group>
    </>
  );
}

function timeZones(current: string): string[] {
  let list: string[];
  try {
    list =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ??
      [];
  } catch {
    list = [];
  }
  if (!list.includes('UTC')) list = ['UTC', ...list];
  return list.includes(current) ? list : [current, ...list];
}

function RegionSection() {
  const t = useT();
  const { settings, apply, error } = useSettings();
  const r = settings.region;
  const zones = useMemo(() => timeZones(r.timeZone), [r.timeZone]);
  return (
    <Group>
      <Row label={t('setup.region.language')} error={error}>
        <div style={{ width: 240 }}>
          <Select
            aria-label={t('setup.region.language')}
            value={r.locale}
            onChange={(locale) => apply({ region: { locale } })}
            options={[
              { value: 'de-DE', label: 'Deutsch (Deutschland)' },
              { value: 'en-US', label: 'English (United States)' },
              { value: 'en-GB', label: 'English (United Kingdom)' },
            ]}
          />
        </div>
      </Row>
      <Row label={t('setup.region.timeZone')}>
        <div style={{ width: 240 }}>
          <Select
            aria-label={t('setup.region.timeZone')}
            value={r.timeZone}
            onChange={(timeZone) => apply({ region: { timeZone } })}
            options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
          />
        </div>
      </Row>
      <Row label={t('setup.region.temperature')}>
        <ButtonGroup label={t('setup.region.temperature')}>
          {(['C', 'F'] as const).map((u) => (
            <Button
              key={u}
              size="sm"
              pressed={r.temperatureUnit === u}
              onClick={() => apply({ region: { temperatureUnit: u } })}
            >
              °{u}
            </Button>
          ))}
        </ButtonGroup>
      </Row>
      <Row label={t('setup.region.hourCycle')}>
        <ButtonGroup label={t('setup.region.hourCycle')}>
          {(['h23', 'h12'] as const).map((h) => (
            <Button
              key={h}
              size="sm"
              pressed={r.hourCycle === h}
              onClick={() => apply({ region: { hourCycle: h } })}
            >
              {t(h === 'h23' ? 'setup.region.h23' : 'setup.region.h12')}
            </Button>
          ))}
        </ButtonGroup>
      </Row>
    </Group>
  );
}

function NotificationsSection() {
  const t = useT();
  const { settings, apply } = useSettings();
  const n = settings.notifications;
  return (
    <Group footer={t('settings.notifications.footer')}>
      <Row label={t('setup.monitoring.minSeverity')}>
        <div style={{ width: 180 }}>
          <Select
            aria-label={t('setup.monitoring.minSeverity')}
            value={n.minSeverity}
            onChange={(minSeverity) => apply({ notifications: { minSeverity } })}
            options={(['notice', 'warning', 'error', 'critical'] as const).map((s) => ({
              value: s,
              label: t(`severity.${s}` as MessageKey),
            }))}
          />
        </div>
      </Row>
      <Row label={t('setup.monitoring.toasts')}>
        <Toggle checked={n.toasts} onChange={(toasts) => apply({ notifications: { toasts } })} />
      </Row>
      <Row label={t('settings.notifications.dnd')} description={t('settings.notifications.dndDesc')}>
        <Toggle
          checked={n.doNotDisturb}
          onChange={(doNotDisturb) => apply({ notifications: { doNotDisturb } })}
        />
      </Row>
    </Group>
  );
}

function MonitoringSection() {
  const t = useT();
  const { settings, apply, error } = useSettings();
  const m = settings.monitoring;
  return (
    <>
      <Group title={t('setup.monitoring.thresholds')} footer={error ?? undefined}>
        <Row label={t('setup.monitoring.gpuWarn')}>
          <NumberInput
            value={m.gpuTempWarnC}
            min={50}
            max={110}
            unit="°C"
            width={150}
            onChange={(v) => apply({ monitoring: { gpuTempWarnC: v } })}
            {...num(t)}
          />
        </Row>
        <Row
          label={t('setup.monitoring.gpuCrit')}
          error={m.gpuTempCritC <= m.gpuTempWarnC ? t('validation.critAboveWarn') : null}
        >
          <NumberInput
            value={m.gpuTempCritC}
            min={50}
            max={120}
            unit="°C"
            width={150}
            onChange={(v) => apply({ monitoring: { gpuTempCritC: v } })}
            {...num(t)}
          />
        </Row>
        <Row label={t('setup.monitoring.hallSupply')}>
          <NumberInput
            value={m.hallSupplyWarnC}
            min={15}
            max={40}
            step={0.5}
            unit="°C"
            width={150}
            onChange={(v) => apply({ monitoring: { hallSupplyWarnC: v } })}
            {...num(t)}
          />
        </Row>
        <Row label={t('setup.monitoring.pue')}>
          <NumberInput
            value={m.pueWarn}
            min={1}
            max={3}
            step={0.05}
            width={150}
            onChange={(v) => apply({ monitoring: { pueWarn: v } })}
            {...num(t)}
          />
        </Row>
      </Group>
      <Group title={t('setup.monitoring.telemetry')}>
        <Row label={t('setup.monitoring.snapshotHz')}>
          <NumberInput
            value={settings.simulation.snapshotHz}
            min={1}
            max={20}
            unit="Hz"
            width={150}
            onChange={(v) => apply({ simulation: { snapshotHz: v } })}
            {...num(t)}
          />
        </Row>
        <Row label={t('setup.monitoring.telemetryInterval')} description={t('settings.nextCommissioning')}>
          <NumberInput
            value={settings.simulation.telemetryIntervalS}
            min={1}
            max={60}
            unit="s"
            width={150}
            onChange={(v) => apply({ simulation: { telemetryIntervalS: v } })}
            {...num(t)}
          />
        </Row>
      </Group>
    </>
  );
}

function SecuritySection() {
  const t = useT();
  const { settings, apply } = useSettings();
  const s = settings.security;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<{ tone: 'good' | 'critical'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const account = currentAccount();
  const assessment = assessPassword(next, account?.username ?? '');

  const submit = async () => {
    if (next !== confirm) return setStatus({ tone: 'critical', text: t('validation.passwordMismatch') });
    setBusy(true);
    try {
      const res = await changePassword(current, next);
      if (res.ok) {
        setStatus({ tone: 'good', text: t('settings.security.changed') });
        setCurrent('');
        setNext('');
        setConfirm('');
      } else
        setStatus({
          tone: 'critical',
          text:
            res.reason === 'policy'
              ? t('validation.passwordWeak')
              : res.reason === 'lockout'
                ? t('login.wait', { s: Math.ceil((res.waitMs ?? 0) / 1000) })
                : t('settings.security.wrongCurrent'),
        });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Group title={t('setup.operations.session')}>
        <Row label={t('setup.operations.sessionTimeout')}>
          <div style={{ width: 160 }}>
            <Select
              aria-label={t('setup.operations.sessionTimeout')}
              value={String(s.sessionTimeoutMin)}
              onChange={(v) => apply({ security: { sessionTimeoutMin: Number(v) } })}
              options={[0, 5, 15, 30, 60, 120, 240].map((m) => ({
                value: String(m),
                label: m === 0 ? t('setup.operations.never') : `${m} min`,
              }))}
            />
          </div>
        </Row>
        <Row label={t('setup.operations.lockScreen')}>
          <Toggle checked={s.lockScreen} onChange={(lockScreen) => apply({ security: { lockScreen } })} />
        </Row>
        <Row label={t('setup.operations.confirmCritical')}>
          <Toggle
            checked={s.confirmCritical}
            onChange={(confirmCritical) => apply({ security: { confirmCritical } })}
          />
        </Row>
      </Group>
      <Group title={t('settings.security.password')} footer={t('setup.admin.localOnly')}>
        <form
          className="st-pad st-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <PasswordInput
            label={t('settings.security.current')}
            value={current}
            autoComplete="current-password"
            showLabel={t('ui.password.show')}
            hideLabel={t('ui.password.hide')}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <PasswordInput
            label={t('settings.security.new')}
            value={next}
            autoComplete="new-password"
            hint={t('setup.admin.policy')}
            showLabel={t('ui.password.show')}
            hideLabel={t('ui.password.hide')}
            strength={
              next
                ? {
                    score: assessment.score,
                    label: t(`setup.admin.strength${assessment.score}` as MessageKey),
                  }
                : null
            }
            onChange={(e) => setNext(e.target.value)}
          />
          <PasswordInput
            label={t('setup.admin.passwordConfirm')}
            value={confirm}
            autoComplete="new-password"
            showLabel={t('ui.password.show')}
            hideLabel={t('ui.password.hide')}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="st-inline">
            <Button
              type="submit"
              variant="primary"
              icon={<KeyRound size={14} />}
              loading={busy}
              disabled={!current || !next || !confirm}
            >
              {t('settings.security.change')}
            </Button>
            {status && (
              <span role="status" className="st-status" data-tone={status.tone}>
                {status.text}
              </span>
            )}
          </div>
        </form>
      </Group>
    </>
  );
}

function SimulationSection() {
  const t = useT();
  const { settings, apply } = useSettings();
  const s = settings.simulation;
  return (
    <>
      <Group title={t('settings.simulation.runtime')}>
        <Row label={t('setup.operations.timeScale')}>
          <ButtonGroup label={t('setup.operations.timeScale')}>
            {[1, 10, 60, 300, 1800].map((x) => (
              <Button key={x} size="sm" pressed={s.timeScale === x} onClick={() => void setTimeScale(x)}>
                {x}×
              </Button>
            ))}
          </ButtonGroup>
        </Row>
        <Row label={t('setup.operations.failureRate')}>
          <div style={{ width: 200 }}>
            <Select
              aria-label={t('setup.operations.failureRate')}
              value={String(s.failureRateMultiplier)}
              onChange={(v) => apply({ simulation: { failureRateMultiplier: Number(v) } })}
              options={[0, 1, 10, 100, 1000].map((r) => ({
                value: String(r),
                label: t('sim.failures', { rate: r }),
              }))}
            />
          </div>
        </Row>
        <Row label={t('setup.operations.autoRemediation')}>
          <Toggle
            checked={s.autoRemediation}
            onChange={(autoRemediation) => apply({ simulation: { autoRemediation } })}
          />
        </Row>
        <Row label={t('settings.simulation.autosave')}>
          <NumberInput
            value={s.autoSaveIntervalS}
            min={5}
            max={600}
            step={5}
            unit="s"
            width={150}
            onChange={(v) => apply({ simulation: { autoSaveIntervalS: v } })}
            {...num(t)}
          />
        </Row>
      </Group>
      <Group title={t('settings.simulation.start')} footer={t('settings.nextCommissioning')}>
        <Row label={t('settings.simulation.startRunning')}>
          <Toggle
            checked={s.startRunning}
            onChange={(startRunning) => apply({ simulation: { startRunning } })}
          />
        </Row>
        <Row label={t('setup.operations.startMode')}>
          <ButtonGroup label={t('setup.operations.startMode')}>
            {(['warm', 'cold'] as const).map((m) => (
              <Button
                key={m}
                size="sm"
                pressed={s.startMode === m}
                onClick={() => apply({ simulation: { startMode: m } })}
              >
                {t(`setup.operations.${m}` as MessageKey)}
              </Button>
            ))}
          </ButtonGroup>
        </Row>
        <Row label={t('setup.operations.bootMinCapacity')}>
          <div style={{ width: 220 }}>
            <Slider
              label={t('setup.operations.bootMinCapacity')}
              value={s.bootMinCapacity}
              min={0.5}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)} %`}
              onChange={(v) => apply({ simulation: { bootMinCapacity: Math.round(v * 100) / 100 } })}
            />
          </div>
        </Row>
        <Row label={t('setup.operations.seed')}>
          <NumberInput
            value={s.seed}
            min={0}
            max={4_294_967_295}
            width={180}
            onChange={(seed) => apply({ simulation: { seed } })}
            {...num(t)}
          />
        </Row>
        <Row label={t('settings.simulation.template')}>
          <div style={{ width: 240 }}>
            <Select
              aria-label={t('settings.simulation.template')}
              value={s.defaultTemplate}
              onChange={(defaultTemplate) => apply({ simulation: { defaultTemplate } })}
              options={TEMPLATES.map((x) => ({ value: x.id, label: `${x.tier} — ${x.name}` }))}
            />
          </div>
        </Row>
      </Group>
    </>
  );
}

export function SettingsApp({ args }: AppWindowProps) {
  const t = useT();
  const requested = args?.section as SectionId | undefined;
  const [section, setSection] = useState<SectionId>(
    requested && SETTINGS_SECTIONS.includes(requested) ? requested : 'account',
  );
  const [filter, setFilter] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follows a launch request to another section
    if (requested && SETTINGS_SECTIONS.includes(requested)) setSection(requested);
  }, [requested, args]);

  const q = filter.trim().toLowerCase();
  const items = SETTINGS_SECTIONS.filter(
    (id) =>
      !q ||
      t(`settings.section.${id}` as MessageKey)
        .toLowerCase()
        .includes(q),
  ).map((id) => ({
    id,
    label: t(`settings.section.${id}` as MessageKey),
    icon: ICONS[id],
  }));

  const body: Record<SectionId, ReactNode> = {
    account: <AccountSection />,
    appearance: <AppearanceSection />,
    desktop: <DesktopSection />,
    region: <RegionSection />,
    notifications: <NotificationsSection />,
    monitoring: <MonitoringSection />,
    security: <SecuritySection />,
    simulation: <SimulationSection />,
    backup: <BackupSection />,
    about: <SystemInfo />,
  };

  return (
    <AppFrame>
      <AppSplit>
        <AppSidebar<SectionId>
          label={t('app.settings.title')}
          value={section}
          onChange={setSection}
          items={items}
          header={
            <div className="st-search">
              <Input
                aria-label={t('settings.search')}
                placeholder={t('settings.search')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          }
        />
        <AppBody className="st-body">
          <h2 className="st-title">{t(`settings.section.${section}` as MessageKey)}</h2>
          {body[section]}
        </AppBody>
      </AppSplit>
    </AppFrame>
  );
}
