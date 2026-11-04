import { ViewFrame } from '../Layout';
import { t } from '../i18n';

const SUITE = { label: t("Symphony"), href: '#/symphony' };

interface Integration { name: string; what: string; today: string; needs: string }

/** Outside systems that are planned but not connected. Nothing here pretends to be live. */
const INTEGRATIONS: Integration[] = [
  { name: 'ERP (SAP / Exact / AFAS)', what: t("Sync clients, credit limits, invoices and payments with your ERP as the single source of truth."), today: t("Clients, credit limits and invoices are kept in Agera itself; the ERP ID field on a client is stored for later matching."), needs: t("ERP type, API endpoint and a service account.") },
  { name: 'E-mail (Microsoft 365 / Gmail)', what: t("Show the mail thread with a client in the client dossier and log sent mail as activity."), today: t("Use the client room comments and activity stream."), needs: t("Mail provider, an app registration and consent for the mailboxes.") },
  { name: 'Receipt scanner (OCR)', what: t("Photograph receipts in the field and turn them into expense lines automatically."), today: t("Visit photos can be uploaded; there is no expense module yet."), needs: t("An EU-hosted OCR service and the expense rules.") },
  { name: 'Voice commands', what: t("Speak a visit report or a command in the field app."), today: t("Voice events can be queued through the Nexus command API but are not processed."), needs: t("An EU-hosted speech-to-text service.") },
  { name: 'Qualified e-signature (eIDAS)', what: t("Advanced or qualified signatures with a trust service provider."), today: t("Clients sign with a simple electronic signature (drawn signature, login e-mail, time and document fingerprint)."), needs: t("A trust service provider contract (e.g. a Dutch/EU QTSP) and API keys.") },
];

export function IntegrationsView() {
  return (
    <ViewFrame title={t("External systems")} subtitle={t("Outside systems Agera can connect to. None of them is connected yet.")} crumbs={[SUITE, { label: t("External systems") }]}>
      <div className="integration-grid">
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
