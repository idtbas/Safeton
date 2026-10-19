/**
 * State of the desktop chrome (not of the apps): which system overlay is open, the active
 * context menu, the open menu-bar menu, system dialogs and the display sleep state.
 */
import { create } from 'zustand';
import type { MenuItem } from '../../ui';

export type Overlay = 'launcher' | 'control' | 'notifications' | 'calendar' | null;
export type SystemDialog = 'shortcuts' | 'restart' | 'shutdown' | null;

interface DesktopState {
  overlay: Overlay;
  contextMenu: { x: number; y: number; items: MenuItem[]; label?: string } | null;
  menu: string | null;
  dialog: SystemDialog;
  /** Display off (sleep); any input wakes the system to the lock screen. */
  sleeping: boolean;
  selectedIcon: string | null;
  setOverlay: (o: Overlay) => void;
  toggleOverlay: (o: Exclude<Overlay, null>) => void;
  openContextMenu: (x: number, y: number, items: MenuItem[], label?: string) => void;
  closeContextMenu: () => void;
  setMenu: (m: string | null) => void;
  setDialog: (d: SystemDialog) => void;
  setSleeping: (s: boolean) => void;
  selectIcon: (id: string | null) => void;
}

export const useDesktopStore = create<DesktopState>((set, get) => ({
  overlay: null,
  contextMenu: null,
  menu: null,
  dialog: null,
  sleeping: false,
  selectedIcon: null,
  setOverlay: (overlay) => set({ overlay, menu: null, contextMenu: null }),
  toggleOverlay: (o) => set({ overlay: get().overlay === o ? null : o, menu: null, contextMenu: null }),
  openContextMenu: (x, y, items, label) =>
    set({ contextMenu: { x, y, items, label }, menu: null, overlay: null }),
  closeContextMenu: () => set({ contextMenu: null }),
  setMenu: (menu) => set({ menu, overlay: menu ? null : get().overlay }),
  setDialog: (dialog) => set({ dialog, menu: null, contextMenu: null, overlay: null }),
  setSleeping: (sleeping) => set({ sleeping }),
  selectIcon: (selectedIcon) => set({ selectedIcon }),
}));
