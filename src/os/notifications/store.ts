/**
 * Notification center: persistent list plus transient toasts. Fed by the engine event stream
 * (filtered by severity settings) and by the OS itself.
 */
import { create } from 'zustand';
import { SEVERITY_RANK, type Severity } from '../../engine';

export interface Notification {
  id: number;
  severity: Severity;
  title: string;
  body: string;
  source: string | null;
  /** Simulated time of the underlying event, if any (epoch ms). */
  simTime: number | null;
  createdAt: number;
  read: boolean;
}

export interface NotificationInput {
  severity: Severity;
  title: string;
  body: string;
  source?: string | null;
  simTime?: number | null;
}

export const MAX_NOTIFICATIONS = 300;
export const TOAST_TTL_MS = 6000;
export const MAX_TOASTS = 4;

interface NotificationState {
  items: Notification[];
  toasts: number[];
  nextId: number;
  minToastSeverity: Severity;
  toastsEnabled: boolean;
  doNotDisturb: boolean;
  push: (n: NotificationInput) => number;
  dismissToast: (id: number) => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  remove: (id: number) => void;
  clear: () => void;
  configure: (opts: { minToastSeverity?: Severity; toastsEnabled?: boolean; doNotDisturb?: boolean }) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  toasts: [],
  nextId: 1,
  minToastSeverity: 'warning',
  toastsEnabled: true,
  doNotDisturb: false,

  push: (input) => {
    const s = get();
    const id = s.nextId;
    const n: Notification = {
      id,
      severity: input.severity,
      title: input.title,
      body: input.body,
      source: input.source ?? null,
      simTime: input.simTime ?? null,
      createdAt: Date.now(),
      read: false,
    };
    const items = [n, ...s.items].slice(0, MAX_NOTIFICATIONS);
    const showToast =
      s.toastsEnabled &&
      (!s.doNotDisturb || input.severity === 'critical') &&
      SEVERITY_RANK[input.severity] >= SEVERITY_RANK[s.minToastSeverity];
    const toasts = showToast ? [id, ...s.toasts].slice(0, MAX_TOASTS) : s.toasts;
    set({ items, toasts, nextId: id + 1 });
    return id;
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t !== id) }),
  markRead: (id) => set({ items: get().items.map((n) => (n.id === id ? { ...n, read: true } : n)) }),
  markAllRead: () => set({ items: get().items.map((n) => (n.read ? n : { ...n, read: true })) }),
  remove: (id) => set({ items: get().items.filter((n) => n.id !== id), toasts: get().toasts.filter((t) => t !== id) }),
  clear: () => set({ items: [], toasts: [] }),
  configure: (opts) => set(opts),
}));

export function unreadCount(items: Notification[]): number {
  let c = 0;
  for (const n of items) if (!n.read) c++;
  return c;
}
