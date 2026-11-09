import { api } from '../api';
import { ViewFrame } from '../Layout';
import { useLoad } from '../ui';
import { t, live } from '../i18n';

const SUITE = live(() => ({ label: t("Symphony"), href: '#/symphony' }));

interface Integration { name: string; what: string; today: string; needs: string }

/** Outside systems that are planned but not connected. Nothing here pretends to be live. */
const INTEGRATIONS: Integration[] = live(() => ([
  { name: 'ERP (SAP / Exact / AFAS)', what: t("Sync clients, credit limits, invoices and payments with your ERP as the single source of truth."), today: t("Clients, credit limits and invoices are kept in Agera itself; the ERP ID field on a client is stored for later matching."), needs: t("ERP type, API endpoint and a service account.") },
  { name: 'Receipt scanner (OCR)', what: t("Photograph receipts in the field and turn them into expense lines automatically."), today: t("Visit photos can be uploaded; there is no expense module yet."), needs: t("An EU-hosted OCR service and the expense rules.") },
  { name: 'Voice commands', what: t("Speak a visit report or a command in the field app."), today: t("Voice events can be queued through the Nexus command API but are not processed."), needs: t("An EU-hosted speech-to-text service.") },
  { name: 'Qualified e-signature (eIDAS)', what: t("Advanced or qualified signatures with a trust service provider."), today: t("Clients sign with a simple electronic signature (drawn signature, login e-mail, time and document fingerprint)."), needs: t("A trust service provider contract (e.g. a Dutch/EU QTSP) and API keys.") },
]));

function MailRelayCard() {
  const { data, error } = useLoad(() => api.mailStatus());
  const state = !data ? null : data.connected ? 'connected' : data.configured ? 'unreachable' : 'off';
  return (
    <div className="card-panel integration">
      <div className="panel-head">
        <h2>{t("E-mail (SMTP relay, EU)")}</h2>
        {state === 'connected' ? <span className="connected">{t("Connected")}</span> : <span className="not-connected">{state === 'unreachable' ? t("Not reachable") : t("Not connected")}</span>}
      </div>
      <p>{t("Send e-mail from Agera (for example from + New › E-mail) through your own mail server or a European SMTP provider. Sent mail is recorded in the activity log.")}</p>
      {error && <p className="muted">{error}</p>}
      {state === 'connected' && <p className="muted"><strong>{t("Server:")}</strong> {data?.host}:{data?.port} · <strong>{t("Sender:")}</strong> {data?.from}</p>}
      {state === 'unreachable' && <p className="muted"><strong>{t("Server:")}</strong> {data?.host}:{data?.port} — {t("the server did not accept the connection or login.")} {data?.error}</p>}
      {state === 'off' && (
        <>
          <p className="muted"><strong>{t("Today:")}</strong> {t("+ New › E-mail opens your own e-mail program with the message filled in.")}</p>
          <p className="muted"><strong>{t("Needed to connect:")}</strong> {t("Your administrator fills in SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM in .env.production on the server and runs ./deploy.sh.")}</p>
        </>
      )}
    </div>
  );
}

export function IntegrationsView() {
  return (
    <ViewFrame title={t("External systems")} subtitle={t("Outside systems Agera can connect to, and whether they are connected.")} crumbs={[SUITE, { label: t("External systems") }]}>
      <div className="integration-grid">
        <MailRelayCard />
        {INTEGRATIONS.map((i) => (
          <div key={i.name} className="card-panel integration">
            <div className="panel-head">
              <h2>{i.name}</h2>
              <span className="not-connected">{t("Not connected")}</span>
            </div>
            <p>{i.what}</p>
            <p className="muted"><strong>{t("Today:")}</strong> {i.today}</p>
            <p className="muted"><strong>{t("Needed to connect:")}</strong> {i.needs}</p>
            <button className="secondary" disabled title={t("Ask your Agera administrator to set up this connection")}>{t("Connect (not available yet)")}</button>
          </div>
        ))}
      </div>
    </ViewFrame>
  );
}
