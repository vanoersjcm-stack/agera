import { useEffect, useState } from 'react';
import { api, type Tenant } from './api';
import { keycloak, userRoles } from './auth';
import { AnomaliesView } from './AnomaliesView';
import { CommandBar } from './CommandBar';
import { DsrView } from './DsrView';
import { FinancialsView } from './FinancialsView';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    api.tenant().then(setTenant, () => setTenant(null));
  }, []);

  return (
    <div className="shell">
      <nav className="topbar">
        <span className="brand">Agera Nexus</span>
        <a href="#/financials" className={route.path === '/financials' ? 'active' : undefined}>Financials</a>
        <a href="#/dsr" className={route.path === '/dsr' ? 'active' : undefined}>DSR activity</a>
        <a href="#/anomalies" className={route.path === '/anomalies' ? 'active' : undefined}>Anomalies</a>
        <CommandBar contextRoute={route.path} />
        <span className="who">
          {tenant?.name} · {keycloak.tokenParsed?.email as string | undefined} · {userRoles().filter((r) => !r.startsWith('default-')).join(', ')}
        </span>
        <button className="link" onClick={() => void keycloak.logout({ redirectUri: window.location.origin + '/' })}>Log out</button>
      </nav>
      <main>
        {route.path === '/dsr' ? <DsrView route={route} /> : route.path === '/anomalies' ? <AnomaliesView /> : <FinancialsView route={route} />}
      </main>
    </div>
  );
}
