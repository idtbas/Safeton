import { cx } from '../cx';

export type ProgressTone = 'accent' | 'good' | 'warning' | 'critical';

export function Progress({
  value,
  tone = 'accent',
  thin,
  indeterminate,
  label,
}: {
  /** 0..1 */
  value?: number;
  tone?: ProgressTone;
  thin?: boolean;
  indeterminate?: boolean;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, value ?? 0)) * 100;
  return (
    <div
      className={cx(
        'sf-progress',
        thin && 'sf-progress--thin',
        indeterminate && 'sf-progress--indeterminate',
      )}
      data-tone={tone === 'accent' ? undefined : tone}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      <div className="sf-progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Meter whose tone escalates with value (e.g. utilisation against thresholds). */
export function Meter({
  value,
  warn = 0.8,
  crit = 0.95,
  label,
}: {
  value: number;
  warn?: number;
  crit?: number;
  label?: string;
}) {
  const tone: ProgressTone = value >= crit ? 'critical' : value >= warn ? 'warning' : 'accent';
  return <Progress value={value} tone={tone} label={label} />;
}

export function Segments({ total, on, label }: { total: number; on: number; label?: string }) {
  return (
    <div
      className="sf-segments"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={on}
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="sf-segments__seg" data-on={i < on || undefined} />
      ))}
    </div>
  );
}
