import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Sparkline } from './Sparkline';

/**
 * Stat tile: label · value (+unit) · optional delta / footnote · optional trend sparkline.
 */
export function MetricTile({
  label,
  value,
  unit,
  icon,
  foot,
  trend,
  trendFormat,
  trendColor,
  delta,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  icon?: ReactNode;
  foot?: ReactNode;
  trend?: ArrayLike<number>;
  trendFormat?: (v: number) => string;
  trendColor?: string;
  delta?: { text: string; direction: 'up' | 'down'; good: boolean };
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(96);
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(48, Math.min(160, el.clientWidth * 0.45))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="sf-metric">
      <div className="sf-metric__label">
        {icon}
        {label}
      </div>
      <div className="sf-metric__row" ref={rowRef}>
        <div className="sf-metric__value">
          {value}
          {unit && <span className="sf-metric__unit">{unit}</span>}
        </div>
        {trend && trend.length > 1 && <Sparkline values={trend} width={w} height={26} format={trendFormat} color={trendColor} />}
      </div>
      {(foot || delta) && (
        <div className="sf-metric__foot">
          {delta && <span className={`sf-delta--${delta.direction}-${delta.good ? 'good' : 'bad'}`}>{delta.text}</span>}
          {foot}
        </div>
      )}
    </div>
  );
}
