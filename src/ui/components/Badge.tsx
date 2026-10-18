import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx';

export type Tone = 'neutral' | 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'accent';

export function Badge({
  tone = 'neutral',
  children,
  dot,
  pulse,
  outline,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  outline?: boolean;
  title?: string;
}) {
  return (
    <span
      className={cx('sf-badge', tone !== 'neutral' && `sf-badge--${tone}`, outline && 'sf-badge--outline')}
      data-pulse={pulse || undefined}
      title={title}
    >
      {dot && <span className="sf-badge__dot" aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_ICON: Record<Exclude<Tone, 'accent'>, typeof Info> = {
  neutral: CircleDashed,
  good: CheckCircle2,
  warning: AlertTriangle,
  serious: AlertOctagon,
  critical: XCircle,
  info: Info,
};

/** Status always carries an icon and a label — never colour alone. */
export function StatusBadge({ tone, label, pulse }: { tone: Exclude<Tone, 'accent'>; label: string; pulse?: boolean }) {
  const Icon = STATUS_ICON[tone];
  return (
    <span className={cx('sf-badge', tone !== 'neutral' && `sf-badge--${tone}`)} data-pulse={pulse || undefined}>
      <Icon size={12} strokeWidth={2.2} aria-hidden />
      {label}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="sf-kbd">{children}</kbd>;
}
