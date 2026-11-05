import { type FormEvent, type ReactNode, useState } from 'react';
import { api, type Client, type ClientRecord, type Invoice, type Contact, type CreditStatus, type RoomActivity } from '../api';
import { invalidateDirectory, useUsers } from '../directory';
import { ClientInvoicesPanel } from '../symphony/Invoices';
import { HealthBadge } from '../symphony/Workflow';
import { ACTIVITY_TYPE, AGREEMENT_STATUS, CLIENT_STATUS, CREDIT_STATUS, formatDate, formatDateTime, PLAN_STATUS, ROOM_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, Drawer, ErrorText, Field, FilterChips, FormActions, includesText, Loading, SearchInput, StatusBadge, Tabs, useAction, useLoad } from '../ui';
import { t as tr, tf } from '../i18n';

const SUITE = { label: tr("Nexus"), href: '#/nexus' };
const LIST = { label: tr("Clients"), href: '#/nexus/clients' };

export function money(value: string | number): string {
  return new Intl.NumberFormat('en-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value));
}

export function contactName(c: Pick<Contact, 'firstName' | 'lastName'>): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ');
}

export function ClientsView({ route }: { route: Route }) {
  const base = `/${route.segments[0] === 'symphony' ? 'symphony' : 'nexus'}/clients`;
  const { openNew } = useShell();
  const status = route.params.get('status') ?? 'active';
  const q = route.params.get('q') ?? '';
  const { data, error } = useLoad(() => api.clients());
  const items = data ?? [];
  const count = (s: string) => items.filter((c) => c.status === s).length;
  const filtered = items.filter((c) => (status === 'all' || c.status === status) && includesText([c.name, c.legalName, c.city, c.vatNumber, c.erpId, c.kvkNumber, c.accountManagerName], q));
  return (
    <ViewFrame title={tr("Clients")} crumbs={[SUITE, { label: tr("Clients") }]} actions={<button className="primary" onClick={() => openNew('client')}>{tr("+ New client")}</button>}>
      <div className="list-toolbar">
        <FilterChips
          value={status}
          onChange={(v) => navigate(withParams(route, { status: v === 'active' ? null : v }))}
          chips={[
            { value: 'active', label: tr("Active"), count: count('active') },
            { value: 'archived', label: tr("Archived"), count: count('archived') },
            { value: 'all', label: tr("All"), count: items.length },
          ]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder={tr("Filter by name, city, ERP ID, KvK or account manager")} />
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && (
        <EmptyState
          title={items.length === 0 ? tr("No clients yet") : tr("No clients match this filter")}
          action={<button className="primary" onClick={() => openNew('client')}>{tr("+ New client")}</button>}
        />
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>{tr("Client")}</th>
              <th>{tr("ERP ID")}</th>
              <th>{tr("Account manager")}</th>
              <th>{tr("City")}</th>
              <th>{tr("Status")}</th>
              <th className="num">{tr("Active agreements")}</th>
              <th className="num">{tr("Active client rooms")}</th>
              <th className="num">{tr("Contract value")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => navigate(`${base}/${c.id}`)}>
                <td>
                  <a href={`#${base}/${c.id}`}>{c.name}</a>
                  {c.legalName && c.legalName !== c.name && <div className="muted small">{c.legalName}</div>}
                </td>
                <td>{c.erpId ?? <span className="muted">—</span>}</td>
                <td>{c.accountManagerName ?? <span className="muted">{tr("Not assigned")}</span>}</td>
                <td>{c.city ?? '—'}</td>
                <td><StatusBadge status={c.status} label={CLIENT_STATUS[c.status]} /></td>
                <td className="num">{c.activeAgreements}</td>
                <td className="num">{c.activeRooms}</td>
                <td className="num">{money(c.contractValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

function EditClientDrawer({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: client.name,
    legalName: client.legalName ?? '',
    vatNumber: client.vatNumber ?? '',
    city: client.city ?? '',
    country: client.country ?? '',
    kvkNumber: client.kvkNumber ?? '',
    sector: client.sector ?? '',
    address: client.address ?? '',
    erpId: client.erpId ?? '',
    paymentTerms: client.paymentTerms,
    creditLimit: client.creditLimit,
    creditStatus: client.creditStatus,
    accountManagerId: client.accountManagerId ?? '',
  });
  const users = useUsers();
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const opt = (v: string) => v.trim() || null;
    void run(() =>
      api.updateClient(client.id, {
        name: form.name.trim(),
        legalName: opt(form.legalName),
        vatNumber: opt(form.vatNumber),
        city: opt(form.city),
        country: opt(form.country),
        kvkNumber: opt(form.kvkNumber),
        sector: opt(form.sector),
        address: opt(form.address),
        erpId: opt(form.erpId),
        paymentTerms: form.paymentTerms.trim() || 'Net 30 days',
        creditLimit: form.creditLimit || '0',
        creditStatus: form.creditStatus,
        accountManagerId: form.accountManagerId || null,
      }),
    ).then((r) => r && onSaved());
  };
  return (
    <Drawer title={tr("Edit client")} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={tr("Company name")}><input required maxLength={200} value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label={tr("Legal name")}><input maxLength={200} value={form.legalName} onChange={set('legalName')} /></Field>
        <Field label={tr("VAT number")}><input maxLength={50} value={form.vatNumber} onChange={set('vatNumber')} /></Field>
        <Field label={tr("City")}><input maxLength={100} value={form.city} onChange={set('city')} /></Field>
        <Field label={tr("Country")}><input maxLength={100} value={form.country} onChange={set('country')} /></Field>
        <Field label={tr("Street and number")}><input maxLength={255} value={form.address} onChange={set('address')} /></Field>
        <Field label={tr("Chamber of Commerce (KvK) number")}><input maxLength={20} value={form.kvkNumber} onChange={set('kvkNumber')} /></Field>
        <Field label={tr("Sector")}><input maxLength={100} value={form.sector} onChange={set('sector')} placeholder={tr("e.g. Consumer electronics")} /></Field>
        <Field label={tr("ERP customer number")} hint={tr("Customer number in your ERP system; must be unique")}><input maxLength={50} value={form.erpId} onChange={set('erpId')} /></Field>
        <Field label={tr("Account manager")}>
          <select value={form.accountManagerId} onChange={set('accountManagerId')}>
            <option value="">{tr("Not assigned")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label={tr("Payment terms")}><input required maxLength={100} value={form.paymentTerms} onChange={set('paymentTerms')} /></Field>
        <div className="field-row">
          <Field label={tr("Credit limit (EUR)")}><input type="number" min={0} step="0.01" value={form.creditLimit} onChange={set('creditLimit')} /></Field>
          <Field label={tr("Credit status")}>
            <select value={form.creditStatus} onChange={set('creditStatus')}>
              {(Object.keys(CREDIT_STATUS) as CreditStatus[]).map((s) => <option key={s} value={s}>{CREDIT_STATUS[s]}</option>)}
            </select>
          </Field>
        </div>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel={tr("Save changes")} onCancel={onClose} />
      </form>
    </Drawer>
  );
}

function EditContactDrawer({ contact, onClose, onSaved }: { contact: Contact; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    firstName: contact.firstName,
    lastName: contact.lastName ?? '',
    roleTitle: contact.roleTitle ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
  });
  const [isPrimary, setIsPrimary] = useState(contact.isPrimary);
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const opt = (v: string) => v.trim() || null;
    void run(() =>
      api.updateContact(contact.clientId, contact.id, {
        firstName: form.firstName.trim(),
        lastName: opt(form.lastName),
        roleTitle: opt(form.roleTitle),
        email: opt(form.email),
        phone: opt(form.phone),
        isPrimary,
      }),
    ).then((r) => r && onSaved());
  };
  return (
    <Drawer title={tr("Edit contact")} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label={tr("First name")}><input required maxLength={100} value={form.firstName} onChange={set('firstName')} autoFocus /></Field>
        <Field label={tr("Last name")}><input maxLength={100} value={form.lastName} onChange={set('lastName')} /></Field>
        <Field label={tr("Job title")}><input maxLength={150} value={form.roleTitle} onChange={set('roleTitle')} /></Field>
        <Field label={tr("E-mail")}><input type="email" maxLength={255} value={form.email} onChange={set('email')} /></Field>
        <Field label={tr("Phone")}><input type="tel" maxLength={50} value={form.phone} onChange={set('phone')} /></Field>
        <label className="checkbox">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />  {tr("Primary contact for this client")}</label>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel={tr("Save changes")} onCancel={onClose} />
      </form>
    </Drawer>
  );
}

function ClientActivity({ record }: { record: ClientRecord }) {
  const roomIds = record.rooms.map((r) => r.id);
  const { data, error } = useLoad(
    async () => (await Promise.all(roomIds.map((id) => api.activities(id)))).flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
    [roomIds.join(',')],
  );
  if (roomIds.length === 0) return <p className="muted">{tr("Activity appears here once the client has a client room.")}</p>;
  if (!data) return <Loading error={error} />;
  if (data.length === 0) return <p className="muted">{tr("No client activity yet.")}</p>;
  const roomName = (a: RoomActivity) => record.rooms.find((r) => r.id === a.dsrId)?.roomName ?? '';
  return (
    <ol className="timeline">
      {data.map((a) => (
        <li key={a.id}>
          <time>{formatDateTime(a.createdAt)}</time>
          <span>
            {ACTIVITY_TYPE[a.activityType] ?? a.activityType} · <a href={`#/nexus/client-rooms/${a.dsrId}`}>{roomName(a)}</a>
            {typeof a.details.text === 'string' && <span className="comment-text">{a.details.text}</span>}
            {typeof a.details.reason === 'string' && a.details.reason && <span className="comment-text">{a.details.reason}</span>}
          </span>
          <span className="muted">{a.stakeholderEmail}</span>
        </li>
      ))}
    </ol>
  );
}

function InfoCard({ title, items }: { title: string; items: [string, ReactNode][] }) {
  return (
    <div className="info-card">
      <h3>{title}</h3>
      <dl>
        {items.map(([k, v], i) => (
          <div key={`${k}-${i}`}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RunRateKpis({ contractValue, invoices }: { contractValue: number; invoices: Invoice[] }) {
  const year = new Date().getFullYear();
  const thisYear = invoices.filter((i) => i.status !== 'draft' && i.status !== 'cancelled' && new Date(i.issueDate).getFullYear() === year);
  const invoiced = thisYear.reduce((sum, i) => sum + Number(i.amountExclVat), 0);
  const open = invoices.filter((i) => i.status === 'issued').reduce((sum, i) => sum + Number(i.amountExclVat), 0);
  const expected = contractValue * ((new Date().getMonth() + 1) / 12);
  return (
    <div className="kpi-grid">
      <div className="kpi kpi-indigo"><span>{tr("Contract value (annual)")}</span><strong>{money(contractValue)}</strong></div>
      <div className="kpi kpi-emerald"><span>{tr("Invoiced in")} {year}  {tr("(excl. VAT)")}</span><strong>{money(invoiced)}</strong></div>
      <div className="kpi kpi-blue"><span>{tr("Open invoices")}</span><strong>{money(open)}</strong></div>
      <div className="kpi kpi-purple"><span>{tr("Variance vs. run-rate to date")}</span><strong>{invoiced - expected >= 0 ? '+' : '−'}{money(Math.abs(invoiced - expected))}</strong></div>
    </div>
  );
}

export function ClientDossier({ id, route }: { id: string; route: Route }) {
  const { openNew, notify } = useShell();
  const { data, error, reload } = useLoad(() => api.client(id), [id]);
  const [editing, setEditing] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const action = useAction();
  const invoices = useLoad(() => api.clientInvoices(id), [id]);
  const tab = route.params.get('tab') ?? 'overview';
  if (!data) {
    return (
      <ViewFrame title={tr("Client")} crumbs={[SUITE, LIST, { label: tr("Loading…") }]}>
        <Loading error={error} />
      </ViewFrame>
    );
  }
  const { client, contacts, agreements, rooms, plans, stores } = data;
  const primary = contacts.find((k) => k.isPrimary);
  const saved = (message: string) => {
    setEditing(false);
    setEditContact(null);
    invalidateDirectory();
    notify(message);
    reload();
  };
  const toggleArchive = () => {
    const archive = client.status === 'active';
    if (archive && !window.confirm(tf("Archive {name}? It will no longer be offered when creating agreements or client rooms.", { name: client.name }))) return;
    void action.run(() => api.updateClient(id, { status: archive ? 'archived' : 'active' })).then((r) => r && saved(archive ? 'Client archived' : 'Client reactivated'));
  };
  return (
    <ViewFrame
      title={client.name}
      subtitle={[client.legalName !== client.name ? client.legalName : null, client.city].filter(Boolean).join(' · ') || undefined}
      crumbs={[SUITE, LIST, { label: client.name }]}
      actions={
        <>
          <StatusBadge status={client.status} label={CLIENT_STATUS[client.status]} />
          <button className="secondary" onClick={() => setEditing(true)}>{tr("Edit")}</button>
          <button className="secondary" disabled={action.busy} onClick={toggleArchive}>{client.status === 'active' ? tr("Archive") : tr("Reactivate")}</button>
          {client.status === 'active' && <button className="primary" onClick={() => openNew('agreement', { clientId: id })}>{tr("+ New agreement")}</button>}
        </>
      }
    >
      <div className="dossier-banner">
        <div className="dossier-avatar" aria-hidden>{client.name.slice(0, 1).toUpperCase()}</div>
        <div className="dossier-facts">
          <span><small>{tr("KvK")}</small><b className="mono">{client.kvkNumber ?? '—'}</b></span>
          <span><small>{tr("ERP ID")}</small><b className="mono">{client.erpId ?? '—'}</b></span>
          <span><small>{tr("Account manager")}</small><b>{client.accountManagerName ?? tr("Not assigned")}</b></span>
          <span><small>{tr("Credit status")}</small><b>{CREDIT_STATUS[client.creditStatus]}</b></span>
          <span><small>{tr("Account health")}</small><b><HealthBadge clientId={id} /></b></span>
        </div>
        <span className="topbar-spacer" />
        {rooms.length > 0 && <button className="secondary" onClick={() => navigate(`/nexus/client-rooms/${(rooms.find((x) => x.status === 'active') ?? rooms[0]).id}`)}>{tr("Open linked client room")}</button>}
        <button className="secondary" onClick={() => navigate('/nexus/clients')}>{tr("Back to list")}</button>
      </div>
      <ErrorText error={action.error} />
      <Tabs
        tabs={[
          { id: 'overview', label: tr("Master data") },
          { id: 'contacts', label: `${tr("Contacts")} (${contacts.length})` },
          { id: 'agreements', label: `${tr("Agreements")} (${agreements.length})` },
          { id: 'rooms', label: `${tr("Client rooms")} (${rooms.length})` },
          { id: 'financials', label: `${tr("Financial plans")} (${plans.length})` },
          { id: 'stores', label: `${tr("Stores")} (${stores.length})` },
          { id: 'invoices', label: tr("Financials & run-rate") },
          { id: 'activity', label: tr("Activity") },
        ]}
        active={tab}
        onChange={(t) => navigate(withParams(route, { tab: t === 'overview' ? null : t }))}
      />
      {tab === 'overview' && (
        <div className="info-grid">
          <InfoCard
            title={tr("Company details")}
            items={[
              ['Company name', client.name],
              ['Legal name', client.legalName ?? '—'],
              ['Chamber of Commerce (KvK)', <span className="mono">{client.kvkNumber ?? '—'}</span>],
              ['VAT number', <span className="mono">{client.vatNumber ?? '—'}</span>],
              ['Sector', client.sector ?? '—'],
              ['Address', [client.address, client.city, client.country].filter(Boolean).join(', ') || '—'],
              ['Client since', formatDate(client.createdAt)],
            ]}
          />
          <InfoCard
            title={tr("Credit & payment terms")}
            items={[
              ['Payment terms', client.paymentTerms],
              ['Credit limit', <span className="mono">{money(client.creditLimit)}</span>],
              ['Credit status', CREDIT_STATUS[client.creditStatus]],
              ['ERP customer number', <span className="mono">{client.erpId ?? '—'}</span>],
              ['Account manager', client.accountManagerName ?? 'Not assigned'],
            ]}
          />
          <InfoCard
            title={tr("Contacts")}
            items={
              contacts.length === 0
                ? [['Contacts', 'No contacts yet']]
                : [...contacts]
                    .sort((x, y) => (x.id === primary?.id ? -1 : y.id === primary?.id ? 1 : 0))
                    .slice(0, 6)
                    .map((k): [string, ReactNode] => [
                      k.id === primary?.id ? 'Primary contact' : k.roleTitle || 'Contact',
                      <>{contactName(k)}{k.email && <div className="muted small">{k.email}</div>}</>,
                    ])
            }
          />
        </div>
      )}
      {tab === 'contacts' && (
        <div className="card-panel">
          <div className="panel-head">
            <h2>{tr("Contacts")}</h2>
            {client.status === 'active' && <button className="primary" onClick={() => openNew('contact', { clientId: id })}>{tr("+ New contact")}</button>}
          </div>
          {contacts.length === 0 ? (
            <p className="muted">{tr("No contacts yet.")}</p>
          ) : (
            <table className="grid">
              <thead>
                <tr><th>{tr("Name")}</th><th>{tr("Job title")}</th><th>{tr("E-mail")}</th><th>{tr("Phone")}</th><th /></tr>
              </thead>
              <tbody>
                {contacts.map((k) => (
                  <tr key={k.id}>
                    <td>{contactName(k)} {k.isPrimary && <StatusBadge status="active" label={tr("Primary")} />}</td>
                    <td>{k.roleTitle ?? '—'}</td>
                    <td>{k.email ? <a href={`mailto:${k.email}`}>{k.email}</a> : '—'}</td>
                    <td>{k.phone ? <a href={`tel:${k.phone}`}>{k.phone}</a> : '—'}</td>
                    <td><button className="link-button" onClick={() => setEditContact(k)}>{tr("Edit")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === 'agreements' && (
        <div className="card-panel">
          <div className="panel-head">
            <h2>{tr("Agreements")}</h2>
            {client.status === 'active' && <button className="primary" onClick={() => openNew('agreement', { clientId: id })}>{tr("+ New agreement")}</button>}
          </div>
          {agreements.length === 0 ? <p className="muted">{tr("No agreements yet.")}</p> : (
            <table className="grid clickable">
              <thead><tr><th>{tr("Title")}</th><th>{tr("Status")}</th><th>{tr("Created")}</th></tr></thead>
              <tbody>
                {agreements.map((a) => (
                  <tr key={a.id} onClick={() => navigate(`/nexus/agreements/${a.id}`)}>
                    <td><a href={`#/nexus/agreements/${a.id}`}>{a.title}</a></td>
                    <td><StatusBadge status={a.status} label={AGREEMENT_STATUS[a.status]} /></td>
                    <td>{formatDate(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === 'rooms' && (
        <div className="card-panel">
          <div className="panel-head">
            <h2>{tr("Client rooms")}</h2>
            {client.status === 'active' && <button className="primary" onClick={() => openNew('client_room', { clientId: id })}>{tr("+ New client room")}</button>}
          </div>
          {rooms.length === 0 ? <p className="muted">{tr("No client rooms yet.")}</p> : (
            <table className="grid clickable">
              <thead><tr><th>{tr("Room")}</th><th>{tr("Status")}</th><th>{tr("Opened")}</th></tr></thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/nexus/client-rooms/${r.id}`)}>
                    <td><a href={`#/nexus/client-rooms/${r.id}`}>{r.roomName}</a></td>
                    <td><StatusBadge status={r.status} label={ROOM_STATUS[r.status]} /></td>
                    <td>{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === 'financials' && (
        <div className="card-panel">
          <div className="panel-head">
            <h2>{tr("Financial plans")}</h2>
            <button className="primary" onClick={() => openNew('financial_plan', { clientId: id })}>{tr("+ New financial plan")}</button>
          </div>
          {plans.length === 0 ? <p className="muted">{tr("No financial plans yet.")}</p> : (
            <table className="grid clickable">
              <thead><tr><th>{tr("Plan")}</th><th>{tr("Fiscal year")}</th><th>{tr("Status")}</th></tr></thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/nexus/financial-plans/${p.id}`)}>
                    <td><a href={`#/nexus/financial-plans/${p.id}`}>{p.modelName}</a></td>
                    <td>{p.fiscalYear}</td>
                    <td><StatusBadge status={p.status} label={PLAN_STATUS[p.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === 'invoices' && (
        <>
          <RunRateKpis contractValue={Number(client.contractValue) || 0} invoices={invoices.data ?? []} />
          <ClientInvoicesPanel clientId={id} />
        </>
      )}
      {tab === 'stores' && (
        <div className="card-panel">
          <div className="panel-head">
            <h2>{tr("Stores of this client")}</h2>
          </div>
          {stores.length === 0 ? <p className="muted">{tr("No stores linked yet. Link a store to this client from the store's Edit panel in RetailPower.")}</p> : (
            <table className="grid clickable">
              <thead><tr><th>{tr("Store")}</th><th>{tr("Code")}</th><th>{tr("City")}</th><th>{tr("Status")}</th></tr></thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.id} onClick={() => navigate(`/retailpower/stores/${s.id}`)}>
                    <td><a href={`#/retailpower/stores/${s.id}`}>{s.name}</a></td>
                    <td>{s.storeCode}</td>
                    <td>{s.city ?? '—'}</td>
                    <td><StatusBadge status={s.status} label={s.status === 'active' ? tr("Open") : tr("Closed")} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {tab === 'activity' && (
        <div className="card-panel">
          <h2>{tr("Client activity in rooms")}</h2>
          <ClientActivity record={data} />
        </div>
      )}
      {editing && <EditClientDrawer client={client} onClose={() => setEditing(false)} onSaved={() => saved('Client updated')} />}
      {editContact && <EditContactDrawer contact={editContact} onClose={() => setEditContact(null)} onSaved={() => saved('Contact updated')} />}
    </ViewFrame>
  );
}
