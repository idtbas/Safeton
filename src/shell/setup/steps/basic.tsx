/**
 * Setup steps 1–5: welcome, language & region, administrator, system & site, appearance.
 */
import {
  Activity,
  Cpu,
  HardDrive,
  Laptop,
  Moon,
  ShieldCheck,
  Sun,
  Thermometer,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { assessPassword, hashPassword, ROLES, type Role } from '../../../os/auth/credentials';
import type { MessageKey } from '../../../os/i18n';
import { ACCENTS, type AccentName, type Settings } from '../../../os/settings/schema';
import {
  Badge,
  Button,
  ButtonGroup,
  CardSelect,
  Input,
  MetricTile,
  PasswordInput,
  Progress,
  Select,
  Slider,
  Toggle,
  fmt,
} from '../../../ui';
import { LOCALES } from '../locales';
import type { StepProps } from '../types';

// ---- 1 Welcome --------------------------------------------------------------------------------

const POINTS: [LucideIcon, MessageKey][] = [
  [Cpu, 'setup.welcome.point1'],
  [ShieldCheck, 'setup.welcome.point2'],
  [Activity, 'setup.welcome.point3'],
  [HardDrive, 'setup.welcome.point4'],
];

export function WelcomeStep({ t }: StepProps) {
  return (
    <div className="sh-welcome">
      <h2 className="sh-welcome__headline">{t('setup.welcome.headline')}</h2>
      <p className="sh-welcome__lead">{t('setup.welcome.lead')}</p>
      <ul className="sh-welcome__points">
        {POINTS.map(([Icon, key]) => (
          <li key={key}>
            <Icon size={16} aria-hidden />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      <div className="sh-row">
        <Badge tone="accent">{t('setup.welcome.duration')}</Badge>
        <span className="sf-muted">{t('common.simulationNotice')}</span>
      </div>
    </div>
  );
}

// ---- 2 Language & region -----------------------------------------------------------------------

function timeZones(current: string): string[] {
  let list: string[];
  try {
    list =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ??
      [];
  } catch {
    list = [];
  }
  if (list.length === 0)
    list = ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Singapore'];
  if (!list.includes('UTC')) list = ['UTC', ...list];
  return list.includes(current) ? list : [current, ...list];
}

export function RegionStep({ data, update, t, err }: StepProps) {
  const r = data.region;
  const zones = useMemo(() => timeZones(r.timeZone), [r.timeZone]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const set = (patch: Partial<Settings['region']>) =>
    update((d) => ({ ...d, region: { ...d.region, ...patch } }));
  let preview: string[];
  try {
    const dt = new Intl.DateTimeFormat(r.locale, {
      timeZone: r.timeZone,
      dateStyle: 'full',
      timeStyle: 'medium',
      hour12: r.hourCycle === 'h12',
    }).format(now);
    const num = new Intl.NumberFormat(r.locale, { maximumFractionDigits: 2 }).format(1234567.89);
    const temp = r.temperatureUnit === 'F' ? `${((24.5 * 9) / 5 + 32).toFixed(1)} °F` : '24.5 °C';
    preview = [dt, num, temp.replace('.', r.locale.startsWith('de') ? ',' : '.')];
  } catch {
    preview = ['—'];
  }
  return (
    <div className="sh-form">
      <div className="sh-grid2">
        <Select
          label={t('setup.region.language')}
          value={r.locale}
          options={LOCALES}
          onChange={(locale) =>
            set({
              locale,
              hourCycle: locale === 'en-US' ? 'h12' : 'h23',
              temperatureUnit: locale === 'en-US' ? 'F' : 'C',
            })
          }
        />
        <div className="sf-field">
          <Select
            label={t('setup.region.timeZone')}
            value={r.timeZone}
            options={zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))}
            onChange={(timeZone) => set({ timeZone })}
          />
          {err('region.timeZone') && (
            <span className="sf-field__error" role="alert">
              {err('region.timeZone')}
            </span>
          )}
        </div>
      </div>
      <div className="sh-grid2">
        <div className="sf-field">
          <span className="sf-label" id="tu-label">
            {t('setup.region.temperature')}
          </span>
          <ButtonGroup label={t('setup.region.temperature')}>
            {(['C', 'F'] as const).map((u) => (
              <Button key={u} pressed={r.temperatureUnit === u} onClick={() => set({ temperatureUnit: u })}>
                °{u}
              </Button>
            ))}
          </ButtonGroup>
        </div>
        <div className="sf-field">
          <span className="sf-label">{t('setup.region.hourCycle')}</span>
          <ButtonGroup label={t('setup.region.hourCycle')}>
            {(['h23', 'h12'] as const).map((h) => (
              <Button key={h} pressed={r.hourCycle === h} onClick={() => set({ hourCycle: h })}>
                {t(h === 'h23' ? 'setup.region.h23' : 'setup.region.h12')}
              </Button>
            ))}
          </ButtonGroup>
        </div>
      </div>
      <section className="sh-preview-box" aria-label={t('setup.region.preview')}>
        <span className="sf-label">{t('setup.region.preview')}</span>
        {preview.map((p) => (
          <div key={p} className="mono">
            {p}
          </div>
        ))}
      </section>
    </div>
  );
}

// ---- 3 Administrator ---------------------------------------------------------------------------

const suggestUsername = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^[^a-z_]+|\.+$/g, '')
    .slice(0, 32);

export function AdminStep({ data, update, t, err, setBeforeNext }: StepProps) {
  const a = data.admin;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(a.username !== '');
  const [localError, setLocalError] = useState<{ password?: string; confirm?: string }>({});
  const assessment = useMemo(() => assessPassword(password, a.username), [password, a.username]);
  const set = (patch: Partial<typeof a>) => update((d) => ({ ...d, admin: { ...d.admin, ...patch } }));

  useEffect(() => {
    setBeforeNext(async () => {
      if (!password && !confirm) return true; // reducer validation reports a missing credential
      if (assessment.problems.length > 0) {
        setLocalError({ password: t('validation.passwordWeak') });
        return false;
      }
      if (password !== confirm) {
        setLocalError({ confirm: t('validation.passwordMismatch') });
        return false;
      }
      setLocalError({});
      const credential = await hashPassword(password);
      update((d) => ({ ...d, admin: { ...d.admin, credential } }));
      setPassword('');
      setConfirm('');
      return true;
    });
    return () => setBeforeNext(null);
  }, [password, confirm, assessment, setBeforeNext, update, t]);

  const strengthLabel = password ? t(`setup.admin.strength${assessment.score}` as MessageKey) : '';
  return (
    <div className="sh-form">
      <div className="sh-grid2">
        <Input
          label={t('setup.admin.displayName')}
          value={a.displayName}
          autoComplete="name"
          error={err('admin.displayName')}
          onChange={(e) => {
            const displayName = e.target.value;
            set(usernameTouched ? { displayName } : { displayName, username: suggestUsername(displayName) });
          }}
        />
        <Input
          label={t('setup.admin.username')}
          value={a.username}
          mono
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          error={err('admin.username')}
          onChange={(e) => {
            setUsernameTouched(true);
            set({ username: e.target.value.toLowerCase() });
          }}
        />
      </div>
      <div className="sf-field">
        <span className="sf-label">{t('setup.admin.role')}</span>
        <CardSelect
          label={t('setup.admin.role')}
          value={a.role}
          size="sm"
          columns={180}
          onChange={(role: Role) => set({ role })}
          options={ROLES.map((r) => ({
            value: r,
            title: t(`role.${r}` as MessageKey),
            description: t(`role.${r}.desc` as MessageKey),
          }))}
        />
      </div>
      <div className="sh-grid2">
        <PasswordInput
          label={t('setup.admin.password')}
          value={password}
          autoComplete="new-password"
          showLabel={t('ui.password.show')}
          hideLabel={t('ui.password.hide')}
          error={localError.password ?? (!password && !a.credential ? err('admin.password') : undefined)}
          hint={t('setup.admin.policy')}
          strength={password ? { score: assessment.score, label: strengthLabel } : null}
          onChange={(e) => {
            setPassword(e.target.value);
            setLocalError({});
          }}
        />
        <PasswordInput
          label={t('setup.admin.passwordConfirm')}
          value={confirm}
          autoComplete="new-password"
          showLabel={t('ui.password.show')}
          hideLabel={t('ui.password.hide')}
          error={localError.confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setLocalError({});
          }}
        />
      </div>
      {password && assessment.problems.length > 0 && (
        <ul className="sh-problems" aria-live="polite">
          {assessment.problems.map((p) => (
            <li key={p}>{t(`setup.admin.problem.${p}` as MessageKey)}</li>
          ))}
        </ul>
      )}
      {a.credential && !password && (
        <p className="sh-note" data-tone="good">
          <ShieldCheck size={14} aria-hidden /> {t('setup.admin.credentialSet')}
        </p>
      )}
      <p className="sh-note">{t('setup.admin.localOnly')}</p>
    </div>
  );
}

// ---- 4 System & site ---------------------------------------------------------------------------

export function SystemStep({ data, update, t, err }: StepProps) {
  const s = data.system;
  const set = (patch: Partial<typeof s>) => update((d) => ({ ...d, system: { ...d.system, ...patch } }));
  return (
    <div className="sh-form">
      <Input
        label={t('setup.system.hostname')}
        value={s.hostname}
        mono
        spellCheck={false}
        autoCapitalize="off"
        hint={t('setup.system.hostnameHint')}
        error={err('system.hostname')}
        onChange={(e) => set({ hostname: e.target.value.toLowerCase().trim() })}
      />
      <div className="sh-grid2">
        <Input
          label={t('setup.system.siteName')}
          value={s.siteName}
          error={err('system.siteName')}
          onChange={(e) => set({ siteName: e.target.value })}
        />
        <Input
          label={t('setup.system.siteCode')}
          value={s.siteCode}
          mono
          hint={t('setup.system.siteCodeHint')}
          error={err('system.siteCode')}
          onChange={(e) => set({ siteCode: e.target.value.toUpperCase().replace(/\s/g, '') })}
        />
      </div>
      <Input
        label={t('setup.system.infraName')}
        value={s.infraName}
        error={err('system.infraName')}
        onChange={(e) => set({ infraName: e.target.value })}
      />
    </div>
  );
}

// ---- 5 Appearance ------------------------------------------------------------------------------

export function AppearanceStep({ data, update, t }: StepProps) {
  const a = data.appearance;
  const set = (patch: Partial<Settings['appearance']>) =>
    update((d) => ({ ...d, appearance: { ...d.appearance, ...patch } }));
  return (
    <div className="sh-split">
      <div className="sh-form">
        <div className="sf-field">
          <span className="sf-label">{t('setup.appearance.theme')}</span>
          <CardSelect
            label={t('setup.appearance.theme')}
            value={a.theme}
            size="sm"
            columns={120}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'dark', title: t('setup.appearance.dark'), icon: <Moon size={14} /> },
              { value: 'light', title: t('setup.appearance.light'), icon: <Sun size={14} /> },
              { value: 'system', title: t('setup.appearance.system'), icon: <Laptop size={14} /> },
            ]}
          />
        </div>
        <div className="sf-field">
          <span className="sf-label">{t('setup.appearance.accent')}</span>
          <CardSelect
            label={t('setup.appearance.accent')}
            value={a.accent}
            size="sm"
            columns={110}
            onChange={(accent: AccentName) => set({ accent })}
            options={(Object.keys(ACCENTS) as AccentName[]).map((k) => ({
              value: k,
              title: ACCENTS[k].label,
              icon: (
                <span
                  className="sh-swatch"
                  style={{
                    background: `oklch(0.7 ${k === 'graphite' ? 0.03 : 0.13} ${ACCENTS[k].hue})`,
                  }}
                />
              ),
            }))}
          />
        </div>
        <div className="sh-grid2">
          <div className="sf-field">
            <span className="sf-label">{t('setup.appearance.density')}</span>
            <ButtonGroup label={t('setup.appearance.density')}>
              {(['compact', 'comfortable'] as const).map((d) => (
                <Button key={d} pressed={a.density === d} onClick={() => set({ density: d })}>
                  {t(d === 'compact' ? 'setup.appearance.compact' : 'setup.appearance.comfortable')}
                </Button>
              ))}
            </ButtonGroup>
          </div>
          <Select
            label={t('setup.appearance.motion')}
            value={a.reducedMotion}
            onChange={(reducedMotion) => set({ reducedMotion })}
            options={[
              { value: 'system', label: t('setup.appearance.motionSystem') },
              { value: 'off', label: t('setup.appearance.motionOff') },
              { value: 'on', label: t('setup.appearance.motionOn') },
            ]}
          />
        </div>
        <div className="sf-field">
          <span className="sf-label">{t('setup.appearance.fontScale')}</span>
          <Slider
            label={t('setup.appearance.fontScale')}
            value={a.fontScale}
            min={0.85}
            max={1.25}
            step={0.05}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(fontScale) => set({ fontScale: Math.round(fontScale * 100) / 100 })}
          />
        </div>
      </div>
      <section className="sh-appearance-preview" aria-label={t('setup.appearance.preview')}>
        <span className="sf-label">{t('setup.appearance.preview')}</span>
        <div className="sh-mini-window" inert>
          <div className="sh-mini-window__bar">
            <span />
            <span />
            <span />
            <strong>{data.system.hostname}</strong>
          </div>
          <div className="sh-mini-window__body">
            <div className="sh-grid2">
              <MetricTile label="GPU util" value="87.4" unit="%" />
              <MetricTile label="IT load" value={fmt.formatNumber(412.6, 1, 1)} unit="kW" />
            </div>
            <Progress value={0.62} label="Training progress" />
            <div className="sh-row">
              <Badge tone="good">Online</Badge>
              <Badge tone="warning">
                <Thermometer size={11} /> 84 °C
              </Badge>
              <Badge tone="accent">
                <Workflow size={11} /> NDR
              </Badge>
            </div>
            <div className="sh-row">
              <Button variant="primary" size="sm">
                {t('common.continue')}
              </Button>
              <Button size="sm">{t('common.cancel')}</Button>
              <Toggle checked label="Auto" onChange={() => undefined} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
