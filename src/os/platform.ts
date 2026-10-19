/**
 * Platform requirements of the console: Safeton runs on desktop computers and on tablets in
 * desktop mode, and only as an installed application (standalone window, no browser chrome).
 *
 * The assessment functions are pure (inputs passed in) so they are testable; `readDeviceEnv`
 * and `isStandaloneDisplay` read the live browser state.
 */

export interface DeviceEnv {
  userAgent: string;
  /** `navigator.userAgentData.mobile` where available (Chromium). */
  uaMobile: boolean | null;
  maxTouchPoints: number;
  /** Physical screen size in CSS pixels. */
  screenW: number;
  screenH: number;
}

export type DeviceBlockReason = 'phone' | 'tablet-mobile-mode' | 'screen-too-small';
export type DeviceVerdict = { ok: true; tablet: boolean } | { ok: false; reason: DeviceBlockReason };

/** Minimum screen: long side × short side (CSS px). Covers every iPad in landscape. */
export const MIN_SCREEN = { long: 1024, short: 640 } as const;
/** Minimum usable viewport while running; smaller windows show a resize prompt. */
export const MIN_VIEWPORT = { w: 1024, h: 600 } as const;

export function assessDevice(env: DeviceEnv): DeviceVerdict {
  const ua = env.userAgent;
  if (/iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua))
    return { ok: false, reason: 'phone' };
  if (/Android/i.test(ua)) return { ok: false, reason: /Mobile/i.test(ua) ? 'phone' : 'tablet-mobile-mode' };
  // iPadOS requests the mobile site with an "iPad" token; in desktop mode it reports Macintosh.
  if (/iPad/i.test(ua)) return { ok: false, reason: 'tablet-mobile-mode' };
  if (env.uaMobile === true || /Mobi/i.test(ua)) return { ok: false, reason: 'phone' };
  const long = Math.max(env.screenW, env.screenH);
  const short = Math.min(env.screenW, env.screenH);
  if (long < MIN_SCREEN.long || short < MIN_SCREEN.short) return { ok: false, reason: 'screen-too-small' };
  const tablet = /Macintosh/i.test(ua) && env.maxTouchPoints > 1;
  return { ok: true, tablet };
}

export type ViewportIssue = 'rotate' | 'enlarge' | null;

/** Whether the current window is large enough to operate the desktop. */
export function assessViewport(w: number, h: number, touch: boolean): ViewportIssue {
  if (w >= MIN_VIEWPORT.w && h >= MIN_VIEWPORT.h) return null;
  return touch && h > w ? 'rotate' : 'enlarge';
}

export type InstallPlatform = 'chromium' | 'safari-mac' | 'ipados' | 'firefox' | 'other';

export function installPlatform(userAgent: string, maxTouchPoints: number): InstallPlatform {
  // Every iPadOS browser is WebKit-based and installs through Share → Add to Home Screen.
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ipados';
  if (/Firefox/i.test(userAgent)) return 'firefox';
  if (/Chrome|Chromium|Edg\/|OPR\//i.test(userAgent)) return 'chromium';
  if (/Safari/i.test(userAgent) && /Macintosh/i.test(userAgent)) return 'safari-mac';
  return 'other';
}

/** Display modes in which the console runs as an installed application. */
export const STANDALONE_QUERIES = [
  '(display-mode: standalone)',
  '(display-mode: fullscreen)',
  '(display-mode: window-controls-overlay)',
] as const;

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof matchMedia === 'function' && STANDALONE_QUERIES.some((q) => matchMedia(q).matches);
}

export function readDeviceEnv(): DeviceEnv {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return {
    userAgent: nav.userAgent,
    uaMobile: typeof nav.userAgentData?.mobile === 'boolean' ? nav.userAgentData.mobile : null,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    screenW: screen.width,
    screenH: screen.height,
  };
}

/** Capability checks shown on the installation screen. */
export function platformCapabilities(): { id: string; ok: boolean }[] {
  return [
    { id: 'crypto', ok: typeof crypto !== 'undefined' && !!crypto.subtle },
    { id: 'storage', ok: typeof indexedDB !== 'undefined' },
    { id: 'worker', ok: typeof Worker !== 'undefined' },
    { id: 'secure', ok: typeof isSecureContext === 'boolean' ? isSecureContext : false },
  ];
}

// ---- Install prompt (Chromium) ----------------------------------------------------------------

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

/** Captures the install prompt as early as possible (called from main before React renders). */
export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
}

export interface InstallState {
  canPrompt: boolean;
  installed: boolean;
}

let snapshot: InstallState = { canPrompt: false, installed: false };
export function getInstallState(): InstallState {
  const canPrompt = !!deferredPrompt;
  if (snapshot.canPrompt !== canPrompt || snapshot.installed !== installed)
    snapshot = { canPrompt, installed };
  return snapshot;
}

export function subscribeInstallState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows the browser's install dialog. Resolves to whether the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const p = deferredPrompt;
  if (!p) return false;
  await p.prompt();
  const choice = await p.userChoice;
  deferredPrompt = null;
  notify();
  return choice.outcome === 'accepted';
}
