import { type FormEvent, useRef, useState } from 'react';
import { api, type DocumentTemplate, type PriceList, type TemplateKind } from '../api';
import { matchesClient, useClientFilter } from '../clientFilter';
import { formatDate } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { type NewDefaults, useShell } from '../shell';
import { Drawer, ErrorText, Field, FilterChips, FormActions, Loading, StatusBadge, useAction, useLoad } from '../ui';
import { money } from './Clients';
import { t as tr, tf } from '../i18n';

const SUITE = { label: tr("Nexus"), href: '#/nexus' };
export const TEMPLATE_KIND: Record<TemplateKind, string> = { proposal: 'Proposal', agreement: 'Agreement', letter: 'Letter', mail: 'E-mail text' };

interface FormProps { defaults: NewDefaults; onDone: (route?: string, message?: string) => void; onCancel: () => void }
interface Line { productId: string; minQuantity: number; unitPrice: string }

/* ---------- Price lists ---------- */

function PriceListEditor({ list, clientId, onDone, onCancel }: { list?: PriceList; clientId?: string; onDone: (p: PriceList) => void; onCancel: () => void }) {
  const products = useLoad(() => api.products(), []);
  const clients = useLoad(() => api.clients(), []);
  const [name, setName] = useState(list?.name ?? '');
  const [client, setClient] = useState(list?.clientId ?? clientId ?? '');
  const [validFrom, setValidFrom] = useState(list?.validFrom ?? '');
  const [validTo, setValidTo] = useState(list?.validTo ?? '');
  const [lines, setLines] = useState<Line[]>(list?.items?.map((i) => ({ productId: i.productId, minQuantity: i.minQuantity, unitPrice: i.unitPrice })) ?? []);
  const [adding, setAdding] = useState('');
  const { busy, error, run } = useAction();
  const product = (id: string) => products.data?.find((p) => p.id === id);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), clientId: client || null, validFrom: validFrom || null, validTo: validTo || null, items: lines.map((l) => ({ ...l, unitPrice: l.unitPrice || '0' })) };
    void run(() => (list ? api.updatePriceList(list.id, body) : api.createPriceList(body))).then((r) => r && onDone(r));
  };
  const set = (idx: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  return (
    <form onSubmit={submit}>
      <Field label={tr("Name")}><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. TechNova contract prices 2027")} autoFocus /></Field>
      <Field label={tr("Client")} hint={tr("A client price list replaces catalogue prices on that client's field orders")}>
        <select value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">{tr("General (no client)")}</option>
          {clients.data?.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="form-grid two">
        <Field label={tr("Valid from")}><input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></Field>
        <Field label={tr("Valid until")}><input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} /></Field>
      </div>
      <Field label={tr("Prices")} hint={tr("Add the same product again with a higher minimum quantity for a volume price")}>
        {lines.length === 0 && <p className="muted">{tr("No prices yet.")}</p>}
        {lines.map((l, idx) => (
          <div key={idx} className="line-row">
            <span className="line-name">{product(l.productId)?.name ?? '…'} <small className="muted">{tr("catalogue")} {money(product(l.productId)?.unitPrice ?? '0')}</small></span>
            <label className="inline-label">{tr("from")} <input type="number" min={1} aria-label={tr("Minimum quantity")} value={l.minQuantity} onChange={(e) => set(idx, { minQuantity: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label className="inline-label">€ <input type="number" min={0} step="0.01" aria-label={tr("Price")} value={l.unitPrice} onChange={(e) => set(idx, { unitPrice: e.target.value })} /></label>
            <button type="button" className="link-button danger" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>{tr("Remove")}</button>
          </div>
        ))}
        <div className="line-row">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={tr("Add product")}>
            <option value="">{tr("Add a product…")}</option>
            {products.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </select>
          <button type="button" className="secondary small" disabled={!adding}
            onClick={() => (setLines([...lines, { productId: adding, minQuantity: lines.some((l) => l.productId === adding) ? 10 : 1, unitPrice: product(adding)?.unitPrice ?? '0' }]), setAdding(''))}>{tr("Add")}</button>
        </div>
        {products.data?.length === 0 && <p className="field-hint">{tr("The catalogue is empty: add products under RetailPower › Products first.")}</p>}
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={list ? tr("Save price list") : tr("Create price list")} onCancel={onCancel} />
    </form>
  );
}

export function NewPriceListForm({ defaults, onDone, onCancel }: FormProps) {
  return <PriceListEditor clientId={defaults.clientId} onCancel={onCancel} onDone={(p) => onDone(`/nexus/price-lists/${p.id}`, 'Price list created')} />;
}

export function PriceListsView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const filter = useClientFilter();
  const show = route.params.get('show') ?? 'active';
  const lists = useLoad(() => api.priceLists(), []);
  const items = (lists.data ?? []).filter((l) => (show === 'all' || l.active === (show === 'active')) && (!filter || l.clientId === filter.id || l.clientId === null));
  return (
    <ViewFrame title={tr("Price lists")} subtitle={tr("Client-specific and volume prices on top of the product catalogue")} crumbs={[SUITE, { label: tr("Price lists") }]} actions={<button className="primary" onClick={() => openNew('price_list')}>{tr("+ New price list")}</button>}>
      <div className="list-toolbar">
        <FilterChips value={show} onChange={(v) => navigate(withParams(route, { show: v === 'active' ? null : v }))} chips={[{ value: 'active', label: tr("Active") }, { value: 'inactive', label: tr("Inactive") }, { value: 'all', label: tr("All") }]} />
      </div>
      {!lists.data && <Loading error={lists.error} />}
      {lists.data && items.length === 0 && <EmptyState title={tr("No price lists")}>{tr("Create one with “+ New price list”. Without a price list, field orders use catalogue prices.")}</EmptyState>}
      {items.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>{tr("Price list")}</th><th>{tr("Client")}</th><th>{tr("Valid")}</th><th className="num">{tr("Prices")}</th><th>{tr("Status")}</th></tr></thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id} onClick={() => navigate(`/nexus/price-lists/${l.id}`)}>
                <td><a href={`#/nexus/price-lists/${l.id}`}>{l.name}</a></td>
                <td>{l.clientName ?? tr("General")}</td>
                <td>{l.validFrom ? formatDate(l.validFrom) : tr("always")} – {l.validTo ? formatDate(l.validTo) : 'open'}</td>
                <td className="num">{l.itemCount}</td>
                <td>{l.active ? <StatusBadge status="active" label={tr("Active")} /> : <StatusBadge status="archived" label={tr("Inactive")} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

export function PriceListDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const list = useLoad(() => api.priceList(id), [id]);
  const [editing, setEditing] = useState(false);
  const action = useAction();
  const crumbs = [SUITE, { label: tr("Price lists"), href: '#/nexus/price-lists' }];
  if (!list.data) return <ViewFrame title={tr("Price list")} crumbs={[...crumbs, { label: tr("Loading…") }]}><Loading error={list.error} /></ViewFrame>;
  const l = list.data;
  return (
    <ViewFrame title={l.name} subtitle={l.clientName ? tf("Prices for {client}", { client: l.clientName }) : tr("General price list")} crumbs={[...crumbs, { label: l.name }]}
      actions={<>
        <button className="secondary" onClick={() => setEditing(true)}>{tr("Edit")}</button>
        <button className="secondary" disabled={action.busy} onClick={() => void action.run(() => api.updatePriceList(id, { active: !l.active })).then((r) => r && (notify(r.active ? tr("Price list activated") : tr("Price list deactivated")), list.reload()))}>{l.active ? tr("Deactivate") : tr("Activate")}</button>
      </>}>
      <ErrorText error={action.error} />
      <p className="muted">{l.active ? tr("Active") : tr("Inactive")}  {tr("· valid")} {l.validFrom ? formatDate(l.validFrom) : 'always'} – {l.validTo ? formatDate(l.validTo) : 'open'}{l.clientId && <> · <a href={`#/nexus/clients/${l.clientId}`}>{tr("open client")}</a></>}</p>
      {l.items?.length === 0 ? <EmptyState title={tr("No prices")}>{tr("Use Edit to add products.")}</EmptyState> : (
        <table className="grid">
          <thead><tr><th>{tr("SKU")}</th><th>{tr("Product")}</th><th className="num">{tr("From quantity")}</th><th className="num">{tr("Catalogue")}</th><th className="num">{tr("Price")}</th><th className="num">{tr("Difference")}</th></tr></thead>
          <tbody>
            {l.items?.map((i) => {
              const diff = Number(i.catalogPrice) ? (Number(i.unitPrice) / Number(i.catalogPrice) - 1) * 100 : 0;
              return (
                <tr key={i.id}>
                  <td className="mono">{i.sku}</td><td>{i.productName}</td><td className="num">{i.minQuantity}</td>
                  <td className="num">{money(i.catalogPrice)}</td><td className="num"><strong>{money(i.unitPrice)}</strong></td>
                  <td className="num">{diff === 0 ? '—' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {editing && (
        <Drawer title={tr("Edit price list")} onClose={() => setEditing(false)}>
          <PriceListEditor list={l} onCancel={() => setEditing(false)} onDone={() => (setEditing(false), notify(tr("Price list saved")), list.reload())} />
        </Drawer>
      )}
    </ViewFrame>
  );
}

/* ---------- Document templates ---------- */

const STARTER = 'Dear {{contact.name}},\n\nThank you for your time. As discussed, this proposal for {{client.name}} ...\n\n{{priceList}}\n\nKind regards,\n{{user.name}}\n{{today}}';

function TemplateEditor({ template, placeholders, onDone, onCancel }: { template?: DocumentTemplate; placeholders: string[]; onDone: (t: DocumentTemplate) => void; onCancel: () => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [kind, setKind] = useState<TemplateKind>(template?.kind ?? 'proposal');
  const [body, setBody] = useState(template?.body ?? STARTER);
  const area = useRef<HTMLTextAreaElement>(null);
  const { busy, error, run } = useAction();
  const insert = (p: string) => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    const token = `{{${p}}}`;
    setBody(body.slice(0, at) + token + body.slice(el?.selectionEnd ?? at));
    setTimeout(() => el?.focus(), 0);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const b = { name: name.trim(), kind, body };
    void run(() => (template ? api.updateDocumentTemplate(template.id, b) : api.createDocumentTemplate(b))).then((r) => r && onDone(r));
  };
  return (
    <form onSubmit={submit}>
      <Field label={tr("Name")}><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label={tr("Type")}><select value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>{Object.entries(TEMPLATE_KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label={tr("Text")} hint={tr("Click a field to insert it at the cursor. Fields are filled from the client room when you generate a document.")}>
        <div className="placeholder-chips">{placeholders.map((p) => <button key={p} type="button" className="chip" onClick={() => insert(p)}>{p}</button>)}</div>
        <textarea ref={area} required rows={14} maxLength={50000} value={body} onChange={(e) => setBody(e.target.value)} className="mono" />
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={template ? tr("Save template") : tr("Create template")} onCancel={onCancel} />
    </form>
  );
}

export function NewTemplateForm({ onDone, onCancel }: FormProps) {
  const data = useLoad(() => api.documentTemplates(), []);
  if (!data.data) return <Loading error={data.error} />;
  return <TemplateEditor placeholders={data.data.placeholders} onCancel={onCancel} onDone={() => onDone('/nexus/templates', 'Template created')} />;
}

export function TemplatesView() {
  const { openNew, notify } = useShell();
  const data = useLoad(() => api.documentTemplates(true), []);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const action = useAction();
  return (
    <ViewFrame title={tr("Document templates")} subtitle={tr("Proposals, agreements and letters filled with client data, generated into a client room")} crumbs={[SUITE, { label: tr("Document templates") }]} actions={<button className="primary" onClick={() => openNew('document_template')}>{tr("+ New template")}</button>}>
      <ErrorText error={action.error} />
      {!data.data && <Loading error={data.error} />}
      {data.data?.items.length === 0 && <EmptyState title={tr("No templates")}>{tr("Create one with “+ New template”, then use “Generate from template” in a client room's Documents tab.")}</EmptyState>}
      {data.data && data.data.items.length > 0 && (
        <table className="grid">
          <thead><tr><th>{tr("Template")}</th><th>{tr("Type")}</th><th>{tr("Updated")}</th><th>{tr("Status")}</th><th /></tr></thead>
          <tbody>
            {data.data.items.map((t) => (
              <tr key={t.id}>
                <td>{t.name}<div className="muted small">{t.body.slice(0, 90)}{t.body.length > 90 ? '…' : ''}</div></td>
                <td>{TEMPLATE_KIND[t.kind]}</td>
                <td>{formatDate(t.updatedAt)}</td>
                <td>{t.active ? <StatusBadge status="active" label={tr("Active")} /> : <StatusBadge status="archived" label={tr("Inactive")} />}</td>
                <td className="row-actions">
                  <button className="link-button" onClick={() => setEditing(t)}>{tr("Edit")}</button>
                  <button className="link-button" disabled={action.busy} onClick={() => void action.run(() => api.updateDocumentTemplate(t.id, { active: !t.active })).then((r) => r && (notify(r.active ? tr("Template activated") : tr("Template deactivated")), data.reload()))}>{t.active ? tr("Deactivate") : tr("Activate")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && data.data && (
        <Drawer title={tr("Edit template")} onClose={() => setEditing(null)}>
          <TemplateEditor template={editing} placeholders={data.data.placeholders} onCancel={() => setEditing(null)} onDone={() => (setEditing(null), notify(tr("Template saved")), data.reload())} />
        </Drawer>
      )}
    </ViewFrame>
  );
}

/** Drawer in a room's Documents tab: pick a template, preview it with the room's data, and store it as a document. */
export function GenerateDocumentDrawer({ roomId, onClose, onDone }: { roomId: string; onClose: () => void; onDone: () => void }) {
  const data = useLoad(() => api.documentTemplates(), []);
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState<{ text: string; missing: string[] } | null>(null);
  const { busy, error, run } = useAction();
  const choose = (id: string) => {
    setTemplateId(id);
    setPreview(null);
    setTitle(data.data?.items.find((t) => t.id === id)?.name ?? '');
    if (id) void run(() => api.renderTemplate(id, { roomId })).then((r) => r && setPreview(r));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.generateRoomDocument(roomId, templateId, title.trim())).then((r) => r && onDone());
  };
  return (
    <Drawer title={tr("Generate from template")} onClose={onClose}>
      <form onSubmit={submit}>
        {!data.data && <Loading error={data.error} />}
        {data.data?.items.length === 0 && <p className="muted">{tr("No templates yet. Create one under")} <a href="#/nexus/templates">{tr("Nexus › Document templates")}</a>.</p>}
        {data.data && data.data.items.length > 0 && (
          <>
            <Field label={tr("Template")}><select required value={templateId} onChange={(e) => choose(e.target.value)}><option value="">{tr("Choose…")}</option>{data.data.items.map((t) => <option key={t.id} value={t.id}>{t.name} ({TEMPLATE_KIND[t.kind]})</option>)}</select></Field>
            <Field label={tr("Document title")}><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            {preview && (
              <>
                {preview.missing.length > 0 && <p className="field-hint">{tr("Not filled (no data in this room or client):")} {preview.missing.join(', ')}</p>}
                <pre className="template-preview">{preview.text}</pre>
              </>
            )}
          </>
        )}
        <ErrorText error={error} />
        <FormActions busy={busy || !templateId} submitLabel={tr("Generate document")} onCancel={onClose} />
      </form>
    </Drawer>
  );
}

export { matchesClient };
