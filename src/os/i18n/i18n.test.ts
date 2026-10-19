import { describe, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';
import { DICTIONARIES, isMessageKey, langFromLocale, translate } from './index';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('German covers exactly the English keys', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it('translations are non-empty and keep every placeholder', () => {
    for (const [lang, dict] of Object.entries(DICTIONARIES)) {
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(dict[key].trim(), `${lang}:${key}`).not.toBe('');
        expect(placeholders(dict[key]), `${lang}:${key}`).toEqual(placeholders(en[key]));
      }
    }
  });

  it('interpolates parameters and leaves unknown ones visible', () => {
    expect(translate('en', 'setup.stepOf', { n: 3, total: 13 })).toBe('Step 3 of 13');
    expect(translate('de', 'setup.stepOf', { n: 3, total: 13 })).toBe('Schritt 3 von 13');
    expect(translate('en', 'setup.stepOf', { n: 3 })).toBe('Step 3 of {total}');
  });

  it('maps locales to languages', () => {
    expect(langFromLocale('de-DE')).toBe('de');
    expect(langFromLocale('en-GB')).toBe('en');
    expect(isMessageKey('common.back')).toBe(true);
    expect(isMessageKey('nope.nope')).toBe(false);
  });
});
