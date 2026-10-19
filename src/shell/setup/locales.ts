import type { Settings } from '../../os/settings/schema';

/** Supported console locales, labelled in their own language. */
export const LOCALES: { value: Settings['region']['locale']; label: string }[] = [
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
];
