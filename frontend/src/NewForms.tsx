import { NewPriceListForm, NewTemplateForm } from './nexus/Commercial';
import { NewSurveyForm } from './nexus/Surveys';
import { NewExceptionForm } from './symphony/Workflow';
import { NewAuditRoundForm, NewFieldOrderForm, NewPlanogramForm, NewProductForm } from './retailpower/Field';
import { type FormEvent, useEffect, useState } from 'react';
import { api, type Agreement, type CreatedApiKey, type Store, type WorkOrder } from './api';
import { activeClients, clientName, invalidateDirectory, useClients, useUsers } from './directory';
import { navigate } from './router';
import type { NewDefaults, NewKind } from './shell';
import { Drawer, ErrorText, Field, FormActions, useAction } from './ui';
import { t as tr, tf } from './i18n';

export interface NewItem {
  kind: NewKind;
  label: string;
  group: 'Nexus' | 'RetailPower' | 'Symphony';
  platformAdminOnly?: boolean;
}

export const NEW_ITEMS: NewItem[] = [
  { kind: 'deal', label: tr("Deal"), group: 'Nexus' },
  { kind: 'client', label: tr("Client"), group: 'Nexus' },
  { kind: 'contact', label: tr("Contact"), group: 'Nexus' },
  { kind: 'agreement', label: tr("Agreement"), group: 'Nexus' },
  { kind: 'client_room', label: tr("Client room"), group: 'Nexus' },
  { kind: 'exception', label: tr("Exception"), group: 'Nexus' },
  { kind: 'price_list', label: tr("Price list"), group: 'Nexus' },
  { kind: 'document_template', label: tr("Document template"), group: 'Nexus' },
  { kind: 'financial_plan', label: tr("Financial plan"), group: 'Nexus' },
  { kind: 'survey', label: tr("Survey"), group: 'Nexus' },
  { kind: 'work_order', label: tr("Work order"), group: 'RetailPower' },
  { kind: 'store_visit', label: tr("Store visit"), group: 'RetailPower' },
  { kind: 'store', label: tr("Store"), group: 'RetailPower' },
  { kind: 'field_order', label: tr("Field order"), group: 'RetailPower' },
  { kind: 'audit_round', label: tr("Audit round"), group: 'RetailPower' },
  { kind: 'product', label: tr("Product"), group: 'RetailPower' },
  { kind: 'planogram', label: tr("Planogram"), group: 'RetailPower' },
  { kind: 'invoice', label: tr("Invoice"), group: 'Symphony' },
  { kind: 'organisation', label: tr("Organisation"), group: 'Symphony', platformAdminOnly: true },
  { kind: 'integration_key', label: tr("Integration key"), group: 'Symphony', platformAdminOnly: true },
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
      <Field label={tr("Title")}>
        <input required maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("e.g. Q3 shelf reset MediaMarkt")} autoFocus />
      </Field>
      <Field label={tr("Description")} hint={tr("Optional: what needs to be done")}>
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={tr("Assign to")} hint={tr("Optional: you can also assign it later")}>
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">{tr("Not assigned")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Create work order")} onCancel={onCancel} />
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
      <Field label={tr("Store")}>
        <select required value={storeId} onChange={(e) => setStoreId(e.target.value)} autoFocus>
          <option value="">{tr("Choose a store…")}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.storeCode})</option>
          ))}
        </select>
      </Field>
      <Field label={tr("Date and time")}>
        <input type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label={tr("Field representative")}>
        <select value={rep} onChange={(e) => setRep(e.target.value)}>
          <option value="">{tr("Me")}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </Field>
      <Field label={tr("Linked work order")} hint={tr("Optional")}>
        <select value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
          <option value="">{tr("None")}</option>
          {workOrders.map((w) => (
            <option key={w.id} value={w.id}>{w.title}</option>
          ))}
        </select>
      </Field>
      <Field label={tr("Notes")} hint={tr("Optional: instructions for the visit")}>
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Plan visit")} onCancel={onCancel} />
    </form>
  );
}

