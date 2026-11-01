import { type FormEvent, useState } from 'react';
import { api, type Agreement, type Store, type StoreStatus, type Visit, type WorkOrder, type WorkOrderPriority } from './api';
import { useUsers } from './directory';
import { STORE_STATUS, WORK_ORDER_PRIORITY } from './labels';
import { Drawer, ErrorText, Field, FormActions, useAction } from './ui';

type Change = { target: { value: string } };
const opt = (v: string) => v.trim() || null;

/** ISO timestamp → value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

interface EditProps<T> {
  record: T;
  onClose: () => void;
  onSaved: (updated: T) => void;
}

export function EditStoreDrawer({ record, onClose, onSaved }: EditProps<Store>) {
  const [form, setForm] = useState({
    storeCode: record.storeCode,
    name: record.name,
    address: record.address ?? '',
    postalCode: record.postalCode ?? '',
    city: record.city ?? '',
    country: record.country ?? '',
    status: record.status,
  });
  const { busy, error, run } = useAction();
  const set = (k: keyof typeof form) => (e: Change) => setForm({ ...form, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      api.updateStore(record.id, {
        storeCode: form.storeCode.trim(),
        name: form.name.trim(),
        address: opt(form.address),
        postalCode: opt(form.postalCode),
        city: opt(form.city),
        country: opt(form.country),
        status: form.status,
      }),
    ).then((r) => r && onSaved(r));
  };
  return (
    <Drawer title="Edit store" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Store name"><input required maxLength={200} value={form.name} onChange={set('name')} autoFocus /></Field>
        <Field label="Store code" hint="Must be unique"><input required maxLength={50} value={form.storeCode} onChange={set('storeCode')} /></Field>
        <Field label="Street and number"><input maxLength={255} value={form.address} onChange={set('address')} /></Field>
        <Field label="Postal code"><input maxLength={20} value={form.postalCode} onChange={set('postalCode')} /></Field>
        <Field label="City"><input maxLength={100} value={form.city} onChange={set('city')} /></Field>
        <Field label="Country"><input maxLength={100} value={form.country} onChange={set('country')} /></Field>
        <Field label="Status">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as StoreStatus })}>
            {Object.entries(STORE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Save changes" onCancel={onClose} />
      </form>
    </Drawer>
  );
}

export function EditWorkOrderDrawer({ record, onClose, onSaved }: EditProps<WorkOrder>) {
  const [title, setTitle] = useState(record.title);
  const [description, setDescription] = useState(record.description ?? '');
  const [priority, setPriority] = useState<WorkOrderPriority>(record.priority);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.updateWorkOrder(record.id, { title: title.trim(), description: opt(description), priority })).then((r) => r && onSaved(r));
  };
  return (
    <Drawer title="Edit work order" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Title"><input required maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="Description"><textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as WorkOrderPriority)}>
            {Object.entries(WORK_ORDER_PRIORITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Save changes" onCancel={onClose} />
      </form>
    </Drawer>
  );
}

export function EditVisitDrawer({ record, onClose, onSaved }: EditProps<Visit>) {
  const users = useUsers();
  const [visitDate, setVisitDate] = useState(toLocalInput(record.visitDate));
  const [fieldRepId, setFieldRepId] = useState(record.fieldRepId);
  const [notes, setNotes] = useState(record.notes ?? '');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.updateVisit(record.id, { visitDate: new Date(visitDate).toISOString(), fieldRepId, notes: opt(notes) })).then((r) => r && onSaved(r));
  };
  return (
    <Drawer title="Edit store visit" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Date and time"><input type="datetime-local" required value={visitDate} onChange={(e) => setVisitDate(e.target.value)} autoFocus /></Field>
        <Field label="Field representative">
          <select value={fieldRepId} onChange={(e) => setFieldRepId(e.target.value)}>
            {!users.some((u) => u.id === fieldRepId) && <option value={fieldRepId}>Current representative</option>}
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Notes"><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Save changes" onCancel={onClose} />
      </form>
    </Drawer>
  );
}

export function EditAgreementDrawer({ record, onClose, onSaved }: EditProps<Agreement>) {
  const [title, setTitle] = useState(record.title);
  const [documentUrl, setDocumentUrl] = useState(record.documentUrl);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.updateAgreement(record.id, { title: title.trim(), documentUrl: documentUrl.trim() })).then((r) => r && onSaved(r));
  };
  return (
    <Drawer title="Edit agreement" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Title"><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus /></Field>
        <Field label="Link to the agreement document" hint="A web address starting with https://">
          <input type="url" required maxLength={500} value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel="Save changes" onCancel={onClose} />
      </form>
    </Drawer>
  );
}
