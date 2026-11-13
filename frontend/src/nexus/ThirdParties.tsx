import { api, type Client, type CompanySize, type EntityCategory, type OrganizationType } from '../api';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { includesText, Loading, SearchInput, useLoad } from '../ui';
import { t as tr, live } from '../i18n';

export const ENTITY_CATEGORY: Record<EntityCategory, string> = live(() => ({
  client: tr("Client"),
  vendor_client: tr("Vendor (also client)"),
  vendor_non_client: tr("Vendor (not a client)"),
  vendor_prospect: tr("Vendor prospect"),
  accountant: tr("Accountant"),
  notary: tr("Notary"),
  lawyer: tr("Lawyer"),
  consultant: tr("Consultant"),
  shareholder: tr("Shareholder"),
  bank: tr("Bank"),
  insurer: tr("Insurer"),
  agent: tr("Agent"),
  distributor: tr("Distributor"),
  landlord: tr("Landlord"),
  tenant: tr("Tenant"),
  office_outfitter: tr("Office outfitter"),
  sister_company: tr("Sister company"),
  subsidiary: tr("Subsidiary"),
  office_supplier: tr("Office supplier"),
  apparel_supplier: tr("Apparel supplier"),
  apparel_printer: tr("Apparel printer"),
  taxi_company: tr("Taxi company"),
  telecom_domain_provider: tr("Telecom / domain provider"),
  private: tr("Private (only visible to me)"),
}));

export const ORGANIZATION_TYPE: Record<OrganizationType, string> = live(() => ({
  commercial_enterprise: tr("Commercial enterprise"),
  sole_proprietor: tr("Sole proprietor"),
  foundation_nonprofit: tr("Foundation / non-profit"),
  government: tr("Government"),
  semi_government: tr("Semi-government"),
}));

export const COMPANY_SIZES: CompanySize[] = ['SME', 'Mid-Market', 'Large', 'Enterprise'];

/** Categories listed under Clients; everything else is a third party (relation). */
export function isClientCategory(category: EntityCategory | undefined): boolean {
  return !category || category === 'client' || category === 'vendor_client';
}

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

function initial(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

export function organizationLabel(c: Pick<Client, 'organizationType' | 'companySize'>): string {
  if (!c.organizationType) return '—';
  return ORGANIZATION_TYPE[c.organizationType] + (c.companySize ? ` (${c.companySize})` : '');
}

export function PhoneLink({ phone }: { phone: string | null | undefined }) {
  if (!phone) return <span className="muted">—</span>;
  return <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>{phone}</a>;
}

export function ThirdPartiesView({ route }: { route: Route }) {
  const suite = route.segments[0] === 'symphony' ? 'symphony' : 'nexus';
  const { openNew } = useShell();
  const letter = route.params.get('letter') ?? '';
  const category = route.params.get('category') ?? 'third';
  const type = route.params.get('type') ?? '';
  const q = route.params.get('q') ?? '';
  const { data, error } = useLoad(() => api.clients(), []);
  const items = data ?? [];
  const inCategory = (c: Client) =>
    category === 'all' ? true : category === 'third' ? !isClientCategory(c.entityCategory) : c.entityCategory === category;
  const filtered = items
    .filter((c) => inCategory(c) && (!type || c.organizationType === type) && (!letter || initial(c.name) === letter)
      && includesText([c.name, c.legalName, c.city, c.phone, ENTITY_CATEGORY[c.entityCategory]], q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const present = new Set(items.filter(inCategory).map((c) => initial(c.name)));
  const set = (patch: Record<string, string | null>) => navigate(withParams(route, patch));
  return (
    <ViewFrame
      title={tr("Third parties")}
      subtitle={tr("Relations other than clients: vendors, advisers, banks, landlords and more. Private entries are visible only to you.")}
      crumbs={[{ label: tr("Third parties") }]}
      actions={<button className="primary" onClick={() => openNew('client', { entityCategory: 'vendor_non_client' })}>{tr("+ New third party")}</button>}
    >
      <div className="list-toolbar">
        <select aria-label={tr("Category")} value={category} onChange={(e) => set({ category: e.target.value === 'third' ? null : e.target.value })}>
          <option value="third">{tr("All third parties")}</option>
          <option value="all">{tr("All entities, including clients")}</option>
          {(Object.keys(ENTITY_CATEGORY) as EntityCategory[]).map((k) => <option key={k} value={k}>{ENTITY_CATEGORY[k]}</option>)}
        </select>
        <select aria-label={tr("Organisation type")} value={type} onChange={(e) => set({ type: e.target.value || null })}>
          <option value="">{tr("All organisation types")}</option>
          {(Object.keys(ORGANIZATION_TYPE) as OrganizationType[]).map((k) => <option key={k} value={k}>{ORGANIZATION_TYPE[k]}</option>)}
        </select>
        <SearchInput value={q} onChange={(v) => set({ q: v || null })} placeholder={tr("Filter by name, city or phone")} />
      </div>
      <div className="az-filter" role="group" aria-label={tr("First letter")}>
        <button type="button" className={letter === '' ? 'active' : ''} onClick={() => set({ letter: null })}>{tr("All")}</button>
        {LETTERS.map((l) => (
          <button key={l} type="button" className={letter === l ? 'active' : ''} disabled={!present.has(l)} onClick={() => set({ letter: l })}>{l === '#' ? '0–9' : l}</button>
        ))}
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && <EmptyState title={tr("No third parties match this filter")} action={<button className="primary" onClick={() => openNew('client', { entityCategory: 'vendor_non_client' })}>{tr("+ New third party")}</button>} />}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>{tr("Name")}</th>
              <th>{tr("Category")}</th>
              <th>{tr("Organisation type")}</th>
              <th>{tr("City")}</th>
              <th>{tr("Phone")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} onClick={() => navigate(`/${suite}/clients/${c.id}`)}>
                <td><a href={`#/${suite}/clients/${c.id}`}>{c.name}</a>{c.legalName && c.legalName !== c.name && <div className="muted small">{c.legalName}</div>}</td>
                <td>{ENTITY_CATEGORY[c.entityCategory] ?? c.entityCategory}</td>
                <td>{organizationLabel(c)}</td>
                <td>{c.city ?? '—'}</td>
                <td><PhoneLink phone={c.phone} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}
