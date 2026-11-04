import { useEffect, useState } from 'react';
import { api } from './api';
import { t, useLanguage } from './i18n';
import { navigate } from './router';

const KEY = 'agera.tour';
const EVENT = 'agera:tour';

interface Stop { title: string; text: string; route: string | null; missing?: string }

export function startTour(): void {
  sessionStorage.setItem(KEY, '0');
  window.dispatchEvent(new Event(EVENT));
}

/** Golden Thread: one client followed across suites, using the organisation's real records. */
async function buildStops(): Promise<Stop[]> {
  const [clients, deals, rooms, agreements, visits, orders] = await Promise.all([
    api.clients().catch(() => []), api.deals().catch(() => []), api.rooms().catch(() => []), api.agreements().catch(() => []),
    api.visits().then((p) => p.items, () => []), api.fieldOrders().catch(() => []),
  ]);
  const client = clients.find((c) => c.status === 'active') ?? clients[0];
  const of = <T extends { clientId?: string | null }>(list: T[]) => list.find((x) => client && x.clientId === client.id) ?? list[0];
  const deal = of(deals);
  const room = of(rooms);
  const agreement = of(agreements);
  const visit = visits[0];
  const order = of(orders as { id: string; clientId?: string | null }[]);
  const stop = (title: string, text: string, route: string | null, missing: string): Stop => (route ? { title, text, route } : { title, text, route: null, missing });
  return [
    stop('1. The client', 'Every thread starts with a client dossier: master data, credit status, contacts, health score and financials, all from the database.', client ? `/nexus/clients/${client.id}` : null, 'No client yet: add one with + New › Client.'),
    stop('2. The deal', 'Commercial work is tracked as a deal in Nexus, moving from lead to operations hand-off.', deal ? `/nexus/deals/${deal.id}` : '/nexus/pipeline', 'No deal yet.'),
    stop('3. The client room', 'The client works with you in a client room: documents with versions, the mutual action plan and comments.', room ? `/nexus/client-rooms/${room.id}` : null, 'No client room yet.'),
    stop('4. The agreement', 'The agreement goes through the approval chain and is signed by the client with a simple electronic signature.', agreement ? `/nexus/agreements/${agreement.id}` : null, 'No agreement yet.'),
    stop('5. In the store', 'RetailPower executes on the shelf: store visits with checklists, planogram scores and out-of-stock items.', visit ? `/retailpower/store-visits/${visit.id}` : '/retailpower/store-visits', ''),
    stop('6. The field order', 'Orders taken in the store use the client price list and flow from draft to delivery.', order ? `/retailpower/orders/${order.id}` : '/retailpower/orders', ''),
    stop('7. Invoice and prognosis', 'Symphony closes the loop: invoices, credit control and the live prognosis.', '/symphony/invoices', ''),
    stop('8. Oversight', 'Account health, approvals, automations and reports give HQ the overview across all clients.', '/symphony/health', ''),
  ];
}

export function GoldenThreadTour() {
  useLanguage();
  const [index, setIndex] = useState<number | null>(() => (sessionStorage.getItem(KEY) === null ? null : Number(sessionStorage.getItem(KEY))));
  const [stops, setStops] = useState<Stop[] | null>(null);
  useEffect(() => {
    const sync = () => setIndex(sessionStorage.getItem(KEY) === null ? null : Number(sessionStorage.getItem(KEY)));
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  useEffect(() => {
    if (index !== null && !stops) void buildStops().then(setStops);
  }, [index, stops]);
  useEffect(() => {
    const route = index !== null ? stops?.[index]?.route : null;
    if (route) navigate(route);
  }, [index, stops]);
  if (index === null) return null;
  const go = (i: number | null) => {
    if (i === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, String(i));
    setIndex(i);
  };
  const s = stops?.[index];
  return (
    <aside className="tour-card" role="dialog" aria-label={t("Golden Thread tour")}>
      <span className="tour-step">{t("Golden Thread ·")} {index + 1} / {stops?.length ?? 8}</span>
      {!s ? <p>{t('Loading…')}</p> : (
        <>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
          {s.missing && <p className="tour-missing">{s.missing}</p>}
        </>
      )}
      <div className="tour-actions">
        <button onClick={() => go(null)}>{t('Close')}</button>
        <span>
          {index > 0 && <button onClick={() => go(index - 1)}>{t('Previous')}</button>}{' '}
          {stops && index < stops.length - 1 ? <button className="primary" onClick={() => go(index + 1)}>{t('Next')}</button> : <button className="primary" onClick={() => go(null)}>{t('Finish')}</button>}
        </span>
      </div>
    </aside>
  );
}
