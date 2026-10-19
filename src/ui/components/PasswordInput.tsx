import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { Input, type InputProps } from './Field';

/** Password field with a show/hide toggle and an optional strength meter (0–4). */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputProps, 'type' | 'suffix'> & {
    strength?: { score: 0 | 1 | 2 | 3 | 4; label: string } | null;
    showLabel?: string;
    hideLabel?: string;
  }
>(function PasswordInput(
  { strength, showLabel = 'Show password', hideLabel = 'Hide password', ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="sf-password">
      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="off"
        suffix={
          <button
            type="button"
            className="sf-password__toggle"
            aria-label={visible ? hideLabel : showLabel}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        }
        {...rest}
      />
      {strength && (
        <div className="sf-strength" data-score={strength.score}>
          <div className="sf-strength__bars" aria-hidden>
            {[1, 2, 3, 4].map((i) => (
              <span key={i} data-on={strength.score >= i || undefined} />
            ))}
          </div>
          <span className="sf-strength__label" aria-live="polite">
            {strength.label}
          </span>
        </div>
      )}
    </div>
  );
});
