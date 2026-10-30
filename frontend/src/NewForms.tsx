import { type FormEvent, useEffect, useState } from 'react';
import { api, type Agreement, type CreatedApiKey, type Store, type WorkOrder } from './api';
import { clientName, invalidateDirectory, useClients, useUsers } from './directory';
import { navigate } from './router';
import type { NewDefaults, NewKind } from './shell';
import { Drawer, ErrorText, Field, FormActions, useAction } from './ui';

export interface NewItem {
  kind: NewKind;
  label: string;
  group: 'Nexus' | 'RetailPower' | 'Symphony';
  platformAdminOnly?: boolean;
}

export const NEW_ITEMS: NewItem[] = [
  { kind: 'agreement', label: 'Agreement', group: 'Nexus' },
  { kind: 'client_room', label: 'Client room', group: 'Nexus' },
  { kind: 'financial_plan', label: 'Financial plan', group: 'Nexus' },
  { kind: 'work_order', label: 'Work order', group: 'RetailPower' },
  { kind: 'store_visit', label: 'Store visit', group: 'RetailPower' },
  { kind: 'store', label: 'Store', group: 'RetailPower' },
  { kind: 'organisation', label: 'Organisation', group: 'Symphony', platformAdminOnly: true },
  { kind: 'integration_key', label: 'Integration key', group: 'Symphony', platformAdminOnly: true },
];

interface FormProps {
  defaults: NewDefaults;
  onDone: (route?: string, message?: string) => void;
  onCancel: () => void;
}

function useSubmit(onDone: FormProps['onDone']) {
  const action = useAction();
  const submit = (e: FormEvent, work: () => Promise<{ route?: string; message: string } | undefined>) => {
    e.preventDefault();
    void action.run(work).then((result) => {
      if (result) {
        invalidateDirectory();
        onDone(result.route, result.message);
      }
    });
  };
  return { ...action, submit };
}

function WorkOrderForm({ onDone, onCancel }: FormProps) {
  const users = useUsers();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const w = await api.createWorkOrder({ title: title.trim(), description: description.trim() || undefined, assignedUserId: assignee || null });
          return { route: `/retailpower/work-orders/${w.id}`, message: `Work order “${w.title}” created` };
        })
      }
    >
      <Field label="Title">
        <input required maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 shelf reset MediaMarkt" autoFocus />
      </Field>
      <Field label="Description" hint="Optional: what needs to be done">
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Assign to" hint="Optional: you can also assign it later">
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Not assigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Create work order" onCancel={onCancel} />
    </form>
  );
}

function todayAtNine(): string {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

function StoreVisitForm({ defaults, onDone, onCancel }: FormProps) {
  const users = useUsers();
  const [stores, setStores] = useState<Store[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [storeId, setStoreId] = useState(defaults.storeId ?? '');
  const [date, setDate] = useState(todayAtNine);
  const [rep, setRep] = useState('');
  const [workOrderId, setWorkOrderId] = useState(defaults.workOrderId ?? '');
  const [notes, setNotes] = useState('');
  const { busy, error, submit } = useSubmit(onDone);
  useEffect(() => {
    api.stores().then((p) => setStores(p.items), () => undefined);
    api.workOrders().then((p) => setWorkOrders(p.items.filter((w) => w.status === 'PENDING' || w.status === 'IN_PROGRESS')), () => undefined);
  }, []);
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const v = await api.createVisit({
            storeId,
            visitDate: new Date(date).toISOString(),
            fieldRepId: rep || null,
            workOrderId: workOrderId || null,
            notes: notes.trim() || undefined,
          });
          return { route: `/retailpower/store-visits/${v.id}`, message: 'Store visit planned' };
        })
      }
    >
      <Field label="Store">
        <select required value={storeId} onChange={(e) => setStoreId(e.target.value)} autoFocus>
          <option value="">Choose a store…</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.storeCode})</option>
          ))}
        </select>
      </Field>
      <Field label="Date and time">
        <input type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Field representative">
        <select value={rep} onChange={(e) => setRep(e.target.value)}>
          <option value="">Me</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Linked work order" hint="Optional">
        <select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
          <option value="">None</option>
          {workOrders.map((w) => (
            <option key={w.id} value={w.id}>{w.title}</option>
          ))}
        </select>
      </Field>
      <Field label="Notes" hint="Optional: instructions for the visit">
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Plan visit" onCancel={onCancel} />
    </form>
  );
}

