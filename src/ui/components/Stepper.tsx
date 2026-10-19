import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface StepperItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
}

/**
 * Vertical progress stepper (setup assistants, multi-stage procedures). Completed steps up to
 * `reachable` can be revisited; later steps are disabled until every earlier step is done.
 */
export function Stepper({
  items,
  current,
  completed,
  reachable = current,
  onSelect,
  label = 'Progress',
  doneLabel = 'completed',
  currentLabel = 'current step',
  compact,
}: {
  items: StepperItem[];
  current: number;
  completed: readonly number[];
  /** Highest index that may be selected. */
  reachable?: number;
  onSelect?: (index: number) => void;
  label?: string;
  doneLabel?: string;
  currentLabel?: string;
  compact?: boolean;
}) {
  return (
    <nav aria-label={label} className={cx('sf-stepper', compact && 'sf-stepper--compact')}>
      <ol>
        {items.map((item, i) => {
          const done = completed.includes(i);
          const isCurrent = i === current;
          const enabled = !!onSelect && i <= reachable && !isCurrent;
          const state = isCurrent ? 'current' : done ? 'done' : 'pending';
          return (
            <li key={item.id} className="sf-stepper__item" data-state={state}>
              <button
                type="button"
                className="sf-stepper__btn"
                disabled={!enabled}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => onSelect?.(i)}
              >
                <span className="sf-stepper__mark" aria-hidden>
                  {done && !isCurrent ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span className="sf-stepper__text">
                  <span className="sf-stepper__title">{item.title}</span>
                  {item.description && !compact && (
                    <span className="sf-stepper__desc">{item.description}</span>
                  )}
                  <span className="sf-visually-hidden">
                    {isCurrent ? ` (${currentLabel})` : done ? ` (${doneLabel})` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
