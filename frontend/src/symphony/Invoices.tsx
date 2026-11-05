import { matchesClient, useClientFilter } from '../clientFilter';
import { api, type Invoice, type InvoiceStatus } from '../api';
import { formatDate } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { money } from '../nexus/Clients';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { ErrorText, FilterChips, includesText, Loading, SearchInput, StatusBadge, useAction, useLoad } from '../ui';
import { t, tf } from '../i18n';

export const INVOICE_STATUS: Record<InvoiceStatus, string> = { draft: 'Draft', issued: 'Sent', paid: 'Paid', cancelled: 'Cancelled' };
const NEXT: Record<InvoiceStatus, { status: InvoiceStatus; label: string }[]> = {
  draft: [{ status: 'issued', label: t("Mark as sent") }, { status: 'cancelled', label: t("Cancel") }],
  issued: [{ status: 'paid', label: t("Mark as paid") }, { status: 'cancelled', label: t("Cancel") }],
  paid: [],
  cancelled: [],
};

function badge(i: Invoice) {
  return i.overdue ? <StatusBadge status="not_compliant" label={t("Overdue")} /> : <StatusBadge status={i.status === 'paid' ? 'active' : i.status === 'cancelled' ? 'archived' : 'pending'} label={INVOICE_STATUS[i.status]} />;
}

/** Invoice table with status actions; shared by Symphony › Invoices and the client dossier. */
export function InvoiceTable({ invoices, showClient, onChanged }: { invoices: Invoice[]; showClient: boolean; onChanged: () => void }) {
  const { notify } = useShell();
  const action = useAction();
  const change = (i: Invoice, status: InvoiceStatus) => {
    if (status === 'cancelled' && !window.confirm(tf("Cancel invoice {n}?", { n: i.invoiceNumber }))) return;
    void action.run(() => api.setInvoiceStatus(i.id, status)).then((r) => r && (notify(tf("Invoice {n}: {status}", { n: i.invoiceNumber, status: INVOICE_STATUS[status].toLowerCase() })), onChanged()));
  };
  return (
    <>
      <ErrorText error={action.error} />
      <table className="grid">
        <thead>
          <tr>
            <th>{t("Invoice")}</th>
            {showClient && <th>{t("Client")}</th>}
            <th>{t("Date")}</th>
            <th>{t("Due")}</th>
            <th>{t("Status")}</th>
            <th className="num">{t("Excl. VAT")}</th>
            <th className="num">{t("Total")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td>{i.invoiceNumber}{i.description && <div className="muted small">{i.description}</div>}</td>
              {showClient && <td><a href={`#/symphony/clients/${i.clientId}?tab=invoices`}>{i.clientName}</a></td>}
              <td>{formatDate(i.issueDate)}</td>
              <td>{i.dueDate ? formatDate(i.dueDate) : '—'}</td>
              <td>{badge(i)}{i.paidAt && <div className="muted small">{formatDate(i.paidAt)}</div>}</td>
              <td className="num">{money(i.amountExclVat)}</td>
              <td className="num">{money(i.totalAmount)}</td>
              <td className="row-actions">
                {NEXT[i.status].map((n) => (
                  <button key={n.status} className={n.status === 'cancelled' ? 'link-button danger' : 'link-button'} disabled={action.busy} onClick={() => change(i, n.status)}>
                    {n.label}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function InvoicesView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const status = route.params.get('status') ?? 'all';
  const q = route.params.get('q') ?? '';
  const { data, error, reload } = useLoad(() => api.invoices());
  const items = data ?? [];
  const overdue = items.filter((i) => i.overdue);
  const clientFilter = useClientFilter();
  const filtered = items.filter((x) => matchesClient(clientFilter, x.clientId)).filter((i) => (status === 'all' || (status === 'overdue' ? i.overdue : i.status === status)) && includesText([i.invoiceNumber, i.clientName, i.description], q));
  const year = new Date().getFullYear();
  const paidThisYear = items.filter((i) => i.status === 'paid' && i.paidAt?.startsWith(String(year))).reduce((s, i) => s + Number(i.amountExclVat), 0);
  const open = items.filter((i) => i.status === 'issued').reduce((s, i) => s + Number(i.totalAmount), 0);
  return (
    <ViewFrame title={t("Invoices")} crumbs={[{ label: t("Symphony"), href: '#/symphony' }, { label: t("Invoices") }]} actions={<button className="primary" onClick={() => openNew('invoice')}>{t("+ New invoice")}</button>}>
      <div className="tiles">
        <div className="tile"><strong>{money(paidThisYear)}</strong><span>{t("Invoiced and paid in")} {year}  {t("(excl. VAT)")}</span></div>
        <div className="tile"><strong>{money(open)}</strong><span>{t("Sent, not yet paid")}</span></div>
        <div className="tile"><strong className={overdue.length ? 'bad' : undefined}>{overdue.length}</strong><span>{t("Overdue invoices")}</span></div>
      </div>
      <div className="list-toolbar">
        <FilterChips
          value={status}
          onChange={(v) => navigate(withParams(route, { status: v === 'all' ? null : v }))}
          chips={[
            { value: 'all', label: t("All"), count: items.length },
            { value: 'draft', label: t("Draft"), count: items.filter((i) => i.status === 'draft').length },
            { value: 'issued', label: t("Sent"), count: items.filter((i) => i.status === 'issued').length },
            { value: 'overdue', label: t("Overdue"), count: overdue.length },
            { value: 'paid', label: t("Paid"), count: items.filter((i) => i.status === 'paid').length },
          ]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder={t("Filter by number, client or description")} />
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && (
        <EmptyState title={items.length === 0 ? t("No invoices yet") : t("No invoices match this filter")} action={<button className="primary" onClick={() => openNew('invoice')}>{t("+ New invoice")}</button>}>
          {t("Record invoices here until the ERP connection exists; paid invoices feed the prognosis.")}</EmptyState>
      )}
      {filtered.length > 0 && <InvoiceTable invoices={filtered} showClient onChanged={reload} />}
    </ViewFrame>
  );
}

export function ClientInvoicesPanel({ clientId }: { clientId: string }) {
  const { openNew } = useShell();
  const { data, error, reload } = useLoad(() => api.clientInvoices(clientId), [clientId]);
  const items = data ?? [];
  const paid = items.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amountExclVat), 0);
  const open = items.filter((i) => i.status === 'issued').reduce((s, i) => s + Number(i.totalAmount), 0);
  return (
    <div className="card-panel">
      <div className="panel-head">
        <h2>{t("Invoices")}</h2>
        <button className="primary" onClick={() => openNew('invoice', { clientId })}>{t("+ New invoice")}</button>
      </div>
      {!data && <Loading error={error} />}
      {data && items.length === 0 && <p className="muted">{t("No invoices recorded for this client yet.")}</p>}
      {items.length > 0 && (
        <>
          <p className="muted">{t("Paid:")} {money(paid)}  {t("excl. VAT · Open:")} {money(open)}</p>
          <InvoiceTable invoices={items} showClient={false} onChanged={reload} />
        </>
      )}
    </div>
  );
}
