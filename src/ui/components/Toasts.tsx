import { AlertOctagon, AlertTriangle, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import type { Severity } from '../../engine';
import { TOAST_TTL_MS, useNotificationStore } from '../../os/notifications/store';
import { Button } from './Button';

const TONE: Record<Severity, { color: string; Icon: typeof Info }> = {
  debug: { color: 'var(--status-neutral)', Icon: Info },
  info: { color: 'var(--status-info)', Icon: Info },
  notice: { color: 'var(--status-info)', Icon: Info },
  warning: { color: 'var(--status-warning)', Icon: AlertTriangle },
  error: { color: 'var(--status-serious)', Icon: AlertOctagon },
  critical: { color: 'var(--status-critical)', Icon: XCircle },
};

function Toast({ id }: { id: number }) {
  const n = useNotificationStore((s) => s.items.find((x) => x.id === id));
  const dismiss = useNotificationStore((s) => s.dismissToast);
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), n?.severity === 'critical' ? TOAST_TTL_MS * 2 : TOAST_TTL_MS);
    return () => clearTimeout(t);
  }, [id, dismiss, n?.severity]);
  if (!n) return null;
  const { color, Icon } = TONE[n.severity];
  return (
    <div className="sf-toast" role={n.severity === 'critical' ? 'alert' : 'status'} style={{ ['--toast-color' as string]: color }}>
      <Icon className="sf-toast__icon" size={16} aria-hidden />
      <div style={{ minWidth: 0 }}>
        <div className="sf-toast__title">
          <span className="sf-visually-hidden">{n.severity}: </span>
          {n.title}
        </div>
        <div className="sf-toast__body">{n.body}</div>
      </div>
      <Button variant="ghost" size="sm" iconOnly icon={<X size={13} />} aria-label="Dismiss" onClick={() => dismiss(id)} />
    </div>
  );
}

export function ToastViewport() {
  const toasts = useNotificationStore((s) => s.toasts);
  return (
    <div className="sf-toasts" aria-live="polite">
      {toasts.map((id) => (
        <Toast key={id} id={id} />
      ))}
    </div>
  );
}
