import { Check } from 'lucide-react';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../cx';

export interface CardOption<T extends string = string> {
  value: T;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Free content below the description (metrics, badges). */
  meta?: ReactNode;
  disabled?: boolean;
  /** Shown instead of the description while disabled. */
  disabledReason?: ReactNode;
}

/**
 * Single-choice selection rendered as cards. Implements the WAI-ARIA radio group pattern:
 * one tab stop, arrow keys move and select, Home/End jump to the first/last option.
 */
export function CardSelect<T extends string>({
  options,
  value,
  onChange,
  label,
  columns,
  size = 'md',
}: {
  options: CardOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Minimum card width in px (cards wrap responsively). */
  columns?: number;
  size?: 'sm' | 'md';
}) {
  const id = useId();
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const selected = options.findIndex((o) => o.value === value);
  const tabStop = selected >= 0 && !options[selected]!.disabled ? selected : (enabled[0] ?? -1);

  const move = (from: number, delta: number | 'first' | 'last') => {
    if (enabled.length === 0) return;
    let target: number;
    if (delta === 'first') target = enabled[0]!;
    else if (delta === 'last') target = enabled[enabled.length - 1]!;
    else {
      const pos = enabled.indexOf(from);
      target = enabled[(pos + delta + enabled.length) % enabled.length]!;
    }
    onChange(options[target]!.value);
    refs.current[target]?.focus();
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const keys: Record<string, number | 'first' | 'last'> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
      Home: 'first',
      End: 'last',
    };
    const k = keys[e.key];
    if (k !== undefined) {
      e.preventDefault();
      move(i, k);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!options[i]!.disabled) onChange(options[i]!.value);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('sf-cards', size === 'sm' && 'sf-cards--sm')}
      style={columns ? { ['--card-min' as string]: `${columns}px` } : undefined}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <div
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="radio"
            aria-checked={checked}
            aria-disabled={o.disabled || undefined}
            aria-describedby={o.description || o.disabledReason ? `${id}-${i}-d` : undefined}
            tabIndex={i === tabStop ? 0 : -1}
            className="sf-card-option"
            onClick={() => !o.disabled && onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <div className="sf-card-option__head">
              {o.icon && (
                <span className="sf-card-option__icon" aria-hidden>
                  {o.icon}
                </span>
              )}
              <span className="sf-card-option__title">{o.title}</span>
              <span className="sf-card-option__check" aria-hidden>
                {checked && <Check size={12} strokeWidth={3} />}
              </span>
            </div>
            {(o.description || (o.disabled && o.disabledReason)) && (
              <div id={`${id}-${i}-d`} className="sf-card-option__desc">
                {o.disabled && o.disabledReason ? o.disabledReason : o.description}
              </div>
            )}
            {o.meta && <div className="sf-card-option__meta">{o.meta}</div>}
          </div>
        );
      })}
    </div>
  );
}