function StoreForm({ onDone, onCancel }: FormProps) {
  const [form, setForm] = useState({ storeCode: '', name: '', address: '', postalCode: '', city: '', country: 'Netherlands', clientId: '' });
  const storeClients = activeClients(useClients());
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
            clientId: form.clientId || null,
          });
          return { route: `/retailpower/stores/${s.id}`, message: `Store “${s.name}” added` };
        })
      }
    >
      <Field label={tr("Store name")}>
        <input required maxLength={200} value={form.name} onChange={set('name')} placeholder={tr("e.g. MediaMarkt Utrecht")} autoFocus />
      </Field>
      <Field label={tr("Store code")} hint={tr("Your own unique code for this store")}>
        <input required maxLength={50} value={form.storeCode} onChange={set('storeCode')} placeholder={tr("e.g. MM-UTR-01")} />
      </Field>
      <Field label={tr("Street and number")}>
        <input maxLength={255} value={form.address} onChange={set('address')} />
      </Field>
      <div className="field-row">
        <Field label={tr("Postal code")}>
          <input maxLength={20} value={form.postalCode} onChange={set('postalCode')} />
        </Field>
        <Field label={tr("City")}>
          <input maxLength={100} value={form.city} onChange={set('city')} />
        </Field>
      </div>
      <Field label={tr("Country")}>
        <input maxLength={100} value={form.country} onChange={set('country')} />
      </Field>
      <Field label={tr("Client")} hint={tr("Optional: the brand or client whose products this store carries")}>
        <select value={form.clientId} onChange={set('clientId')}>
          <option value="">{tr("No client")}</option>
          {storeClients.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
        </select>
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Add store")} onCancel={onCancel} />
    </form>
  );
}

function NoClients({ onCancel, onNewClient }: { onCancel: () => void; onNewClient: () => void }) {
  return (
    <div>
      <p>{tr("There are no clients yet. Add the client company first.")}</p>
      <div className="form-actions">
        <button className="secondary" onClick={onCancel}>{tr("Cancel")}</button>
        <button className="primary" onClick={onNewClient}>{tr("+ New client")}</button>
      </div>
    </div>
  );
}

function AgreementForm({ defaults, onDone, onCancel, onSwitch }: FormProps & { onSwitch: (kind: NewKind) => void }) {
  const clients = useClients();
  const [clientId, setClientId] = useState(defaults.clientId ?? '');
  const [title, setTitle] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [runRate, setRunRate] = useState({ annualValue: '', churnRisk: '', endDate: '' });
  const { busy, error, submit } = useSubmit(onDone);
  if (activeClients(clients).length === 0) return <NoClients onCancel={onCancel} onNewClient={() => onSwitch('client')} />;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const a = await api.createAgreement({
            clientId,
            title: title.trim(),
            documentUrl: documentUrl.trim(),
            annualValue: runRate.annualValue || '0',
            churnRisk: runRate.churnRisk || '0',
            endDate: runRate.endDate || null,
          });
          return { route: `/nexus/agreements/${a.id}`, message: `Agreement “${a.title}” created, awaiting approval` };
        })
      }
    >
      <Field label={tr("Client")}>
        <select required value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus>
          <option value="">{tr("Choose a client…")}</option>
          {activeClients(clients).map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label={tr("Title")}>
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("e.g. Retail activation 2026")} />
      </Field>
      <Field label={tr("Document link")} hint={tr("Web address (https://…) of the agreement document")}>
        <input required type="url" maxLength={500} value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://" />
      </Field>
      <div className="field-row">
        <Field label={tr("Annual value (EUR)")}><input type="number" min={0} step="0.01" value={runRate.annualValue} onChange={(e) => setRunRate({ ...runRate, annualValue: e.target.value })} /></Field>
        <Field label={tr("Churn risk (EUR)")} hint={tr("Part that may not renew")}><input type="number" min={0} step="0.01" value={runRate.churnRisk} onChange={(e) => setRunRate({ ...runRate, churnRisk: e.target.value })} /></Field>
      </div>
      <Field label={tr("End date")}><input type="date" value={runRate.endDate} onChange={(e) => setRunRate({ ...runRate, endDate: e.target.value })} /></Field>
      <p className="muted">{tr("New agreements start as “Awaiting approval”.")}</p>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Create agreement")} onCancel={onCancel} />
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
  if (activeClients(clients).length === 0) return <NoClients onCancel={onCancel} onNewClient={() => onSwitch('client')} />;
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
      <Field label={tr("Client")}>
        <select required value={clientId} onChange={(e) => (setClientId(e.target.value), setAgreementId(''))} autoFocus>
          <option value="">{tr("Choose a client…")}</option>
          {activeClients(clients).map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label={tr("Room name")}>
        <input required maxLength={150} value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder={tr("e.g. Retail activation 2026")} />
      </Field>
      <Field label={tr("Linked agreement")} hint={clientId ? tr("Optional") : tr("Choose a client first")}>
        <select value={agreementId} onChange={(e) => setAgreementId(e.target.value)} disabled={!clientId}>
          <option value="">{tr("None")}</option>
          {forClient.map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      </Field>
      {clientId && <p className="muted">{tr("Contacts of")} {clientName(clients, clientId)}  {tr("with a client login can open this room.")}</p>}
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Open client room")} onCancel={onCancel} />
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
          if (client === 'new') {
            const created = await api.createClient({ name: newClient.trim(), legalName: null, vatNumber: null, city: null, country: null });
            metadata = { clientId: created.id, companyName: created.name };
          } else if (client) metadata = { clientId: client, companyName: clientName(clients, client) };
          const m = await api.createModel({ modelName: modelName.trim(), fiscalYear: Number(fiscalYear), metadata });
          return { route: `/nexus/financial-plans/${m.id}`, message: `Financial plan “${m.modelName}” created as draft` };
        })
      }
    >
      <Field label={tr("Plan name")}>
        <input required maxLength={100} value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder={tr("e.g. TechNova 2027 contract")} autoFocus />
      </Field>
      <Field label={tr("Fiscal year")}>
        <select value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)}>
          {[year - 1, year, year + 1, year + 2].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </Field>
      <Field label={tr("Client")}>
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">{tr("No client (internal plan)")}</option>
          {activeClients(clients).map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.name}</option>
          ))}
          <option value="new">{tr("New client…")}</option>
        </select>
      </Field>
      {client === 'new' && (
        <Field label={tr("Client company name")}>
          <input required maxLength={200} value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder={tr("e.g. TechNova Electronics B.V.")} />
        </Field>
      )}
      <p className="muted">{tr("The plan starts as a draft. Add plan lines in the plan, then approve it.")}</p>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Create plan")} onCancel={onCancel} />
    </form>
  );
}

