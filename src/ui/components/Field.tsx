import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cx } from '../cx';

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="sf-field">
      {label && (
        <label className="sf-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className="sf-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="sf-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  prefix?: ReactNode;
  suffix?: ReactNode;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, mono, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <div className="sf-input-wrap" data-invalid={error ? 'true' : undefined}>
        {prefix && <span className="sf-input-wrap__affix">{prefix}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cx('sf-input', mono && 'sf-input--mono', className)}
          aria-invalid={error ? true : undefined}
          {...rest}
        />
        {suffix && <span className="sf-input-wrap__affix">{suffix}</span>}
      </div>
    </Field>
  );
});

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'onChange' | 'value'
> {
  label?: ReactNode;
  hint?: ReactNode;
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function Select<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  id,
  className,
  ...rest
}: SelectProps<T>) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <Field label={label} hint={hint} htmlFor={selectId}>
      <select
        id={selectId}
        className={cx('sf-select', className)}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
