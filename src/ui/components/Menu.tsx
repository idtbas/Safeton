/**
 * Menus for the menu bar, context menus and dock: positioned at a point, kept inside the
 * viewport, with submenus, checkmarks, shortcuts and full keyboard control
 * (↑/↓, Home/End, → opens a submenu, ← closes it, Enter/Space selects, Esc closes).
 */
import { Check, ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx';

export interface MenuItem {
  id: string;
  label?: ReactNode;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  /** Non-interactive section heading. */
  heading?: boolean;
  submenu?: MenuItem[];
  onSelect?: () => void;
}

const interactive = (i: MenuItem) => !i.separator && !i.heading && !i.disabled;

export function MenuList({
  items,
  x,
  y,
  onClose,
  label,
  autoFocus = true,
  minWidth = 220,
  /** Horizontal anchor for flipping submenus (x of the parent's left edge). */
  flipX,
  className,
  onNavigate,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
  label?: string;
  autoFocus?: boolean;
  minWidth?: number;
  flipX?: number;
  className?: string;
  /** ←/→ at the top level (menu bar navigation between menus). */
  onNavigate?: (dir: -1 | 1) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{
    index: number;
    x: number;
    y: number;
    flip: number;
    keyboard: boolean;
  } | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + r.width > innerWidth - 4)
      left = flipX !== undefined ? flipX - r.width : innerWidth - r.width - 4;
    if (top + r.height > innerHeight - 4) top = Math.max(4, innerHeight - r.height - 4);
    setPos({ left: Math.max(4, left), top: Math.max(4, top) });
  }, [x, y, flipX, items.length]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const openSub = (index: number, keyboard: boolean) => {
    const el = itemRefs.current[index];
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSub({ index, x: r.right - 2, y: r.top - 5, flip: r.left + 2, keyboard });
  };

  const select = (item: MenuItem, index: number) => {
    if (!interactive(item)) return;
    if (item.submenu) {
      openSub(index, true);
      return;
    }
    onClose();
    item.onSelect?.();
  };

  const step = (dir: 1 | -1) => {
    const n = items.length;
    for (let k = 1; k <= n; k++) {
      const i = ((((active < 0 ? (dir === 1 ? -1 : 0) : active) + dir * k) % n) + n) % n;
      if (interactive(items[i]!)) {
        setActive(i);
        setSub(null);
        return;
      }
    }
  };

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className={cx('sf-menu', className)}
        style={{ left: pos.left, top: pos.top, minWidth }}
        onKeyDown={(e) => {
          const item = items[active];
          if (e.key === 'ArrowDown') step(1);
          else if (e.key === 'ArrowUp') step(-1);
          else if (e.key === 'Home') {
            setActive(-1);
            step(1);
          } else if (e.key === 'End') {
            setActive(items.length);
            step(-1);
          } else if (e.key === 'ArrowRight') {
            if (item?.submenu && interactive(item)) openSub(active, true);
            else onNavigate?.(1);
          } else if (e.key === 'ArrowLeft') onNavigate?.(-1);
          else if (e.key === 'Enter' || e.key === ' ') {
            if (item) select(item, active);
          } else if (e.key === 'Escape') onClose();
          else if (e.key === 'Tab') onClose();
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) => {
          if (item.separator) return <div key={item.id} className="sf-menu__sep" role="separator" />;
          if (item.heading)
            return (
              <div key={item.id} className="sf-menu__heading" role="presentation">
                {item.label}
              </div>
            );
          return (
            <div
              key={item.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={item.checked}
              aria-disabled={item.disabled || undefined}
              aria-haspopup={item.submenu ? 'menu' : undefined}
              aria-expanded={item.submenu ? sub?.index === i : undefined}
              className="sf-menu__item"
              data-active={i === active || sub?.index === i || undefined}
              data-danger={item.danger || undefined}
              onPointerEnter={() => {
                setActive(i);
                if (item.submenu && interactive(item)) openSub(i, false);
                else if (sub) {
                  setSub(null);
                  ref.current?.focus();
                }
              }}
              onClick={() => select(item, i)}
            >
              <span className="sf-menu__check" aria-hidden>
                {item.checked ? <Check size={12} strokeWidth={2.4} /> : item.icon}
              </span>
              <span className="sf-menu__label">{item.label}</span>
              {item.shortcut && <span className="sf-menu__shortcut">{item.shortcut}</span>}
              {item.submenu && <ChevronRight size={12} className="sf-menu__chevron" aria-hidden />}
            </div>
          );
        })}
      </div>
      {sub && items[sub.index]?.submenu && (
        <MenuList
          items={items[sub.index]!.submenu!}
          x={sub.x}
          y={sub.y}
          flipX={sub.flip}
          autoFocus={sub.keyboard}
          minWidth={180}
          onClose={onClose}
          onNavigate={(dir) => {
            if (dir === -1) {
              setSub(null);
              ref.current?.focus();
            }
          }}
          className={className}
        />
      )}
    </>
  );
}

/** Full-screen click catcher + menu, rendered in a portal (context menus). */
export function PopupMenu({
  items,
  x,
  y,
  onClose,
  label,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
  label?: string;
}) {
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    return () => restore?.focus?.();
  }, []);
  return createPortal(
    <div
      className="sf-menu-layer"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <MenuList items={items} x={x} y={y} onClose={onClose} label={label} />
    </div>,
    document.body,
  );
}
