import { Minus, Plus } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Field } from './Field';

const decimals = (step: number) => {
  const s = String(step);
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
};

/**
 * Numeric input with unit, stepper buttons and clamping. Typing is free-form (the draft text is
 * kept while editing); the value is committed on every valid keystroke and normalised on blur.
 * Arrow keys step, Shift+Arrow steps ×10, PageUp/PageDown step ×10.
 */
export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit,
  label,
  hint,
  error,
  disabled,
  id,
  format,
  increaseLabel = 'Increase',
  decreaseLabel = 'Decrease',
  width,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: ReactNode;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  id?: string;
  /** Display formatting when not focused (defaults to the step precision). */
  format?: (v: number) => string;
  increaseLabel?: string;
  decreaseLabel?: string;
  width?: number;
}) {
  const auto = useId();
  const inputId = id ?? auto;
  const digits = decimals(step);
  const show = (v: number) => (format ? format(v) : Number.isFinite(v) ? v.toFixed(digits) : '');
  const [text, setText] = useState(() => show(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // Keep the field in sync with external changes while the user is not typing.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors a controlled prop into local draft text
    if (!editing) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `show` is derived from props listed here
  }, [value, editing, digits, format]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const round = (v: number) => Number(v.toFixed(digits));
  const parse = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

  const commit = (v: number) => {
    const next = round(clamp(v));
    if (next !== value) onChange(next);
    setText(next.toFixed(digits));
  };
  const bump = (dir: 1 | -1, mult = 1) => commit((Number.isFinite(value) ? value : 0) + dir * step * mult);
  const outOfRange = (() => {
    const v = parse(text);
    return editing && text.trim() !== '' && (!Number.isFinite(v) || v < min || v > max);
  })();

  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <div
        className="sf-input-wrap sf-number"
        data-invalid={error || outOfRange ? 'true' : undefined}
        style={width ? { width } : undefined}
      >
        <button
          type="button"
          className="sf-number__btn"
          tabIndex={-1}
          aria-label={decreaseLabel}
          disabled={disabled || value <= min}
          onClick={() => bump(-1)}
        >
          <Minus size={12} />
        </button>
        <input
          id={inputId}
          className="sf-input sf-input--mono sf-number__input"
          inputMode="decimal"
          role="spinbutton"
          aria-valuemin={Number.isFinite(min) ? min : undefined}
          aria-valuemax={Number.isFinite(max) ? max : undefined}
          aria-valuenow={Number.isFinite(value) ? value : undefined}
          aria-invalid={error || outOfRange ? true : undefined}
          disabled={disabled}
          value={editing ? text : show(value)}
          onFocus={(e) => {
            setEditing(true);
            setText(Number.isFinite(value) ? value.toFixed(digits) : '');
            e.target.select();
          }}
          onBlur={() => {
            setEditing(false);
            const v = parse(text);
            if (text.trim() !== '' && Number.isFinite(v)) commit(v);
          }}
          onChange={(e) => {
            setText(e.target.value);
            const v = parse(e.target.value);
            if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max)
              onChange(round(v));
          }}
          onKeyDown={(e) => {
            const mult = e.shiftKey ? 10 : 1;
            if (e.key === 'ArrowUp') bump(1, mult);
            else if (e.key === 'ArrowDown') bump(-1, mult);
            else if (e.key === 'PageUp') bump(1, 10);
            else if (e.key === 'PageDown') bump(-1, 10);
            else if (e.key === 'Home' && Number.isFinite(min)) commit(min);
            else if (e.key === 'End' && Number.isFinite(max)) commit(max);
            else return;
            e.preventDefault();
          }}
        />
        {unit && <span className="sf-input-wrap__affix sf-number__unit">{unit}</span>}
        <button
          type="button"
          className="sf-number__btn"
          tabIndex={-1}
          aria-label={increaseLabel}
          disabled={disabled || value >= max}
          onClick={() => bump(1)}
        >
          <Plus size={12} />
        </button>
      </div>
    </Field>
  );
}
