import { useEffect } from 'react';

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    ['INPUT', 'TEXTAREA'].includes(el.tagName) ||
    !!el.closest('[data-native-context]'));

/**
 * Removes browser affordances that break the illusion of an operating system: the browser
 * context menu (outside text fields), page zoom (Ctrl/⌘ + wheel / ± / 0, pinch), dragging
 * images and links out of the page.
 */
export function useOsChrome(): void {
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (!editable(e.target)) e.preventDefault();
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0', 'Add', 'Subtract'].includes(e.key))
        e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    const onDrag = (e: DragEvent) => {
      if (e.target instanceof HTMLImageElement || e.target instanceof HTMLAnchorElement) e.preventDefault();
    };
    document.addEventListener('contextmenu', onContext);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    document.addEventListener('gesturestart', onGesture);
    document.addEventListener('gesturechange', onGesture);
    document.addEventListener('dragstart', onDrag);
    return () => {
      document.removeEventListener('contextmenu', onContext);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('gesturestart', onGesture);
      document.removeEventListener('gesturechange', onGesture);
      document.removeEventListener('dragstart', onDrag);
    };
  }, []);
}
