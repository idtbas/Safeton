import type { ReactNode } from 'react';

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  const toggle = () => !disabled && onChange(!checked);
  return (
    <span
      role="switch"
      tabIndex={disabled ? -1 : 0}
      className="sf-toggle"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <span className="sf-toggle__track" aria-hidden>
        <span className="sf-toggle__thumb" />
      </span>
      {label}
    </span>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (v: number) => string;
  label?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="sf-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format ? format(value) : undefined}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="sf-slider__value">{format ? format(value) : value}</span>
    </div>
  );
}