function StoreForm({ onDone, onCancel }: FormProps) {
  const [form, setForm] = useState({ storeCode: '', name: '', address: '', postalCode: '', city: '', country: 'Netherlands' });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const s = await api.createStore({
            storeCode: form.storeCode.trim(),
            name: form.name.trim(),
            address: form.address.trim() || undefined,
            postalCode: form.postalCode.trim() || undefined,
            city: form.city.trim() || undefined,
            country: form.country.trim() || undefined,
          });
          return { route: `/retailpower/stores/${s.id}`, message: `Store “${s.name}” added` };
        })
      }
    >
      <Field label="Store name">
        <input required maxLength={200} value={form.name} onChange={set('name')} placeholder="e.g. MediaMarkt Utrecht" autoFocus />
      </Field>
      <Field label="Store code" hint="Your own unique code for this store">
        <input required maxLength={50} value={form.storeCode} onChange={set('storeCode')} placeholder="e.g. MM-UTR-01" />
      </Field>
      <Field label="Street and number">
        <input maxLength={255} value={form.address} onChange={set('address')} />
      </Field>
      <div className="field-row">
        <Field label="Postal code">
          <input maxLength={20} value={form.postalCode} onChange={set('postalCode')} />
        </Field>
        <Field label="City">
          <input maxLength={100} value={form.city} onChange={set('city')} />
        </Field>
      </div>
      <Field label="Country">
        <input maxLength={100} value={form.country} onChange={set('country')} />
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Add store" onCancel={onCancel} />
    </form>
  );
}

function NoClients({ onCancel, onPlan }: { onCancel: () => void; onPlan: () => void }) {
  return (
    <div>
      <p>There are no clients yet. A client is registered together with its first financial plan.</p>
      <div className="form-actions">
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={onPlan}>New financial plan</button>
      </div>
    </div>
  );
}

function AgreementForm({ defaults, onDone, onCancel, onSwitch }: FormProps & { onSwitch: (kind: NewKind) => void }) {
  const clients = useClients();
  const [clientId, setClientId] = useState(defaults.clientId ?? '');
  const [title, setTitle] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const { busy, error, submit } = useSubmit(onDone);
  if (clients.length === 0) return <NoClients onCancel={onCancel} onPlan={() => onSwitch('financial_plan')} />;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const a = await api.createAgreement({ clientId, title: title.trim(), documentUrl: documentUrl.trim() });
          return { route: `/nexus/agreements/${a.id}`, message: `Agreement “${a.title}” created, awaiting approval` };
        })
      }
    >
      <Field label="Client">
        <select required value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus>
          <option value="">Choose a client…</option>
          {clients.map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Retail activation 2026" />
      </Field>
      <Field label="Document link" hint="Web address (https://…) of the agreement document">
        <input required type="url" maxLength={500} value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://" />
      </Field>
      <p className="muted">New agreements start as “Awaiting approval”.</p>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Create agreement" onCancel={onCancel} />
    </form>
  );
}

function ClientRoomForm({ defaults, onDone, onCancel, onSwitch }: FormProps & { onSwitch: (kind: NewKind) => void }) {
  const clients = useClients();
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [clientId, setClientId] = useState(defaults.clientId ?? '');
  const [roomName, setRoomName] = useState('');
  const [agreementId, setAgreementId] = useState(defaults.agreementId ?? '');
  const { busy, error, submit } = useSubmit(onDone);
  useEffect(() => {
    api.agreements().then(setAgreements, () => undefined);
  }, []);
  if (clients.length === 0) return <NoClients onCancel={onCancel} onPlan={() => onSwitch('financial_plan')} />;
  const forClient = agreements.filter((a) => a.clientId === clientId && a.status !== 'expired');
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const r = await api.createRoom({ clientId, roomName: roomName.trim(), agreementId: agreementId || null });
          return { route: `/nexus/client-rooms/${r.id}`, message: `Client room “${r.roomName}” opened` };
        })
      }
    >
      <Field label="Client">
        <select required value={clientId} onChange={(e) => (setClientId(e.target.value), setAgreementId(''))} autoFocus>
          <option value="">Choose a client…</option>
          {clients.map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Room name">
        <input required maxLength={150} value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="e.g. Retail activation 2026" />
      </Field>
      <Field label="Linked agreement" hint={clientId ? 'Optional' : 'Choose a client first'}>
        <select value={agreementId} onChange={(e) => setAgreementId(e.target.value)} disabled={!clientId}>
          <option value="">None</option>
          {forClient.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </Field>
      {clientId && <p className="muted">Contacts of {clientName(clients, clientId)} with a client login can open this room.</p>}
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Open client room" onCancel={onCancel} />
    </form>
  );
}

