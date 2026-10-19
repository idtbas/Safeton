/**
 * Building blocks every application window uses: toolbar, navigation sidebar, scrollable
 * content and a status bar — so all apps share one structure and density.
 */
import type { ReactNode } from 'react';
import { cx } from '../../ui';

export function AppFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ap-frame', className)}>{children}</div>;
}

export function AppToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="ap-toolbar" role="toolbar">
      {children}
    </div>
  );
}

export function ToolbarSpacer() {
  return <span className="ap-toolbar__spacer" />;
}

export function ToolbarSeparator() {
  return <span className="ap-toolbar__sep" aria-hidden />;
}

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export function AppSidebar<T extends string>({
  items,
  value,
  onChange,
  label,
  footer,
  header,
}: {
  items: (NavItem<T> | { heading: string })[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  footer?: ReactNode;
  header?: ReactNode;
}) {
  return (
    <nav className="ap-sidebar" aria-label={label}>
      {header}
      <ul>
        {items.map((it, i) =>
          'heading' in it ? (
            <li key={`h-${i}`} className="ap-sidebar__heading">
              {it.heading}
            </li>
          ) : (
            <li key={it.id}>
              <button
                type="button"
                className="ap-sidebar__item"
                aria-current={it.id === value ? 'page' : undefined}
                onClick={() => onChange(it.id)}
              >
                {it.icon && <span className="ap-sidebar__icon">{it.icon}</span>}
                <span className="ap-sidebar__label">{it.label}</span>
                {it.badge}
              </button>
            </li>
          ),
        )}
      </ul>
      {footer && <div className="ap-sidebar__footer">{footer}</div>}
    </nav>
  );
}

export function AppBody({
  children,
  padded = true,
  className,
}: {
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return <div className={cx('ap-body', padded && 'ap-body--padded', className)}>{children}</div>;
}

export function AppSplit({ children }: { children: ReactNode }) {
  return <div className="ap-split">{children}</div>;
}

export function AppStatusBar({ children }: { children: ReactNode }) {
  return (
    <div className="ap-statusbar" role="status">
      {children}
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
  flush,
  description,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  description?: ReactNode;
}) {
  return (
    <section className={cx('ap-section', flush && 'ap-section--flush')}>
      <header className="ap-section__head">
        <div>
          <h3>{title}</h3>
          {description && <p className="ap-section__desc">{description}</p>}
        </div>
        {actions && <div className="ap-section__actions">{actions}</div>}
      </header>
      <div className="ap-section__body">{children}</div>
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="ap-empty">
      {icon}
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}
