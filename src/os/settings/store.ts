import { create } from 'zustand';
import { ACCENTS, defaultSettings, mergeSettings, type Settings, type SettingsPatch } from './schema';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  /** Applies a validated partial update. Returns an error message if validation fails. */
  update: (patch: SettingsPatch) => string | null;
  replace: (settings: Settings) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings(),
  loaded: false,
  update: (patch) => {
    try {
      set({ settings: mergeSettings(get().settings, patch) });
      return null;
    } catch (err) {
      const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
      return issues?.length ? `${issues[0]!.path.join('.')}: ${issues[0]!.message}` : (err as Error).message;
    }
  },
  replace: (settings) => set({ settings, loaded: true }),
  reset: () => set({ settings: defaultSettings() }),
}));

function prefersDark(): boolean {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : true;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
}

/** Projects appearance settings onto the document root (CSS custom properties / data attributes). */
export function applyAppearance(settings: Settings, root: HTMLElement = document.documentElement): void {
  const a = settings.appearance;
  const theme = a.theme === 'system' ? (prefersDark() ? 'dark' : 'light') : a.theme;
  root.dataset.theme = theme;
  root.dataset.density = a.density;
  const accent = ACCENTS[a.accent];
  root.style.setProperty('--accent-h', String(accent.hue));
  root.style.setProperty('--accent-c', a.accent === 'graphite' ? '0.03' : '0.13');
  root.style.setProperty('--font-scale', String(a.fontScale));
  const reduce = a.reducedMotion === 'on' || (a.reducedMotion === 'system' && prefersReducedMotion());
  root.dataset.motion = reduce || !settings.windows.animate ? 'reduced' : 'full';
}
