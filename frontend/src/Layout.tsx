import type { ReactNode } from 'react';
import { navigate } from './router';

export interface Crumb {
  label: string;
  href?: string;
}

function ReturnToDashboard() {
  return (
    <button className="secondary" onClick={() => navigate('/dashboard')}>
      ← Return to Dashboard
    </button>
  );
}

/** Common frame for every view: breadcrumbs starting at the dashboard, title, and a way back. */
export function ViewFrame({
  title,
  crumbs = [],
  actions,
  children,
}: {
  title: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const isDashboard = crumbs.length === 0 && title === 'Dashboard';
  const trail: Crumb[] = isDashboard ? [{ label: 'Dashboard' }] : [{ label: 'Dashboard', href: '#/dashboard' }, ...crumbs];
  return (
    <section>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        {trail.map((c, i) => (
          <span key={`${c.label}-${i}`}>
            {i > 0 && <span className="sep">/</span>}
            {c.href && i < trail.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
          </span>
        ))}
      </nav>
      <header className="view-header">
        <h1>{title}</h1>
        <div className="view-actions">
          {actions}
          {!isDashboard && <ReturnToDashboard />}
        </div>
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
      <div className="empty-actions">
        {action}
        <ReturnToDashboard />
      </div>
    </div>
  );
}
