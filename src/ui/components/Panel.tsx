import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../cx';

export function Panel({
  title,
  subtitle,
  icon,
  actions,
  children,
  flush,
  className,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cx('sf-panel', className)} style={style}>
      {(title || actions) && (
        <header className="sf-panel__header">
          {icon && <span className="sf-muted" style={{ display: 'flex' }}>{icon}</span>}
          <div className="sf-panel__title">
            {title}
            {subtitle && <span className="sf-panel__subtitle">{subtitle}</span>}
          </div>
          {actions && <div className="sf-panel__actions">{actions}</div>}
        </header>
      )}
      <div className={cx('sf-panel__body', flush && 'sf-panel__body--flush')}>{children}</div>
    </section>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="sf-kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
