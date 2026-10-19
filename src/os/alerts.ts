/** Active threshold alerts maintained by the kernel's monitor (edge-triggered, with hysteresis). */
import { create } from 'zustand';

export interface ActiveAlert {
  id: string;
  level: 'warning' | 'critical';
  title: string;
  body: string;
  since: number;
}

interface AlertState {
  alerts: Record<string, ActiveAlert>;
  set: (id: string, alert: ActiveAlert | null) => void;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: {},
  set: (id, alert) => {
    const alerts = { ...get().alerts };
    if (alert) alerts[id] = alert;
    else delete alerts[id];
    set({ alerts });
  },
}));