function ClientForm({ onDone, onCancel }: FormProps) {
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('Netherlands');
  const { busy, error, submit } = useSubmit(onDone);
  const opt = (v: string) => v.trim() || null;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const c = await api.createClient({ name: name.trim(), legalName: opt(legalName), vatNumber: opt(vatNumber), city: opt(city), country: opt(country) });
          return { route: `/nexus/clients/${c.id}`, message: `Client “${c.name}” created` };
        })
      }
    >
      <Field label={tr("Company name")}>
        <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. TechNova Electronics")} autoFocus />
      </Field>
      <Field label={tr("Legal name")} hint={tr("Optional, as registered with the Chamber of Commerce")}>
        <input maxLength={200} value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder={tr("e.g. TechNova Electronics B.V.")} />
      </Field>
      <Field label={tr("VAT number")} hint={tr("Optional")}>
        <input maxLength={50} value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} placeholder={tr("e.g. NL123456789B01")} />
      </Field>
      <Field label={tr("City")}>
        <input maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} />
      </Field>
      <Field label={tr("Country")}>
        <input maxLength={100} value={country} onChange={(e) => setCountry(e.target.value)} />
      </Field>
      <p className="muted">{tr("After creating the client you can add contacts, agreements and client rooms from its record.")}</p>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Create client")} onCancel={onCancel} />
    </form>
  );
}

