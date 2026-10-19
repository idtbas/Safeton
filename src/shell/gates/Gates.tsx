/**
 * Platform gates in front of the operating system:
 *  1. DeviceBlocked — phones, tablets in mobile mode and small screens are not supported.
 *  2. InstallGate — the console only starts as an installed application (standalone window).
 *  3. ViewportGuard — while running, a too-small window is covered with a resize prompt.
 */
import { Check, Download, Loader2, Monitor, MonitorSmartphone, RotateCw, Share, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useT, type MessageKey } from '../../os/i18n';
import {
  MIN_SCREEN,
  MIN_VIEWPORT,
  assessViewport,
  getInstallState,
  installPlatform,
  platformCapabilities,
  promptInstall,
  subscribeInstallState,
  type DeviceBlockReason,
} from '../../os/platform';
import { detectLocale } from '../../os/setup/model';
import { Button } from '../../ui';

/** Gates render before the system configuration is loaded: use the browser language. */
const useGateT = () => useT(detectLocale());

function GateFrame({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <main className="os-gate">
      <div className="os-gate__wallpaper" aria-hidden />
      <section className="os-gate__panel" aria-labelledby="gate-title">
        <div className="os-gate__icon">{icon}</div>
        <h1 id="gate-title">{title}</h1>
        {children}
      </section>
    </main>
  );
}

export function DeviceBlocked({ reason }: { reason: DeviceBlockReason }) {
  const t = useGateT();
  const body: Record<DeviceBlockReason, string> = {
    phone: t('gate.device.phone'),
    'tablet-mobile-mode': t('gate.device.tabletMobile'),
    'screen-too-small': t('gate.device.small', {
      w: screen.width,
      h: screen.height,
      minW: MIN_SCREEN.long,
      minH: MIN_SCREEN.short,
    }),
  };
  return (
    <GateFrame icon={<MonitorSmartphone size={34} strokeWidth={1.5} />} title={t('gate.device.title')}>
      <p className="os-gate__lead" data-reason={reason}>
        {body[reason]}
      </p>
      <p className="os-gate__note">{t('gate.device.supported')}</p>
    </GateFrame>
  );
}

const STEPS: Record<'chromium' | 'safari-mac' | 'ipados', MessageKey[]> = {
  chromium: ['gate.install.chromium.1', 'gate.install.chromium.2', 'gate.install.chromium.3'],
  'safari-mac': ['gate.install.safari.1', 'gate.install.safari.2', 'gate.install.safari.3'],
  ipados: ['gate.install.ipad.1', 'gate.install.ipad.2', 'gate.install.ipad.3'],
};

export function InstallGate({ onDevContinue }: { onDevContinue?: () => void }) {
  const t = useGateT();
  const install = useSyncExternalStore(subscribeInstallState, getInstallState, getInstallState);
  const [busy, setBusy] = useState(false);
  const platform = installPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0);
  const caps = platformCapabilities();
  const capLabel: Record<string, MessageKey> = {
    crypto: 'gate.req.crypto',
    storage: 'gate.req.storage',
    worker: 'gate.req.worker',
    secure: 'gate.req.secure',
  };
  const steps = platform === 'firefox' || platform === 'other' ? null : STEPS[platform];

  return (
    <GateFrame
      icon={<img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />}
      title={t('gate.install.title')}
    >
      <p className="os-gate__lead">{t('gate.install.lead')}</p>

      {install.installed ? (
        <p className="os-gate__done" role="status">
          <Check size={16} /> {t('gate.install.done')}
        </p>
      ) : steps ? (
        <ol className="os-gate__steps">
          {steps.map((k, i) => (
            <li key={k}>
              <span className="os-gate__step-no">{i + 1}</span>
              <span>{t(k)}</span>
              {platform === 'ipados' && i === 0 && (
                <Share size={14} className="os-gate__inline-icon" aria-hidden />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="os-gate__note">
          {t(platform === 'firefox' ? 'gate.install.firefox' : 'gate.install.other')}
        </p>
      )}

      {!install.installed && platform === 'chromium' && (
        <div className="os-gate__actions">
          <Button
            variant="primary"
            icon={busy ? <Loader2 size={15} className="sh-spin" /> : <Download size={15} />}
            disabled={!install.canPrompt || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await promptInstall();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('gate.install.installing') : t('gate.install.button')}
          </Button>
        </div>
      )}
      {!install.installed && <p className="os-gate__hint">{t('gate.install.already')}</p>}

      <section className="os-gate__reqs" aria-label={t('gate.install.requirements')}>
        <span className="sf-label">{t('gate.install.requirements')}</span>
        <ul>
          <li data-ok>
            <Check size={13} /> {t('gate.req.display', { w: screen.width, h: screen.height })}
          </li>
          {caps.map((c) => (
            <li key={c.id} data-ok={c.ok || undefined}>
              {c.ok ? <Check size={13} /> : <X size={13} />} {t(capLabel[c.id]!)}
            </li>
          ))}
          <li>
            <Monitor size={13} /> {t('gate.req.installed')}
          </li>
        </ul>
      </section>
      <p className="os-gate__note">{t('gate.install.privacy')}</p>
      {onDevContinue && (
        <button type="button" className="os-gate__dev" onClick={onDevContinue}>
          {t('gate.install.devContinue')}
        </button>
      )}
    </GateFrame>
  );
}

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: innerWidth, h: innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: innerWidth, h: innerHeight });
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return vp;
}

export function ViewportGuard() {
  const t = useGateT();
  const vp = useViewport();
  const issue = assessViewport(vp.w, vp.h, (navigator.maxTouchPoints ?? 0) > 1);
  if (!issue) return null;
  return (
    <div className="os-viewport-guard" role="alertdialog" aria-modal="true" aria-labelledby="vg-title">
      <div className="os-viewport-guard__box">
        {issue === 'rotate' ? (
          <RotateCw size={30} strokeWidth={1.5} />
        ) : (
          <Monitor size={30} strokeWidth={1.5} />
        )}
        <h2 id="vg-title">{t(issue === 'rotate' ? 'gate.viewport.rotate' : 'gate.viewport.enlarge')}</h2>
        <p>
          {issue === 'rotate'
            ? t('gate.viewport.rotateBody')
            : t('gate.viewport.enlargeBody', {
                w: vp.w,
                h: vp.h,
                minW: MIN_VIEWPORT.w,
                minH: MIN_VIEWPORT.h,
              })}
        </p>
      </div>
    </div>
  );
}