function FinancialPlanForm({ defaults, onDone, onCancel }: FormProps) {
  const clients = useClients();
  const year = new Date().getFullYear();
  const [modelName, setModelName] = useState('');
  const [fiscalYear, setFiscalYear] = useState(String(year));
  const [client, setClient] = useState(defaults.clientId ?? '');
  const [newClient, setNewClient] = useState('');
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          let metadata: Record<string, unknown> | undefined;
          if (client === 'new') metadata = { clientId: crypto.randomUUID(), companyName: newClient.trim() };
          else if (client) metadata = { clientId: client, companyName: clientName(clients, client) };
          const m = await api.createModel({ modelName: modelName.trim(), fiscalYear: Number(fiscalYear), metadata });
          return { route: `/nexus/financial-plans/${m.id}`, message: `Financial plan “${m.modelName}” created as draft` };
        })
      }
    >
      <Field label="Plan name">
        <input required maxLength={100} value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="e.g. TechNova 2027 contract" autoFocus />
      </Field>
      <Field label="Fiscal year">
        <select value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
          {[year - 1, year, year + 1, year + 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </Field>
      <Field label="Client">
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">No client (internal plan)</option>
          {clients.map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.name}</option>
          ))}
          <option value="new">New client…</option>
        </select>
      </Field>
      {client === 'new' && (
        <Field label="Client company name">
          <input required maxLength={200} value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="e.g. TechNova Electronics B.V." />
        </Field>
      )}
      <p className="muted">The plan starts as a draft. Add plan lines in the plan, then approve it.</p>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Create plan" onCancel={onCancel} />
    </form>
  );
}

function OrganisationForm({ onDone, onCancel }: FormProps) {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const { busy, error, submit } = useSubmit(onDone);
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const t = await api.createTenant({ name: name.trim(), domain: domain.trim().toLowerCase() });
          return { route: `/symphony/organisations?created=${encodeURIComponent(t.name)}`, message: `Organisation “${t.name}” created` };
        })
      }
    >
      <Field label="Organisation name">
        <input required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="E-mail domain" hint="People who sign in with an address at this domain belong to this organisation, e.g. technova.nl">
        <input required maxLength={255} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Create organisation" onCancel={onCancel} />
    </form>
  );
}

function IntegrationKeyForm({ onDone, onCancel }: FormProps) {
  const [name, setName] = useState('');
  const [expires, setExpires] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const { busy, error, run } = useAction();
  if (created) {
    return (
      <div>
        <p><strong>Copy this key now.</strong> For security it is shown only once.</p>
        <code className="secret">{created.key}</code>
        <div className="form-actions">
          <button className="secondary" onClick={() => void navigator.clipboard?.writeText(created.key)}>Copy key</button>
          <button className="primary" onClick={() => onDone(`/symphony/integrations?created=${created.id}`, `Integration key “${created.name}” created`)}>Done</button>
        </div>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api.createApiKey({ name: name.trim(), expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : undefined })).then(
          (k) => k && setCreated(k),
        );
      }}
    >
      <Field label="Name" hint="Which portal or system uses this key">
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Retailer portal" autoFocus />
      </Field>
      <Field label="Expires on" hint="Optional; leave empty for no expiry date">
        <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </Field>
      <p className="muted">Integration keys can only read work orders, store visits and reports of this organisation.</p>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Create key" onCancel={onCancel} />
    </form>
  );
}

const TITLES: Record<NewKind, string> = {
  work_order: 'New work order',
  store_visit: 'New store visit',
  store: 'New store',
  agreement: 'New agreement',
  client_room: 'New client room',
  financial_plan: 'New financial plan',
  organisation: 'New organisation',
  integration_key: 'New integration key',
};

export function NewDrawer({
  kind,
  defaults,
  onClose,
  onSwitch,
  notify,
}: {
  kind: NewKind;
  defaults: NewDefaults;
  onClose: () => void;
  onSwitch: (kind: NewKind) => void;
  notify: (message: string) => void;
}) {
  const onDone = (route?: string, message?: string) => {
    onClose();
    if (message) notify(message);
    if (route) navigate(route);
  };
  const props = { defaults, onDone, onCancel: onClose };
  return (
    <Drawer title={TITLES[kind]} onClose={onClose}>
      {kind === 'work_order' && <WorkOrderForm {...props} />}
      {kind === 'store_visit' && <StoreVisitForm {...props} />}
      {kind === 'store' && <StoreForm {...props} />}
      {kind === 'agreement' && <AgreementForm {...props} onSwitch={onSwitch} />}
      {kind === 'client_room' && <ClientRoomForm {...props} onSwitch={onSwitch} />}
      {kind === 'financial_plan' && <FinancialPlanForm {...props} />}
      {kind === 'organisation' && <OrganisationForm {...props} />}
      {kind === 'integration_key' && <IntegrationKeyForm {...props} />}
    </Drawer>
  );
}
