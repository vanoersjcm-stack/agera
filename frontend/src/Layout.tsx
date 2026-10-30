import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  href?: string;
}

/** Common frame for every view: breadcrumb (Suite › Section › Record), title and page actions. */
export function ViewFrame({
  title,
  subtitle,
  crumbs = [],
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      {crumbs.length > 0 && (
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {i > 0 && <span className="sep">›</span>}
              {c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <header className="view-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="view-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="view-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
