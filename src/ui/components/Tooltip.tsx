import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Hover / focus tooltip. Positions above the trigger, flips below near the top edge and
 * clamps horizontally to the viewport.
 */
export function Tooltip({
  content,
  children,
  delay = 350,
}: {
  content: ReactNode;
  children: ReactElement;
  delay?: number;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const show = (el: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      const below = r.top < 60;
      setPos({
        x: Math.min(window.innerWidth - 170, Math.max(10, r.left + r.width / 2)),
        y: below ? r.bottom + 8 : r.top - 8,
        below,
      });
    }, delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };

  if (!isValidElement(children)) return children;
  const child = children as ReactElement<Record<string, unknown>>;
  // The handlers only touch the timer ref when events fire, never during render.
  // eslint-disable-next-line react-hooks/refs
  const trigger = cloneElement(child, {
    'aria-describedby': pos ? id : undefined,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e.currentTarget),
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget),
    onBlur: hide,
  });
  return (
    <>
      {trigger}
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="sf-tooltip"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.below ? '0' : '-100%'})` }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
