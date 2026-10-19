/**
 * Sign-in and lock screen in the style of a desktop OS: the configured wallpaper, a large
 * clock, the administrator's user tile with a password field, cluster status and power
 * controls. Credentials are verified with PBKDF2; repeated failures impose a delay.
 */
import { ArrowRight, Loader2, Moon, Power, RotateCcw, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEngineStore } from '../../os/engine/store';
import { useT, type MessageKey } from '../../os/i18n';
import { authenticate, currentAccount, loginLockoutMs } from '../../os/kernel';
import { useSettingsStore } from '../../os/settings/store';
import type { ShellEvent } from '../../os/shell/machine';
import { StatusBadge, fmt } from '../../ui';
import { onlineNodes, useClusterLevel } from '../clusterStatus';
import { useDesktopStore } from '../desktop/store';
import { Wallpaper } from '../desktop/DesktopSurface';
import { SystemDialogs } from '../desktop/SystemDialogs';
import { useClock } from '../useClock';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 2)
    .join('') || '?';

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
  const [username, setUsername] = useState(mode === 'locked' ? (user ?? '') : (account?.username ?? ''));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [waitMs, setWaitMs] = useState(() => loginLockoutMs());
  const passwordRef = useRef<HTMLInputElement>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const askUser = !account;

  useEffect(() => {
    (askUser ? userRef : passwordRef).current?.focus();
  }, [askUser, mode]);

  useEffect(() => {
    if (waitMs <= 0) return;
    const id = setInterval(() => setWaitMs(loginLockoutMs()), 250);
    return () => clearInterval(id);
  }, [waitMs]);

  const submit = async () => {
    if (busy || waitMs > 0 || !password) return;
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
    setShake((n) => n + 1);
    passwordRef.current?.focus();
  };

  const displayName = account?.displayName || settings.system.operatorName || username;
  const { locale, timeZone, hourCycle } = settings.region;
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: hourCycle === 'h12',
  }).format(now);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  const statusKey: MessageKey =
    level === 'ok' ? 'ws.status.ok' : level === 'warning' ? 'ws.status.warning' : 'ws.status.critical';
  const setDialog = useDesktopStore((s) => s.setDialog);

  return (
    <main className="sh-login" data-mode={mode}>
      <Wallpaper />
      <div className="sh-login__veil" aria-hidden />
      <div className="sh-login__clock" aria-hidden>
        <div className="sh-login__date">{date}</div>
        <div className="sh-login__time num">{time}</div>
      </div>

      <form
        className="sh-login__user"
        data-shake={shake || undefined}
        key={shake}
        aria-labelledby="login-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="sh-login__avatar" aria-hidden>
          {initials(displayName)}
        </div>
        <h1 id="login-title" className="sh-login__name">
          {displayName}
        </h1>
        <p className="sh-login__role">
          {mode === 'locked'
            ? t('login.locked')
            : account
              ? `${account.username} · ${t(`role.${account.role}` as MessageKey)}`
              : t('login.title')}
        </p>
        {askUser && (
          <input
            ref={userRef}
            className="sh-login__field"
            aria-label={t('login.username')}
            placeholder={t('login.username')}
            value={username}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
        <div className="sh-login__pw">
          <input
            ref={passwordRef}
            className="sh-login__field"
            type="password"
            aria-label={t('login.password')}
            aria-invalid={error ? true : undefined}
            placeholder={t('login.enterPassword')}
            value={password}
            autoComplete="current-password"
            disabled={waitMs > 0}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
          />
          <button
            type="submit"
            className="sh-login__go"
            aria-label={mode === 'locked' ? t('login.unlock') : t('login.submit')}
            disabled={busy || waitMs > 0 || !password}
          >
            {busy ? <Loader2 size={15} className="sh-spin" /> : <ArrowRight size={15} />}
          </button>
        </div>
        <p className="sh-login__msg" role={error || waitMs > 0 ? 'alert' : undefined}>
          {waitMs > 0 ? (
            <>
              <ShieldAlert size={13} /> {t('login.wait', { s: Math.ceil(waitMs / 1000) })}
            </>
          ) : (
            (error ?? (busy ? t('login.verifying') : t('login.hint')))
          )}
        </p>
        {mode === 'locked' && (
          <button type="button" className="sh-login__switch" onClick={() => send({ type: 'LOGOUT' })}>
            {t('login.otherUser')}
          </button>
        )}
      </form>

      <footer className="sh-login__footer">
        <div className="sh-login__system">
          <span className="mono">{settings.system.hostname}</span>
          {topo && (
            <span>
              {topo.spec.name} · {topo.spec.site.name}
            </span>
          )}
          {snap && (
            <span className="sh-login__status">
              <StatusBadge tone={level === 'ok' ? 'good' : level} label={t(statusKey)} />
              <span>
                {t('login.statusLine', {
                  online: onlineNodes(snap),
                  total: snap.cluster.nodesTotal,
                  it: fmt.q(fmt.power(snap.facility.itPowerW)),
                  pue: fmt.formatNumber(snap.facility.pue, 2, 2),
                })}
              </span>
            </span>
          )}
        </div>
        <div className="sh-login__power" role="group" aria-label={t('login.power')}>
          <button type="button" onClick={() => useDesktopStore.getState().setSleeping(true)}>
            <Moon size={18} strokeWidth={1.6} />
            <span>{t('menu.sleep')}</span>
          </button>
          <button type="button" onClick={() => setDialog('restart')}>
            <RotateCcw size={18} strokeWidth={1.6} />
            <span>{t('login.restart')}</span>
          </button>
          <button type="button" onClick={() => setDialog('shutdown')}>
            <Power size={18} strokeWidth={1.6} />
            <span>{t('login.shutdown')}</span>
          </button>
        </div>
      </footer>
      <SystemDialogs />
    </main>
  );
}
