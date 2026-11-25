import type { UserContext } from './context';
import { t, useLanguage } from './i18n';
import { navigate } from './router';
import { navFor, type SuiteId, suitesFor } from './suites';

/** A path is offered only when the role's suites and menus include it. */
export function agenda(user: UserContext): string | null {
  return ['/symphony/agenda', '/nexus/agenda', '/retailpower/agenda'].find((p) => allowed(user, p)) ?? null;
}

export function allowed(user: UserContext, path: string): boolean {
  const suite = path.split('?')[0].split('/')[1] as SuiteId;
  const base = path.split('?')[0];
  return suitesFor(user).some((s) => s.id === suite) && navFor(suite, user).some((i) => i.path === base);
}

function Icon({ d }: { d: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

const ICONS = {
  back: 'M15 18l-6-6 6-6',
  agenda: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  thirdParties: 'M3 21V7l9-4 9 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
};

/** Cross-cutting tools on the top bar: Back, then Agenda, Third parties and Print & Scan as far as the role may open them. */
export function TopbarTools({ user }: { user: UserContext }) {
  useLanguage();
  const internal = user.scope !== 'external' && user.jobRole !== 'CLIENT_VIEWER';
  const thirdParties = ['/symphony/third-parties', '/nexus/third-parties'].find((p) => allowed(user, p));
  const tools = !internal ? [] : [
    agenda(user) && { href: agenda(user)!, label: t("Agenda"), icon: ICONS.agenda },
    thirdParties && { href: thirdParties, label: t("Third parties"), icon: ICONS.thirdParties },
    allowed(user, '/nexus/print') && { href: '/nexus/print', label: t("Print & Scan"), icon: ICONS.print },
  ].filter((x): x is { href: string; label: string; icon: string } => !!x);
  return (
    <nav className="topbar-tools" aria-label={t("Tools")}>
      <button type="button" className="topbar-tool has-tip" data-tip={t("Go back to the previous page")} aria-label={t("Back")} onClick={() => window.history.back()}><Icon d={ICONS.back} /></button>
      {tools.map((tool) => (
        <button type="button" key={tool.href} className="topbar-tool has-tip" data-tip={tool.label} aria-label={tool.label} onClick={() => navigate(tool.href)}><Icon d={tool.icon} /></button>
      ))}
    </nav>
  );
}
