/** Platform-aware modifier key labels and checks for keyboard shortcuts. */
export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Label of the primary modifier (⌘ on Apple platforms, Ctrl elsewhere). */
export const MOD = IS_MAC ? '⌘' : 'Ctrl ';

/** Primary modifier pressed (⌘ on Apple platforms, Ctrl elsewhere — both accepted). */
export const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
