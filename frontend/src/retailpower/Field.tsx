import { type FormEvent, useMemo, useState } from 'react';
import { api, type AuditRound, type FieldOrder, type FieldOrderStatus, type Planogram, type Product } from '../api';
import { useUsers, userName } from '../directory';
import { COMPLIANCE, formatDate, formatDateTime, VISIT_STATUS } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { money } from '../nexus/Clients';
import { navigate, type Route, withParams } from '../router';
import { type NewDefaults, useShell } from '../shell';
import { DetailList, Drawer, ErrorText, Field, FilterChips, FormActions, includesText, Loading, SearchInput, StatusBadge, useAction, useLoad } from '../ui';

const SUITE = { label: 'RetailPower', href: '#/retailpower' };

export const ORDER_STATUS: Record<FieldOrderStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

interface FormProps {
  defaults: NewDefaults;
  onDone: (route?: string, message?: string) => void;
  onCancel: () => void;
}

/* ---------- Products ---------- */

export function ProductForm({ product, onDone, onCancel }: { product?: Product; onDone: (route?: string, message?: string) => void; onCancel: () => void }) {
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [category, setCategory] = useState(product?.category ?? '');
  const [price, setPrice] = useState(product?.unitPrice ?? '');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { sku: sku.trim(), name: name.trim(), brand: brand.trim() || null, category: category.trim() || null, unitPrice: price || 0 };
    void run(() => (product ? api.updateProduct(product.id, body) : api.createProduct(body))).then(
      (r) => r && onDone('/retailpower/products', product ? 'Product updated' : `${r.name} added to the catalogue`),
    );
  };
  return (
    <form onSubmit={submit}>
      <Field label="Article number (SKU)"><input required maxLength={60} value={sku} onChange={(e) => setSku(e.target.value)} autoFocus /></Field>
      <Field label="Product name"><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cola Zero 1.5L" /></Field>
      <Field label="Brand"><input maxLength={100} value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
      <Field label="Category" hint="Used to group products and planograms"><input maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
      <Field label="Unit price (EUR, excl. VAT)"><input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={product ? 'Save' : 'Add product'} onCancel={onCancel} />
    </form>
  );
}

export function NewProductForm({ onDone, onCancel }: FormProps) {
  return <ProductForm onDone={onDone} onCancel={onCancel} />;
}

export function ProductsView({ route }: { route: Route }) {
  const { openNew, notify } = useShell();
  const show = route.params.get('show') ?? 'active';
  const q = route.params.get('q') ?? '';
  const products = useLoad(() => api.products(true), []);
  const [editing, setEditing] = useState<Product | null>(null);
  const action = useAction();
  const items = (products.data ?? []).filter((p) => (show === 'all' || p.active === (show === 'active')) && includesText([p.sku, p.name, p.brand, p.category], q));
  const toggle = (p: Product) => void action.run(() => api.updateProduct(p.id, { active: !p.active })).then((r) => r && (notify(r.active ? 'Product reactivated' : 'Product deactivated'), products.reload()));
  return (
    <ViewFrame
      title="Products"
      subtitle="Catalogue used in planograms, out-of-stock reports and field orders"
      crumbs={[SUITE, { label: 'Products' }]}
      actions={<button className="primary" onClick={() => openNew('product')}>+ New product</button>}
    >
      <div className="list-toolbar">
        <SearchInput value={q} onChange={(v) => navigate(withParams(route, { q: v || null }))} placeholder="Search SKU, name, brand or category" />
        <FilterChips value={show} onChange={(v) => navigate(withParams(route, { show: v === 'active' ? null : v }))} chips={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} />
      </div>
      <ErrorText error={action.error} />
      {!products.data && <Loading error={products.error} />}
      {products.data && items.length === 0 && <EmptyState title="No products">Add your first product with “+ New product”.</EmptyState>}
      {items.length > 0 && (
        <table className="grid">
          <thead><tr><th>SKU</th><th>Product</th><th>Brand</th><th>Category</th><th className="num">Unit price</th><th>Status</th><th /></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.sku}</td>
                <td>{p.name}</td>
                <td>{p.brand ?? '—'}</td>
                <td>{p.category ?? '—'}</td>
                <td className="num">{money(p.unitPrice)}</td>
                <td>{p.active ? <StatusBadge status="active" label="Active" /> : <StatusBadge status="archived" label="Inactive" />}</td>
                <td className="row-actions">
                  <button className="link-button" onClick={() => setEditing(p)}>Edit</button>
                  <button className="link-button" disabled={action.busy} onClick={() => toggle(p)}>{p.active ? 'Deactivate' : 'Reactivate'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <Drawer title="Edit product" onClose={() => setEditing(null)}>
          <ProductForm product={editing} onCancel={() => setEditing(null)} onDone={(_r, m) => (setEditing(null), m && notify(m), products.reload())} />
        </Drawer>
      )}
    </ViewFrame>
  );
}

