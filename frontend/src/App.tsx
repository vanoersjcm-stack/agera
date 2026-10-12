import { useEffect, useState } from 'react';
import { type Tenant, api } from './api';
import { AnomaliesView } from './AnomaliesView';
import { AssistantTip, AssistantToggle, useAssistant } from './Assistant';
import { keycloak } from './auth';
import { CommandBar } from './CommandBar';
import { userContext } from './context';
import { DashboardView } from './DashboardView';
import { DsrView } from './DsrView';
import { FinancialsView } from './FinancialsView';
import { EmptyState, ViewFrame } from './Layout';
import { type Route, useRoute } from './router';
import { SalesRoomsView } from './SalesRoomsView';

const INTERNAL_NAV = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/financials', label: 'Financials' },
  { path: '/dsr', label: 'DSR activity' },
  { path: '/rooms', label: 'Sales rooms' },
  { path: '/anomalies', label: 'Anomalies' },
];

const EXTERNAL_NAV = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/rooms', label: 'My sales rooms' },
];

function View({ route, external }: { route: Route; external: boolean }) {
  const nav = external ? EXTERNAL_NAV : INTERNAL_NAV;
  if (!nav.some((n) => n.path === route.path)) {
    return (
      <ViewFrame title="Page not available" crumbs={[{ label: 'Not available' }]}>
        <EmptyState title={external ? 'This page is not part of the client portal' : 'This page does not exist'}>
          The address <code>#{route.path}</code> has no view for your account.
        </EmptyState>
      </ViewFrame>
    );
  }
  switch (route.path) {
    case '/financials':
      return <FinancialsView route={route} />;
    case '/dsr':
      return <DsrView route={route} />;
    case '/rooms':
      return <SalesRoomsView external={external} />;
    case '/anomalies':
      return <AnomaliesView />;
    default:
      return <DashboardView external={external} />;
  }
}

export function App() {
  const route = useRoute();
  const context = userContext();
  const external = context.scope === 'external';
  const assistant = useAssistant();
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    api.tenant().then(setTenant, () => setTenant(null));
  }, []);

  return (
    <div className="shell">
      <nav className="topbar">
        <span className="brand">Agera Nexus</span>
        <span className={`context-badge ${context.scope}`} title="Your access context">{context.label}</span>
        {(external ? EXTERNAL_NAV : INTERNAL_NAV).map((n) => (
          <a key={n.path} href={`#${n.path}`} className={route.path === n.path ? 'active' : undefined}>
            {n.label}
          </a>
        ))}
        {!external && <CommandBar contextRoute={route.path} />}
        <span className="who">
          {tenant?.name ?? '…'} · {keycloak.tokenParsed?.email as string | undefined}
        </span>
        <AssistantToggle enabled={assistant.enabled} onToggle={assistant.toggle} />
        <button className="link" onClick={() => void keycloak.logout({ redirectUri: window.location.origin + '/' })}>Log out</button>
      </nav>
      <main>
        <AssistantTip scope={context.scope} path={route.path} assistant={assistant} />
        <View route={route} external={external} />
      </main>
    </div>
  );
}
