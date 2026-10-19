import { useEffect } from 'react';
import { useWindowStore } from '../../os/windows/store';
import { lock, openSettings, saveSystem, toggleFullscreen } from './actions';
import { isMod } from './keys';
import { useDesktopStore } from './store';

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/**
 * Desktop keyboard shortcuts. Browser shortcuts that make no sense inside the operating system
 * (reload, save page, print, find) are intercepted and mapped to system functions.
 */
export function useDesktopShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ws = useWindowStore.getState();
      const ds = useDesktopStore.getState();
      const focused = ws.focusedId;
      const k = e.key.toLowerCase();
      let handled = true;
      if (isMod(e) && !e.altKey && (k === 'k' || k === ' ')) ds.toggleOverlay('launcher');
      else if (isMod(e) && k === ',') openSettings();
      else if (isMod(e) && k === 's') void saveSystem();
      else if ((isMod(e) && k === 'r') || e.key === 'F5') ds.setDialog('restart');
      else if (isMod(e) && (k === 'p' || k === 'f')) ds.setOverlay('launcher');
      else if (isMod(e) && k === '/') ds.setDialog('shortcuts');
      else if (e.ctrlKey && e.altKey && k === 'l') lock();
      else if (e.ctrlKey && e.altKey && e.key === 'ArrowLeft' && focused) ws.snap(focused, 'left');
      else if (e.ctrlKey && e.altKey && e.key === 'ArrowRight' && focused) ws.snap(focused, 'right');
      else if (e.ctrlKey && e.altKey && e.key === 'ArrowUp' && focused) ws.toggleMaximize(focused);
      else if (e.ctrlKey && e.altKey && e.key === 'ArrowDown' && focused) ws.minimize(focused);
      else if (e.altKey && !e.ctrlKey && k === 'w' && focused) ws.close(focused);
      else if (e.altKey && !e.ctrlKey && k === 'm' && focused) ws.minimize(focused);
      else if (e.altKey && (e.key === '`' || e.code === 'Backquote')) ws.cycle(e.shiftKey ? -1 : 1);
      else if (e.key === 'F11') void toggleFullscreen();
      else if (e.key === 'Escape' && (ds.overlay || ds.contextMenu || ds.menu)) {
        ds.setOverlay(null);
        ds.closeContextMenu();
        ds.setMenu(null);
      } else handled = false;
      if (!handled && e.key === 'Escape' && !editable(e.target)) ds.selectIcon(null);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
