import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../cx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  icon?: ReactNode;
  iconOnly?: boolean;
  loading?: boolean;
  pressed?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'md',
    icon,
    iconOnly,
    loading,
    pressed,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'sf-btn',
        variant !== 'default' && `sf-btn--${variant}`,
        size === 'sm' && 'sf-btn--sm',
        iconOnly && 'sf-btn--icon',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      {...rest}
    >
      {loading ? <span className="sf-btn__spinner" aria-hidden /> : icon}
      {!iconOnly && children}
    </button>
  );
});

export function ButtonGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="sf-btn-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}