function ContactForm({ defaults, onDone, onCancel, onSwitch }: FormProps & { onSwitch: (kind: NewKind) => void }) {
  const clients = useClients();
  const [clientId, setClientId] = useState(defaults.clientId ?? '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const { busy, error, submit } = useSubmit(onDone);
  if (activeClients(clients).length === 0 && !defaults.clientId) return <NoClients onCancel={onCancel} onNewClient={() => onSwitch('client')} />;
  const opt = (v: string) => v.trim() || null;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const k = await api.addContact(clientId, {
            firstName: firstName.trim(),
            lastName: opt(lastName),
            email: opt(email),
            phone: opt(phone),
            roleTitle: opt(roleTitle),
            isPrimary,
          });
          return { route: `/nexus/clients/${clientId}?tab=contacts`, message: `Contact “${k.firstName}${k.lastName ? ` ${k.lastName}` : ''}” added` };
        })
      }
    >
      <Field label={tr("Client")}>
        <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">{tr("Choose a client…")}</option>
          {activeClients(clients).map((c) => (
            <option key={c.clientId} value={c.clientId}>{c.name}</option>
          ))}
        </select>
      </Field>
      <Field label={tr("First name")}>
        <input required maxLength={100} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
      </Field>
      <Field label={tr("Last name")}>
        <input maxLength={100} value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </Field>
      <Field label={tr("Job title")} hint={tr("Optional, e.g. Category manager")}>
        <input maxLength={150} value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
      </Field>
      <Field label={tr("E-mail")}>
        <input type="email" maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={tr("Phone")}>
        <input type="tel" maxLength={50} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />  {tr("Primary contact for this client")}</label>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Add contact")} onCancel={onCancel} />
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
      <Field label={tr("Organisation name")}>
        <input required maxLength={255} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label={tr("E-mail domain")} hint={tr("People who sign in with an address at this domain belong to this organisation, e.g. technova.nl")}>
        <input required maxLength={255} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Create organisation")} onCancel={onCancel} />
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
        <p><strong>{tr("Copy this key now.")}</strong>  {tr("For security it is shown only once.")}</p>
        <code className="secret">{created.key}</code>
        <div className="form-actions">
          <button className="secondary" onClick={() => void navigator.clipboard?.writeText(created.key)}>{tr("Copy key")}</button>
          <button className="primary" onClick={() => onDone(`/symphony/integrations?created=${created.id}`, `Integration key “${created.name}” created`)}>{tr("Done")}</button>
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
      <Field label={tr("Name")} hint={tr("Which portal or system uses this key")}>
        <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Retailer portal")} autoFocus />
      </Field>
      <Field label={tr("Expires on")} hint={tr("Optional; leave empty for no expiry date")}>
        <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </Field>
      <p className="muted">{tr("Integration keys can only read work orders, store visits and reports of this organisation.")}</p>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Create key")} onCancel={onCancel} />
    </form>
  );
}

function InvoiceForm({ defaults, onDone, onCancel, onSwitch }: FormProps & { onSwitch: (kind: NewKind) => void }) {
  const clients = useClients();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ clientId: defaults?.clientId ?? '', invoiceNumber: '', description: '', issueDate: today, dueDate: '', amountExclVat: '', vatRate: '21', status: 'issued' });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const { busy, error, submit } = useSubmit(onDone);
  if (activeClients(clients).length === 0) return <NoClients onCancel={onCancel} onNewClient={() => onSwitch('client')} />;
  const vat = form.amountExclVat ? ((Number(form.amountExclVat) * Number(form.vatRate)) / 100).toFixed(2) : '0.00';
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const i = await api.createInvoice({
            clientId: form.clientId,
            invoiceNumber: form.invoiceNumber.trim(),
            description: form.description.trim() || null,
            issueDate: form.issueDate,
            dueDate: form.dueDate || null,
            amountExclVat: form.amountExclVat,
            vatAmount: vat,
            status: form.status as 'draft' | 'issued',
          });
          return { route: `/symphony/clients/${i.clientId}?tab=invoices`, message: tf("Invoice {n} recorded", { n: i.invoiceNumber }) };
        })
      }
    >
      <Field label={tr("Client")}>
        <select required value={form.clientId} onChange={set('clientId')} autoFocus>
          <option value="">{tr("Choose a client…")}</option>
          {activeClients(clients).map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
        </select>
      </Field>
      <Field label={tr("Invoice number")} hint={tr("Must be unique, e.g. INV-2026-0042")}><input required maxLength={50} value={form.invoiceNumber} onChange={set('invoiceNumber')} /></Field>
      <Field label={tr("Description")}><input maxLength={255} value={form.description} onChange={set('description')} /></Field>
      <div className="field-row">
        <Field label={tr("Invoice date")}><input required type="date" value={form.issueDate} onChange={set('issueDate')} /></Field>
        <Field label={tr("Due date")}><input type="date" min={form.issueDate} value={form.dueDate} onChange={set('dueDate')} /></Field>
      </div>
      <div className="field-row">
        <Field label={tr("Amount excl. VAT (EUR)")}><input required type="number" min={0} step="0.01" value={form.amountExclVat} onChange={set('amountExclVat')} /></Field>
        <Field label={tr("VAT rate")} hint={tf("VAT: € {vat}", { vat })}>
          <select value={form.vatRate} onChange={set('vatRate')}>
            <option value="21">21%</option>
            <option value="9">9%</option>
            <option value="0">{tr("0% / reverse charge")}</option>
          </select>
        </Field>
      </div>
      <Field label={tr("Status")}>
        <select value={form.status} onChange={set('status')}>
          <option value="issued">{tr("Sent to the client")}</option>
          <option value="draft">{tr("Draft")}</option>
        </select>
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Record invoice")} onCancel={onCancel} />
    </form>
  );
}

