import { brandLabel } from './suites';
import { createPortal } from 'react-dom';
import { type ReactNode, useEffect, useState } from 'react';
import { setClientFilter, useClientFilter } from './clientFilter';
import { t, useLanguage } from './i18n';

export interface Crumb {
  label: string;
  href?: string;
}

/** The suite name already sits next to the waffle menu, so a leading suite crumb is dropped. */
const SUITE_CRUMBS = new Set(['Symphony', 'Nexus', 'RetailPower', 'Vanguard', 'Client portal']);

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
  const crumbSlot = useCrumbSlot();
  useLanguage();
  crumbs = crumbs.length > 1 && SUITE_CRUMBS.has(crumbs[0].label) ? crumbs.slice(1) : crumbs;
  return (
    <section>
      {crumbs.length > 0 && (crumbSlot ? createPortal(
        <nav className="breadcrumbs" aria-label={t("Breadcrumb")}>
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {i > 0 && <span className="sep">›</span>}
              {c.href && i < crumbs.length - 1 ? <a href={c.href}>{t(brandLabel(c.label))}</a> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{t(brandLabel(c.label))}</span>}
            </span>
          ))}
        </nav>,
        crumbSlot,
      ) : (
        <nav className="breadcrumbs" aria-label={t("Breadcrumb")}>
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`}>
              {i > 0 && <span className="sep">›</span>}
              {c.href && i < crumbs.length - 1 ? <a href={c.href}>{t(brandLabel(c.label))}</a> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{t(brandLabel(c.label))}</span>}
            </span>
          ))}
        </nav>
      ))}
      <header className="view-header">
        <div>
          <h1>{t(title)}</h1>
          {subtitle && <p className="view-subtitle">{typeof subtitle === 'string' ? t(subtitle) : subtitle}</p>}
        </div>
        {actions && <div className="view-actions">{actions}</div>}
      </header>
      <ClientFilterNote />
      {children}
    </section>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h2>{t(title)}</h2>
      {children && <p>{children}</p>}
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}

/** The action bar under the top bar shows the page breadcrumb (see App). */
function useCrumbSlot(): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('actionbar-crumbs')), []);
  return slot;
}

/** Shown on every page while a global client filter is active. */
export function ClientFilterNote() {
  const filter = useClientFilter();
  if (!filter) return null;
  return (
    <p className="client-filter-note">
      {t("Lists show only")} <strong>{filter.name}</strong>. <button className="link-button" onClick={() => setClientFilter(null)}>{t("Show all clients")}</button>
    </p>
  );
}
