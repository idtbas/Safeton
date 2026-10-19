/**
 * Lightweight i18n: typed message keys (English is the source dictionary), `{name}`
 * interpolation, language derived from the region settings. Engine event texts stay English,
 * like real infrastructure logs.
 */
import { useCallback } from 'react';
import { useSettingsStore } from '../settings/store';
import { de } from './de';
import { en, type MessageKey } from './en';

export type { MessageKey } from './en';
export type Lang = 'de' | 'en';
export type Params = Record<string, string | number>;

export const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { en, de };

export function langFromLocale(locale: string): Lang {
  return locale.startsWith('de') ? 'de' : 'en';
}

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const template = DICTIONARIES[lang][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Translation for non-React callers (kernel notifications). */
export function t(key: MessageKey, params?: Params): string {
  return translate(langFromLocale(useSettingsStore.getState().settings.region.locale), key, params);
}

export type Translate = (key: MessageKey, params?: Params) => string;

/** React hook bound to the current language; `localeOverride` lets setup preview its choice. */
export function useT(localeOverride?: string): Translate {
  const locale = useSettingsStore((s) => s.settings.region.locale);
  const lang = langFromLocale(localeOverride ?? locale);
  return useCallback((key: MessageKey, params?: Params) => translate(lang, key, params), [lang]);
}

export function isMessageKey(key: string): key is MessageKey {
  return key in en;
}
