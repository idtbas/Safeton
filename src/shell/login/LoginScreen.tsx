/**
 * Sign-in and lock screen. Credentials are verified with PBKDF2 against the stored
 * administrator; repeated failures impose an increasing delay before the next attempt.
 */
import { Lock, LogIn, LogOut, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEngineStore } from '../../os/engine/store';
import { useT } from '../../os/i18n';
import { authenticate, currentAccount, loginLockoutMs } from '../../os/kernel';
import { useSettingsStore } from '../../os/settings/store';
import type { ShellEvent } from '../../os/shell/machine';
import { Button, Input, PasswordInput, StatusBadge, fmt } from '../../ui';
import { BrandMark } from '../boot/BootScreen';
import { onlineNodes, useClusterLevel } from '../clusterStatus';
import { useClock } from '../useClock';

export function LoginScreen({
  mode,
  user,
  send,
}: {
  mode: 'login' | 'locked';
  user: string | null;
  send: (e: ShellEvent) => void;
}) {
  const t = useT();
  const now = useClock();
  const settings = useSettingsStore((s) => s.settings);
  const snap = useEngineStore((s) => s.snapshot);
  const topo = useEngineStore((s) => s.topology);
  const level = useClusterLevel();
  const account = currentAccount();
  const [username, setUsername] = useState(mode === 'locked' ? (user ?? '') : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitMs, setWaitMs] = useState(() => loginLockoutMs());
  const passwordRef = useRef<HTMLInputElement>(null);
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (mode === 'locked' ? passwordRef : userRef).current?.focus();
  }, [mode]);

  // Count down an active lock-out.
  useEffect(() => {
    if (waitMs <= 0) return;
    const id = setInterval(() => setWaitMs(loginLockoutMs()), 250);
    return () => clearInterval(id);
  }, [waitMs]);

  const submit = async () => {
    if (busy || waitMs > 0) return;
    setBusy(true);
    setError(null);
    const res = await authenticate(username, password);
    setBusy(false);
    if (res.ok) {
      setPassword('');
      send(
        mode === 'locked' ? { type: 'UNLOCKED' } : { type: 'AUTHENTICATED', username: res.account.username },
      );
      return;
    }
    setPassword('');
    setWaitMs(res.waitMs);
    setError(res.reason === 'lockout' ? null : t('login.failed'));
    passwordRef.current?.focus();
  };

  const displayName = account?.displayName || settings.system.operatorName || username;
  const waitS = Math.ceil(waitMs / 1000);
  const clockFmt = new Intl.DateTimeFormat(settings.region.locale, {
    timeZone: settings.region.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: settings.region.hourCycle === 'h12',
  });
  const dateFmt = new Intl.DateTimeFormat(settings.region.locale, {
    timeZone: settings.region.timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <main className="sh-login" data-mode={mode}>
      <div className="sh-login__clock" aria-hidden>
        <div className="sh-login__time">{clockFmt.format(now)}</div>
        <div className="sh-login__date">{dateFmt.format(now)}</div>
      </div>

      <form
        className="sh-login__card"
        aria-labelledby="login-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="sh-login__head">
          {mode === 'locked' ? (
            <Lock size={22} aria-hidden className="sh-login__icon" />
          ) : (
            <BrandMark size={32} />
          )}
          <div>
            <h1 id="login-title">{mode === 'locked' ? t('login.locked') : t('login.title')}</h1>
            <p className="sf-muted">
              {mode === 'locked'
                ? t('login.lockedBy', { name: displayName })
                : t('login.subtitle', { host: settings.system.hostname, site: topo?.spec.site.name ?? '' })}
            </p>
          </div>
        </div>
        {mode === 'login' && (
          <Input
            ref={userRef}
            label={t('login.username')}
            value={username}
            mono
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
        <PasswordInput
          ref={passwordRef}
          label={t('login.password')}
          value={password}
          autoComplete="current-password"
          showLabel={t('ui.password.show')}
          hideLabel={t('ui.password.hide')}
          error={error ?? undefined}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />
        {waitMs > 0 && (
          <p className="sh-note" data-tone="warning" role="alert">
            <ShieldAlert size={14} /> {t('login.wait', { s: waitS })}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={waitMs > 0 || !password || (mode === 'login' && !username)}
          icon={<LogIn size={14} />}
        >
          {busy ? t('login.verifying') : mode === 'locked' ? t('login.unlock') : t('login.submit')}
        </Button>
        {mode === 'locked' && (
          <Button variant="ghost" icon={<LogOut size={14} />} onClick={() => send({ type: 'LOGOUT' })}>
            {t('login.otherUser')}
          </Button>
        )}
        <p className="sf-muted sh-login__local">{t('login.local')}</p>
      </form>

      {snap && (
        <section className="sh-login__status" aria-label={t('login.cluster')}>
          <div className="sh-login__status-head">
            <span className="sf-label">{topo?.spec.name ?? t('login.cluster')}</span>
            <StatusBadge
              tone={level === 'ok' ? 'good' : level}
              label={t(
                level === 'ok'
                  ? 'ws.status.ok'
                  : level === 'warning'
                    ? 'ws.status.warning'
                    : 'ws.status.critical',
              )}
            />
          </div>
          <dl>
            <div>
              <dt>{t('login.nodesOnline')}</dt>
              <dd className="num">
                {onlineNodes(snap)} / {snap.cluster.nodesTotal}
              </dd>
            </div>
            <div>
              <dt>{t('login.gpus')}</dt>
              <dd className="num">
                {fmt.formatNumber(snap.cluster.gpusHealthy)} / {fmt.formatNumber(snap.cluster.gpusTotal)}
              </dd>
            </div>
            <div>
              <dt>{t('login.itLoad')}</dt>
              <dd className="num">{fmt.q(fmt.power(snap.facility.itPowerW))}</dd>
            </div>
            <div>
              <dt>{t('login.pue')}</dt>
              <dd className="num">{fmt.formatNumber(snap.facility.pue, 2, 2)}</dd>
            </div>
          </dl>
        </section>
      )}
    </main>
  );
}
