import { type FormEvent, useState } from 'react';
import { api, type Client, type ClientRecord, type Contact, type RoomActivity } from '../api';
import { invalidateDirectory } from '../directory';
import { ACTIVITY_TYPE, AGREEMENT_STATUS, CLIENT_STATUS, formatDate, formatDateTime, PLAN_STATUS, ROOM_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { DetailList, Drawer, ErrorText, Field, FilterChips, FormActions, includesText, Loading, SearchInput, StatusBadge, Tabs, useAction, useLoad } from '../ui';

const SUITE = { label: 'Nexus', href: '#/nexus' };
const LIST = { label: 'Clients', href: '#/nexus/clients' };

export function money(value: string | number): string {
  return new Intl.NumberFormat('en-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(value));
}

export function contactName(c: Pick<Contact, 'firstName' | 'lastName'>): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ');
}

export function ClientsView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const status = route.params.get('status') ?? 'active';
  const q = route.params.get('q') ?? '';
  const { data, error } = useLoad(() => api.clients());
  const items = data ?? [];
  const count = (s: string) => items.filter((c) => c.status === s).length;
  const filtered = items.filter((c) => (status === 'all' || c.status === status) && includesText([c.name, c.legalName, c.city, c.vatNumber], q));
  return (
    <ViewFrame title="Clients" crumbs={[SUITE, { label: 'Clients' }]} actions={<button className="primary" onClick={() => openNew('client')}>+ New client</button>}>
      <div className="list-toolbar">
        <FilterChips
          value={status}
          onChange={(v) => navigate(withParams(route, { status: v === 'active' ? null : v }))}
          chips={[
            { value: 'active', label: 'Active', count: count('active') },
            { value: 'archived', label: 'Archived', count: count('archived') },
            { value: 'all', label: 'All', count: items.length },
          ]}
        />
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v }))} placeholder="Filter by name, city or VAT number" />
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && (
        <EmptyState
          title={items.length === 0 ? 'No clients yet' : 'No clients match this filter'}
          action={<button className="primary" onClick={() => openNew('client')}>+ New client</button>}
        />
      )}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>Client</th>
              <th>City</th>
              <th>Status</th>
              <th className="num">Active agreements</th>
              <th className="num">Active client rooms</th>
              <th className="num">Contract value</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => navigate(`/nexus/clients/${c.id}`)}>
                <td>
                  <a href={`#/nexus/clients/${c.id}`}>{c.name}</a>
                  {c.legalName && c.legalName !== c.name && <div className="muted small">{c.legalName}</div>}
                </td>
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
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const opt = (v: string) => v.trim() || null;
    void run(() =>
      api.updateClient(client.id, { name: form.name.trim(), legalName: opt(form.legalName), vatNumber: opt(form.vatNumber), city: opt(form.city), country: opt(form.country) }),
    ).then((r) => r && onSaved());
  };
  return (
    <Drawer title="Edit client" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Company name"><input required maxLength={200} value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Legal name"><input maxLength={200} value={form.legalName} onChange={set('legalName')} /></Field>
        <Field label="VAT number"><input maxLength={50} value={form.vatNumber} onChange={set('vatNumber')} /></Field>
        <Field label="City"><input maxLength={100} value={form.city} onChange={set('city')} /></Field>
        <Field label="Country"><input maxLength={100} value={form.country} onChange={set('country')} /></Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Save changes" onCancel={onClose} />
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
    <Drawer title="Edit contact" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="First name"><input required maxLength={100} value={form.firstName} onChange={set('firstName')} autoFocus /></Field>
        <Field label="Last name"><input maxLength={100} value={form.lastName} onChange={set('lastName')} /></Field>
        <Field label="Job title"><input maxLength={150} value={form.roleTitle} onChange={set('roleTitle')} /></Field>
        <Field label="E-mail"><input type="email" maxLength={255} value={form.email} onChange={set('email')} /></Field>
        <Field label="Phone"><input type="tel" maxLength={50} value={form.phone} onChange={set('phone')} /></Field>
        <label className="checkbox">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Primary contact for this client
        </label>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Save changes" onCancel={onClose} />
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
  if (roomIds.length === 0) return <p className="muted">Activity appears here once the client has a client room.</p>;
  if (!data) return <Loading error={error} />;
  if (data.length === 0) return <p className="muted">No client activity yet.</p>;
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

export function ClientDossier({ id, route }: { id: string; route: Route }) {
  const { openNew, notify } = useShell();
  const { data, error, reload } = useLoad(() => api.client(id), [id]);
  const [editing, setEditing] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const action = useAction();
  const tab = route.params.get('tab') ?? 'overview';
  if (!data) {
    return (
      <ViewFrame title="Client" crumbs={[SUITE, LIST, { label: 'Loading…' }]}>
        <Loading error={error} />
      </ViewFrame>
    );
  }
  const { client, contacts, agreements, rooms, plans } = data;
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
    if (archive && !window.confirm(`Archive ${client.name}? It will no longer be offered when creating agreements or client rooms.`)) return;
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
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <button className="secondary" disabled={action.busy} onClick={toggleArchive}>{client.status === 'active' ? 'Archive' : 'Reactivate'}</button>
          {client.status === 'active' && <button className="primary" onClick={() => openNew('agreement', { clientId: id })}>+ New agreement</button>}
        </>
      }
    >
      <ErrorText error={action.error} />
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'contacts', label: `Contacts (${contacts.length})` },
          { id: 'agreements', label: `Agreements (${agreements.length})` },
          { id: 'rooms', label: `Client rooms (${rooms.length})` },
          { id: 'financials', label: `Financial plans (${plans.length})` },
          { id: 'activity', label: 'Activity' },
        ]}
        active={tab}
        onChange={(t) => navigate(withParams(route, { tab: t === 'overview' ? null : t }))}
      />
      {tab === 'overview' && (
        <>
          <div className="tiles">
            <div className="tile"><strong>{client.activeAgreements}</strong><span>Active agreements</span></div>
            <div className="tile"><strong>{client.activeRooms}</strong><span>Active client rooms</span></div>
            <div className="tile"><strong>{money(client.contractValue)}</strong><span>Contract value</span></div>
          </div>
          <DetailList
            items={[
              ['Company name', client.name],
              ['Legal name', client.legalName ?? '—'],
              ['VAT number', client.vatNumber ?? '—'],
              ['City', client.city ?? '—'],
              ['Country', client.country ?? '—'],
              ['Primary contact', primary ? `${contactName(primary)}${primary.email ? ` · ${primary.email}` : ''}` : '—'],
              ['Client since', formatDate(client.createdAt)],
            ]}
          />
        </>
      )}
      {tab === 'contacts' && (
        <div className="card-panel">
          <div className="panel-head">
            <h2>Contacts</h2>
            {client.status === 'active' && <button className="primary" onClick={() => openNew('contact', { clientId: id })}>+ New contact</button>}
          </div>
          {contacts.length === 0 ? (
            <p className="muted">No contacts yet.</p>
          ) : (
            <table className="grid">
              <thead>
                <tr><th>Name</th><th>Job title</th><th>E-mail</th><th>Phone</th><th /></tr>
              </thead>
              <tbody>
                {contacts.map((k) => (
                  <tr key={k.id}>
                    <td>{contactName(k)} {k.isPrimary && <StatusBadge status="active" label="Primary" />}</td>
                    <td>{k.roleTitle ?? '—'}</td>
                    <td>{k.email ? <a href={`mailto:${k.email}`}>{k.email}</a> : '—'}</td>
                    <td>{k.phone ? <a href={`tel:${k.phone}`}>{k.phone}</a> : '—'}</td>
                    <td><button className="link-button" onClick={() => setEditContact(k)}>Edit</button></td>
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
            <h2>Agreements</h2>
            {client.status === 'active' && <button className="primary" onClick={() => openNew('agreement', { clientId: id })}>+ New agreement</button>}
          </div>
          {agreements.length === 0 ? <p className="muted">No agreements yet.</p> : (
            <table className="grid clickable">
              <thead><tr><th>Title</th><th>Status</th><th>Created</th></tr></thead>
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
            <h2>Client rooms</h2>
            {client.status === 'active' && <button className="primary" onClick={() => openNew('client_room', { clientId: id })}>+ New client room</button>}
          </div>
          {rooms.length === 0 ? <p className="muted">No client rooms yet.</p> : (
            <table className="grid clickable">
              <thead><tr><th>Room</th><th>Status</th><th>Opened</th></tr></thead>
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
            <h2>Financial plans</h2>
            <button className="primary" onClick={() => openNew('financial_plan', { clientId: id })}>+ New financial plan</button>
          </div>
          {plans.length === 0 ? <p className="muted">No financial plans yet.</p> : (
            <table className="grid clickable">
              <thead><tr><th>Plan</th><th>Fiscal year</th><th>Status</th></tr></thead>
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
      {tab === 'activity' && (
        <div className="card-panel">
          <h2>Client activity in rooms</h2>
          <ClientActivity record={data} />
        </div>
      )}
      {editing && <EditClientDrawer client={client} onClose={() => setEditing(false)} onSaved={() => saved('Client updated')} />}
      {editContact && <EditContactDrawer contact={editContact} onClose={() => setEditContact(null)} onSaved={() => saved('Contact updated')} />}
    </ViewFrame>
  );
}