/* ---------- Planograms ---------- */

interface ItemDraft { productId: string; expectedFacings: number; shelf: string }

function PlanogramEditor({ planogram, onDone, onCancel }: { planogram?: Planogram; onDone: (p: Planogram) => void; onCancel: () => void }) {
  const products = useLoad(() => api.products(), []);
  const stores = useLoad(() => api.stores(), []);
  const [name, setName] = useState(planogram?.name ?? '');
  const [category, setCategory] = useState(planogram?.category ?? '');
  const [storeId, setStoreId] = useState(planogram?.storeId ?? '');
  const [items, setItems] = useState<ItemDraft[]>(planogram?.items.map((i) => ({ productId: i.productId, expectedFacings: i.expectedFacings, shelf: i.shelf ?? '' })) ?? []);
  const [adding, setAdding] = useState('');
  const { busy, error, run } = useAction();
  const productName = (id: string) => products.data?.find((p) => p.id === id)?.name ?? '…';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { name: name.trim(), category: category.trim() || null, storeId: storeId || null, items: items.map((i) => ({ productId: i.productId, expectedFacings: i.expectedFacings, shelf: i.shelf.trim() || null })) };
    void run(() => (planogram ? api.updatePlanogram(planogram.id, body) : api.createPlanogram(body))).then((r) => r && onDone(r));
  };
  return (
    <form onSubmit={submit}>
      <Field label="Name"><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Soft drinks – end cap" autoFocus /></Field>
      <Field label="Category"><input maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} /></Field>
      <Field label="Applies to" hint="A store-specific planogram is offered only for that store">
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="">All stores</option>
          {stores.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.storeCode})</option>)}
        </select>
      </Field>
      <Field label="Products and expected facings">
        {items.length === 0 && <p className="muted">No products yet.</p>}
        {items.map((it, idx) => (
          <div key={it.productId} className="line-row">
            <span className="line-name">{productName(it.productId)}</span>
            <input type="number" min={1} max={999} aria-label="Expected facings" value={it.expectedFacings} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, expectedFacings: Math.max(1, Number(e.target.value) || 1) } : x)))} />
            <input placeholder="Shelf" aria-label="Shelf" maxLength={50} value={it.shelf} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, shelf: e.target.value } : x)))} />
            <button type="button" className="link-button danger" onClick={() => setItems(items.filter((_, i) => i !== idx))}>Remove</button>
          </div>
        ))}
        <div className="line-row">
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add product">
            <option value="">Add a product…</option>
            {products.data?.filter((p) => !items.some((i) => i.productId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </select>
          <button type="button" className="secondary small" disabled={!adding} onClick={() => (setItems([...items, { productId: adding, expectedFacings: 1, shelf: '' }]), setAdding(''))}>Add</button>
        </div>
        {products.data?.length === 0 && <p className="field-hint">The catalogue is empty: add products under RetailPower › Products first.</p>}
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={planogram ? 'Save planogram' : 'Create planogram'} onCancel={onCancel} />
    </form>
  );
}

export function NewPlanogramForm({ onDone, onCancel }: FormProps) {
  return <PlanogramEditor onCancel={onCancel} onDone={(p) => onDone(`/retailpower/planograms/${p.id}`, 'Planogram created')} />;
}

export function PlanogramsView() {
  const { openNew } = useShell();
  const list = useLoad(() => api.planograms(), []);
  return (
    <ViewFrame title="Planograms" subtitle="Expected shelf layout; field reps count facings during store visits" crumbs={[SUITE, { label: 'Planograms' }]} actions={<button className="primary" onClick={() => openNew('planogram')}>+ New planogram</button>}>
      {!list.data && <Loading error={list.error} />}
      {list.data?.length === 0 && <EmptyState title="No planograms yet">Create one to score shelf compliance in visit reports.</EmptyState>}
      {list.data && list.data.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>Name</th><th>Category</th><th>Applies to</th><th className="num">Products</th><th className="num">Facings</th><th>Status</th></tr></thead>
          <tbody>
            {list.data.map((g) => (
              <tr key={g.id} onClick={() => navigate(`/retailpower/planograms/${g.id}`)}>
                <td><a href={`#/retailpower/planograms/${g.id}`}>{g.name}</a></td>
                <td>{g.category ?? '—'}</td>
                <td>{g.storeName ?? 'All stores'}</td>
                <td className="num">{g.itemCount}</td>
                <td className="num">{g.totalFacings}</td>
                <td>{g.active ? <StatusBadge status="active" label="Active" /> : <StatusBadge status="archived" label="Inactive" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

export function PlanogramDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const g = useLoad(() => api.planogram(id), [id]);
  const [editing, setEditing] = useState(false);
  const action = useAction();
  const crumbs = [SUITE, { label: 'Planograms', href: '#/retailpower/planograms' }];
  if (!g.data) return <ViewFrame title="Planogram" crumbs={[...crumbs, { label: 'Loading…' }]}><Loading error={g.error} /></ViewFrame>;
  const p = g.data;
  const toggle = () => void action.run(() => api.updatePlanogram(id, { active: !p.active })).then((r) => r && (notify(r.active ? 'Planogram activated' : 'Planogram deactivated'), g.reload()));
  return (
    <ViewFrame
      title={p.name}
      subtitle={<StatusBadge status={p.active ? 'active' : 'archived'} label={p.active ? 'Active' : 'Inactive'} />}
      crumbs={[...crumbs, { label: p.name }]}
      actions={
        <>
          <button className="secondary" onClick={() => setEditing(true)}>Edit</button>
          <button className="secondary" disabled={action.busy} onClick={toggle}>{p.active ? 'Deactivate' : 'Activate'}</button>
        </>
      }
    >
      <ErrorText error={action.error} />
      <DetailList items={[['Category', p.category ?? '—'], ['Applies to', p.storeName ?? 'All stores'], ['Last change', formatDateTime(p.updatedAt)]]} />
      <div className="card-panel">
        <h2>Shelf layout</h2>
        {p.items.length === 0 ? <p className="muted">No products yet. Use Edit to add them.</p> : (
          <table className="grid">
            <thead><tr><th>Shelf</th><th>Product</th><th>SKU</th><th className="num">Expected facings</th></tr></thead>
            <tbody>{p.items.map((i) => <tr key={i.id}><td>{i.shelf ?? '—'}</td><td>{i.productName}</td><td className="mono">{i.sku}</td><td className="num">{i.expectedFacings}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      {editing && (
        <Drawer title="Edit planogram" onClose={() => setEditing(false)}>
          <PlanogramEditor planogram={p} onCancel={() => setEditing(false)} onDone={() => (setEditing(false), notify('Planogram saved'), g.reload())} />
        </Drawer>
      )}
    </ViewFrame>
  );
}

/* ---------- Field orders ---------- */

interface LineDraft { productId: string; quantity: number }

function LinesEditor({ lines, onChange, products }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void; products: Product[] }) {
  const [adding, setAdding] = useState('');
  const price = (id: string) => Number(products.find((p) => p.id === id)?.unitPrice ?? 0);
  const total = lines.reduce((s, l) => s + price(l.productId) * l.quantity, 0);
  return (
    <>
      {lines.map((l, idx) => (
        <div key={l.productId} className="line-row">
          <span className="line-name">{products.find((p) => p.id === l.productId)?.name ?? '…'}</span>
          <input type="number" min={1} max={100000} aria-label="Quantity" value={l.quantity} onChange={(e) => onChange(lines.map((x, i) => (i === idx ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} />
          <span className="num muted">{money(price(l.productId) * l.quantity)}</span>
          <button type="button" className="link-button danger" onClick={() => onChange(lines.filter((_, i) => i !== idx))}>Remove</button>
        </div>
      ))}
      <div className="line-row">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add product">
          <option value="">Add a product…</option>
          {products.filter((p) => !lines.some((l) => l.productId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.unitPrice)}</option>)}
        </select>
        <button type="button" className="secondary small" disabled={!adding} onClick={() => (onChange([...lines, { productId: adding, quantity: 1 }]), setAdding(''))}>Add</button>
      </div>
      <p className="muted">Total excl. VAT: <strong>{money(total)}</strong></p>
    </>
  );
}

export function NewFieldOrderForm({ defaults, onDone, onCancel }: FormProps) {
  const stores = useLoad(() => api.stores(), []);
  const products = useLoad(() => api.products(), []);
  const [storeId, setStoreId] = useState(defaults.storeId ?? '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api.createFieldOrder({ storeId, visitId: defaults.visitId || null, notes: notes.trim() || null, lines })).then((r) => r && onDone(`/retailpower/orders/${r.id}`, 'Draft order created'));
  };
  return (
    <form onSubmit={submit}>
      <Field label="Store">
        <select required value={storeId} onChange={(e) => setStoreId(e.target.value)} autoFocus>
          <option value="">Choose a store…</option>
          {stores.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.storeCode})</option>)}
        </select>
      </Field>
      <Field label="Products">{products.data ? <LinesEditor lines={lines} onChange={setLines} products={products.data} /> : <Loading error={products.error} />}</Field>
      <Field label="Notes"><textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel="Create draft order" onCancel={onCancel} />
    </form>
  );
}

export function FieldOrdersView({ route }: { route: Route }) {
  const { openNew } = useShell();
  const status = (route.params.get('status') ?? '') as FieldOrderStatus | '';
  const orders = useLoad(() => api.fieldOrders(status || undefined), [status]);
  return (
    <ViewFrame title="Field orders" subtitle="Orders taken in stores, from draft to delivery" crumbs={[SUITE, { label: 'Field orders' }]} actions={<button className="primary" onClick={() => openNew('field_order')}>+ New field order</button>}>
      <div className="list-toolbar">
        <FilterChips value={status} onChange={(v) => navigate(withParams(route, { status: v || null }))} chips={[{ value: '', label: 'All' }, ...Object.entries(ORDER_STATUS).map(([value, label]) => ({ value, label }))]} />
      </div>
      {!orders.data && <Loading error={orders.error} />}
      {orders.data?.length === 0 && <EmptyState title="No field orders">Create one with “+ New field order”, or from a store visit.</EmptyState>}
      {orders.data && orders.data.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>Created</th><th>Store</th><th>Client</th><th className="num">Lines</th><th className="num">Total</th><th>Status</th></tr></thead>
          <tbody>
            {orders.data.map((o) => (
              <tr key={o.id} onClick={() => navigate(`/retailpower/orders/${o.id}`)}>
                <td><a href={`#/retailpower/orders/${o.id}`}>{formatDate(o.createdAt)}</a><div className="muted small">{o.createdByName ?? '—'}</div></td>
                <td>{o.storeName}</td>
                <td>{o.clientName ?? '—'}</td>
                <td className="num">{o.lineCount ?? 0}</td>
                <td className="num">{money(o.total)}</td>
                <td><StatusBadge status={o.status} label={ORDER_STATUS[o.status]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

const NEXT: Record<FieldOrderStatus, { to: FieldOrderStatus; label: string; primary?: boolean }[]> = {
  draft: [{ to: 'submitted', label: 'Submit order', primary: true }, { to: 'cancelled', label: 'Cancel order' }],
  submitted: [{ to: 'confirmed', label: 'Confirm', primary: true }, { to: 'cancelled', label: 'Cancel order' }],
  confirmed: [{ to: 'delivered', label: 'Mark delivered', primary: true }, { to: 'cancelled', label: 'Cancel order' }],
  delivered: [],
  cancelled: [],
};

export function FieldOrderDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const order = useLoad(() => api.fieldOrder(id), [id]);
  const products = useLoad(() => api.products(), []);
  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const action = useAction();
  const crumbs = [SUITE, { label: 'Field orders', href: '#/retailpower/orders' }];
  if (!order.data) return <ViewFrame title="Field order" crumbs={[...crumbs, { label: 'Loading…' }]}><Loading error={order.error} /></ViewFrame>;
  const o: FieldOrder = order.data;
  const title = `Order ${o.storeName} · ${formatDate(o.createdAt)}`;
  const move = (to: FieldOrderStatus) => {
    if (to === 'cancelled' && !window.confirm('Cancel this order?')) return;
    void action.run(() => api.setFieldOrderStatus(id, to)).then((r) => r && (notify(`Order ${ORDER_STATUS[to].toLowerCase()}`), order.reload()));
  };
  const saveLines = () => lines && void action.run(() => api.updateFieldOrder(id, { lines })).then((r) => r && (notify('Order updated'), setLines(null), order.reload()));
  return (
    <ViewFrame
      title={title}
      subtitle={<StatusBadge status={o.status} label={ORDER_STATUS[o.status]} />}
      crumbs={[...crumbs, { label: title }]}
      actions={NEXT[o.status].map((n) => <button key={n.to} className={n.primary ? 'primary' : 'secondary danger'} disabled={action.busy} onClick={() => move(n.to)}>{n.label}</button>)}
    >
      <ErrorText error={action.error} />
      <DetailList
        items={[
          ['Store', <a href={`#/retailpower/stores/${o.storeId}`}>{o.storeName}</a>],
          ['Client', o.clientId ? <a href={`#/nexus/clients/${o.clientId}`}>{o.clientName}</a> : '—'],
          ['Store visit', o.visitId ? <a href={`#/retailpower/store-visits/${o.visitId}`}>Open visit</a> : '—'],
          ['Created by', `${o.createdByName ?? '—'} · ${formatDateTime(o.createdAt)}`],
          ['Submitted', o.submittedAt ? formatDateTime(o.submittedAt) : '—'],
          ['Notes', o.notes || '—'],
        ]}
      />
      <div className="card-panel">
        <div className="panel-head">
          <h2>Products</h2>
          {o.status === 'draft' && !lines && <button className="secondary" onClick={() => setLines((o.lines ?? []).map((l) => ({ productId: l.productId, quantity: l.quantity })))}>Change products</button>}
        </div>
        {lines && products.data ? (
          <>
            <LinesEditor lines={lines} onChange={setLines} products={products.data} />
            <div className="form-actions start">
              <button className="primary" disabled={action.busy} onClick={saveLines}>Save</button>
              <button className="secondary" onClick={() => setLines(null)}>Cancel</button>
            </div>
          </>
        ) : (o.lines ?? []).length === 0 ? (
          <p className="muted">No products yet.</p>
        ) : (
          <table className="grid">
            <thead><tr><th>Product</th><th>SKU</th><th className="num">Quantity</th><th className="num">Unit price</th><th className="num">Total</th></tr></thead>
            <tbody>
              {(o.lines ?? []).map((l) => <tr key={l.id}><td>{l.productName}</td><td className="mono">{l.sku}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unitPrice)}</td><td className="num">{money(l.lineTotal)}</td></tr>)}
              <tr><td colSpan={4}><strong>Total excl. VAT</strong></td><td className="num"><strong>{money(o.total)}</strong></td></tr>
            </tbody>
          </table>
        )}
      </div>
    </ViewFrame>
  );
}

/* ---------- Audit rounds ---------- */

export function NewAuditRoundForm({ onDone, onCancel }: FormProps) {
  const stores = useLoad(() => api.stores(), []);
  const users = useUsers();
  const [name, setName] = useState('');
  const [checklist, setChecklist] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [rep, setRep] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const { busy, error, run } = useAction();
  const open = (stores.data?.items ?? []).filter((s) => s.status !== 'closed' && includesText([s.name, s.storeCode, s.city], filter));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      api.createAuditRound({
        name: name.trim(),
        checklist: checklist.split('\n').map((c) => c.trim()).filter(Boolean),
        dueDate: dueDate || null,
        visitDate: new Date(visitDate).toISOString(),
        fieldRepId: rep || null,
        storeIds: selected,
      }),
    ).then((r) => r && onDone(`/retailpower/audit-rounds/${r.id}`, `Audit round created with ${selected.length} store visit${selected.length === 1 ? '' : 's'}`));
  };
  return (
    <form onSubmit={submit}>
      <Field label="Name"><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 shelf audit" autoFocus /></Field>
      <Field label="Checklist" hint="One item per line; shown in every visit report of this round">
        <textarea rows={4} value={checklist} onChange={(e) => setChecklist(e.target.value)} placeholder={'Price tags correct\nPromo display in place'} />
      </Field>
      <Field label="Planned visit date and time"><input required type="datetime-local" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} /></Field>
      <Field label="Round due date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      <Field label="Field representative" hint="Leave empty to assign the visits to yourself">
        <select value={rep} onChange={(e) => setRep(e.target.value)}>
          <option value="">Me</option>
          {users.map((u) => <option key={u.id} value={u.id}>{userName(users, u.id)}</option>)}
        </select>
      </Field>
      <Field label={`Stores (${selected.length} selected)`}>
        <input placeholder="Filter stores" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="check-list">
          <label className="check-row"><input type="checkbox" checked={open.length > 0 && open.every((s) => selected.includes(s.id))} onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...open.map((s) => s.id)])] : selected.filter((id) => !open.some((s) => s.id === id)))} /> <strong>Select all shown</strong></label>
          {open.map((s) => (
            <label key={s.id} className="check-row">
              <input type="checkbox" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} /> {s.name} <span className="muted small">{s.storeCode}{s.city ? ` · ${s.city}` : ''}</span>
            </label>
          ))}
        </div>
      </Field>
      <ErrorText error={error} />
      <FormActions busy={busy || selected.length === 0} submitLabel="Create round and plan visits" onCancel={onCancel} />
    </form>
  );
}

export function AuditRoundsView() {
  const { openNew } = useShell();
  const rounds = useLoad(() => api.auditRounds(), []);
  return (
    <ViewFrame title="Audit rounds" subtitle="A batch of store visits with one checklist" crumbs={[SUITE, { label: 'Audit rounds' }]} actions={<button className="primary" onClick={() => openNew('audit_round')}>+ New audit round</button>}>
      {!rounds.data && <Loading error={rounds.error} />}
      {rounds.data?.length === 0 && <EmptyState title="No audit rounds yet">Plan visits to many stores at once with “+ New audit round”.</EmptyState>}
      {rounds.data && rounds.data.length > 0 && (
        <table className="grid clickable">
          <thead><tr><th>Round</th><th>Due</th><th>Progress</th><th className="num">Issues</th><th>Status</th></tr></thead>
          <tbody>
            {rounds.data.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/retailpower/audit-rounds/${r.id}`)}>
                <td><a href={`#/retailpower/audit-rounds/${r.id}`}>{r.name}</a><div className="muted small">{r.checklist.length} checklist items</div></td>
                <td>{r.dueDate ? formatDate(r.dueDate) : '—'}</td>
                <td><Progress done={r.completedCount ?? 0} total={r.visitCount ?? 0} /></td>
                <td className="num">{r.issueCount ?? 0}</td>
                <td><StatusBadge status={r.status === 'open' ? 'active' : 'archived'} label={r.status === 'open' ? 'Open' : 'Closed'} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress" title={`${done} of ${total} visits completed`}>
      <div className="progress-bar"><span style={{ width: `${pct}%` }} /></div>
      <span className="small muted">{done}/{total}</span>
    </div>
  );
}

export function AuditRoundDossier({ id }: { id: string }) {
  const { notify } = useShell();
  const round = useLoad(() => api.auditRound(id), [id]);
  const action = useAction();
  const crumbs = [SUITE, { label: 'Audit rounds', href: '#/retailpower/audit-rounds' }];
  if (!round.data) return <ViewFrame title="Audit round" crumbs={[...crumbs, { label: 'Loading…' }]}><Loading error={round.error} /></ViewFrame>;
  const r: AuditRound = round.data;
  const visits = r.visits ?? [];
  const done = visits.filter((v) => v.status === 'COMPLETED').length;
  const toggle = () => void action.run(() => api.setAuditRoundStatus(id, r.status === 'open' ? 'closed' : 'open')).then((x) => x && (notify(x.status === 'closed' ? 'Round closed' : 'Round reopened'), round.reload()));
  return (
    <ViewFrame
      title={r.name}
      subtitle={<StatusBadge status={r.status === 'open' ? 'active' : 'archived'} label={r.status === 'open' ? 'Open' : 'Closed'} />}
      crumbs={[...crumbs, { label: r.name }]}
      actions={<button className="secondary" disabled={action.busy} onClick={toggle}>{r.status === 'open' ? 'Close round' : 'Reopen round'}</button>}
    >
      <ErrorText error={action.error} />
      <div className="kpi-grid">
        <div className="kpi kpi-purple"><span>Visits completed</span><strong>{done} / {visits.length}</strong></div>
        <div className="kpi kpi-indigo"><span>Due</span><strong>{r.dueDate ? formatDate(r.dueDate) : '—'}</strong></div>
        <div className="kpi kpi-emerald"><span>Compliant</span><strong>{visits.filter((v) => v.complianceStatus === 'compliant').length}</strong></div>
        <div className="kpi kpi-blue"><span>Needs attention</span><strong>{visits.filter((v) => v.complianceStatus && v.complianceStatus !== 'compliant').length}</strong></div>
      </div>
      <div className="card-panel">
        <h2>Checklist</h2>
        {r.checklist.length === 0 ? <p className="muted">No extra checklist items; the standard visit checklist applies.</p> : <ul>{r.checklist.map((c) => <li key={c}>{c}</li>)}</ul>}
      </div>
      <div className="card-panel">
        <h2>Store visits</h2>
        <table className="grid clickable">
          <thead><tr><th>Store</th><th>Planned</th><th>Field rep</th><th>Status</th><th>Result</th><th className="num">Planogram</th></tr></thead>
          <tbody>
            {visits.map((v) => (
              <tr key={v.id} onClick={() => navigate(`/retailpower/store-visits/${v.id}`)}>
                <td><a href={`#/retailpower/store-visits/${v.id}`}>{v.storeName}</a> <span className="muted small">{v.storeCode}</span></td>
                <td>{formatDateTime(v.visitDate)}</td>
                <td>{v.fieldRepName ?? '—'}</td>
                <td><StatusBadge status={v.status} label={VISIT_STATUS[v.status]} /></td>
                <td>{v.complianceStatus ? <StatusBadge status={v.complianceStatus} label={COMPLIANCE[v.complianceStatus] ?? v.complianceStatus} /> : '—'}</td>
                <td className="num">{v.planogramScore != null ? `${v.planogramScore}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ViewFrame>
  );
}

/* ---------- Field calendar ---------- */

const MAX_VISITS_PER_DAY = 6;

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function FieldCalendarView({ route }: { route: Route }) {
  const users = useUsers();
  const visits = useLoad(() => api.visits(), []);
  const stores = useLoad(() => api.stores(), []);
  const offset = Number(route.params.get('week') ?? 0) || 0;
  const monday = useMemo(() => {
    const m = startOfWeek(new Date());
    m.setDate(m.getDate() + offset * 7);
    return m;
  }, [offset]);
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const week = (visits.data?.items ?? []).filter((v) => v.status !== 'CANCELLED' && new Date(v.visitDate) >= monday && new Date(v.visitDate) < new Date(monday.getTime() + 7 * 86400000));
  const reps = [...new Set(week.map((v) => v.fieldRepId))];
  const storeName = (id: string) => stores.data?.items.find((s) => s.id === id)?.name ?? '…';
  return (
    <ViewFrame title="Field calendar" subtitle={`Week of ${formatDate(monday.toISOString())} · capacity ${MAX_VISITS_PER_DAY} visits per rep per day`} crumbs={[SUITE, { label: 'Field calendar' }]}
      actions={
        <>
          <button className="secondary" onClick={() => navigate(withParams(route, { week: String(offset - 1) }))}>‹ Previous week</button>
          <button className="secondary" onClick={() => navigate(withParams(route, { week: null }))}>This week</button>
          <button className="secondary" onClick={() => navigate(withParams(route, { week: String(offset + 1) }))}>Next week ›</button>
        </>
      }
    >
      {!visits.data && <Loading error={visits.error} />}
      {visits.data && reps.length === 0 && <EmptyState title="No visits planned this week">Plan visits with “+ New → Store visit” or an audit round.</EmptyState>}
      {reps.length > 0 && (
        <div className="calendar">
          <div className="cal-row cal-head">
            <div>Field rep</div>
            {days.map((d) => <div key={key(d)}>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>)}
          </div>
          {reps.map((rep) => (
            <div key={rep} className="cal-row">
              <div className="cal-rep">{userName(users, rep)}</div>
              {days.map((d) => {
                const cell = week.filter((v) => v.fieldRepId === rep && key(new Date(v.visitDate)) === key(d)).sort((a, b) => a.visitDate.localeCompare(b.visitDate));
                return (
                  <div key={key(d)} className={`cal-cell${cell.length > MAX_VISITS_PER_DAY ? ' over' : ''}`}>
                    {cell.length > MAX_VISITS_PER_DAY && <span className="cal-warn">Over capacity ({cell.length})</span>}
                    {cell.map((v) => (
                      <a key={v.id} href={`#/retailpower/store-visits/${v.id}`} className={`cal-visit st-${v.status.toLowerCase()}`}>
                        {new Date(v.visitDate).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} {storeName(v.storeId)}
                      </a>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </ViewFrame>
  );
}