function DealForm({ defaults, onDone, onCancel, onSwitch }: FormProps & { onSwitch: (kind: NewKind) => void }) {
  const clients = useClients();
  const users = useUsers();
  const [form, setForm] = useState({ clientId: defaults?.clientId ?? '', title: '', value: '', priority: 'medium', ownerId: '', dueDate: '', notes: '' });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const { busy, error, submit } = useSubmit(onDone);
  if (activeClients(clients).length === 0) return <NoClients onCancel={onCancel} onNewClient={() => onSwitch('client')} />;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async () => {
          const d = await api.createDeal({
            clientId: form.clientId,
            title: form.title.trim(),
            value: form.value || '0',
            priority: form.priority as 'low' | 'medium' | 'high',
            ownerId: form.ownerId || null,
            dueDate: form.dueDate || null,
            notes: form.notes.trim() || null,
          });
          return { route: `/nexus/deals/${d.id}`, message: `Deal “${d.title}” added to the pipeline` };
        })
      }
    >
      <Field label={tr("Client")}>
        <select required value={form.clientId} onChange={set('clientId')} autoFocus>
          <option value="">{tr("Choose a client…")}</option>
          {activeClients(clients).map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
        </select>
      </Field>
      <Field label={tr("Deal name")}><input required maxLength={200} value={form.title} onChange={set('title')} placeholder={tr("e.g. Shelf replenishment Q3")} /></Field>
      <div className="field-row">
        <Field label={tr("Value (EUR)")}><input type="number" min={0} step="0.01" value={form.value} onChange={set('value')} /></Field>
        <Field label={tr("Priority")}>
          <select value={form.priority} onChange={set('priority')}>
            <option value="low">{tr("Low")}</option>
            <option value="medium">{tr("Medium")}</option>
            <option value="high">{tr("High")}</option>
          </select>
        </Field>
      </div>
      <Field label={tr("Owner")}>
        <select value={form.ownerId} onChange={set('ownerId')}>
          <option value="">{tr("Not assigned")}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </Field>
      <Field label={tr("Expected close date")}><input type="date" value={form.dueDate} onChange={set('dueDate')} /></Field>
      <Field label={tr("Notes")}><textarea rows={3} value={form.notes} onChange={set('notes')} /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={tr("Add deal")} onCancel={onCancel} />
    </form>
  );
}

const TITLES: Record<NewKind, string> = {
  price_list: 'New price list',
  document_template: 'New document template',
  exception: 'New exception',
  product: 'New product',
  planogram: 'New planogram',
  field_order: 'New field order',
  audit_round: 'New audit round',
  work_order: 'New work order',
  deal: 'New deal',
  invoice: 'New invoice',
  store_visit: 'New store visit',
  store: 'New store',
  agreement: 'New agreement',
  client_room: 'New client room',
  client: 'New client',
  contact: 'New contact',
  financial_plan: 'New financial plan',
  survey: 'New survey',
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
      {kind === 'deal' && <DealForm {...props} onSwitch={onSwitch} />}
      {kind === 'invoice' && <InvoiceForm {...props} onSwitch={onSwitch} />}
      {kind === 'work_order' && <WorkOrderForm {...props} />}
      {kind === 'store_visit' && <StoreVisitForm {...props} />}
      {kind === 'store' && <StoreForm {...props} />}
      {kind === 'agreement' && <AgreementForm {...props} onSwitch={onSwitch} />}
      {kind === 'client_room' && <ClientRoomForm {...props} onSwitch={onSwitch} />}
      {kind === 'client' && <ClientForm {...props} />}
      {kind === 'contact' && <ContactForm {...props} onSwitch={onSwitch} />}
      {kind === 'financial_plan' && <FinancialPlanForm {...props} />}
      {kind === 'survey' && <NewSurveyForm {...props} />}
      {kind === 'organisation' && <OrganisationForm {...props} />}
      {kind === 'integration_key' && <IntegrationKeyForm {...props} />}
      {kind === 'product' && <NewProductForm {...props} />}
      {kind === 'exception' && <NewExceptionForm {...props} />}
      {kind === 'price_list' && <NewPriceListForm {...props} />}
      {kind === 'document_template' && <NewTemplateForm {...props} />}
      {kind === 'planogram' && <NewPlanogramForm {...props} />}
      {kind === 'field_order' && <NewFieldOrderForm {...props} />}
      {kind === 'audit_round' && <NewAuditRoundForm {...props} />}
    </Drawer>
  );
}
