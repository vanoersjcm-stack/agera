import { type MouseEvent, useState } from 'react';
import { api, type Client, type CompanySize, type EntityCategory, type OrganizationType } from '../api';
import { EmptyState, ViewFrame } from '../Layout';
import { navigate, type Route, withParams } from '../router';
import { useShell } from '../shell';
import { includesText, Loading, SearchInput, useLoad } from '../ui';
import { getLanguage, t as tr, tf, live } from '../i18n';

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
  doctor: tr("Doctor / GP"),
  hospital: tr("Hospital"),
  fire_department: tr("Fire department"),
  emergency_112_191: tr("Emergency number (112 / 191)"),
  police: tr("Police"),
  cleaning_supplier: tr("Cleaning company"),
  packaging_supplier: tr("Packaging supplier"),
  car_rental: tr("Car rental"),
  apparel_merchandiser: tr("Apparel merchandiser"),
  catering: tr("Catering"),
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

/** Category keys sorted by their label in the current language; `thirdOnly` leaves out the client categories. */
export function sortedCategories(thirdOnly = false): EntityCategory[] {
  return (Object.keys(ENTITY_CATEGORY) as EntityCategory[])
    .filter((k) => !thirdOnly || !isClientCategory(k))
    .sort((a, b) => ENTITY_CATEGORY[a].localeCompare(ENTITY_CATEGORY[b], getLanguage()));
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

const canDial = () => window.matchMedia('(pointer: coarse), (max-width: 767px)').matches;

/** Phones and small screens get a tel: link; desktops get selectable text with a copy button, so no external dialer opens. */
export function PhoneLink({ phone }: { phone: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!phone) return <span className="muted">—</span>;
  if (canDial()) return <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>{phone}</a>;
  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(phone).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span className="phone-copy" onClick={(e) => e.stopPropagation()}>
      <span className="selectable">{phone}</span>
      <button type="button" className="icon-button has-tip" data-tip={copied ? tr("Copied") : tr("Copy phone number")} aria-label={tr("Copy phone number")} onClick={copy}>{copied ? '✓' : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>}</button>
    </span>
  );
}

/** E-mail addresses open Agera's own composer with the recipient filled in. */
export function EmailLink({ email, name }: { email: string | null | undefined; name?: string }) {
  const { openNew } = useShell();
  if (!email) return <span className="muted">—</span>;
  return (
    <button type="button" className="link-button has-tip" data-tip={tf("Write an Agera.email to {name}", { name: name ?? email })}
      onClick={(e) => { e.stopPropagation(); openNew('doc_mail', { to: email, toName: name ?? '' }); }}>{email}</button>
  );
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
      && includesText([c.name, c.legalName, c.city, c.phone, c.email, ENTITY_CATEGORY[c.entityCategory]], q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const present = new Set(items.filter(inCategory).map((c) => initial(c.name)));
  const set = (patch: Record<string, string | null>) => navigate(withParams(route, patch));
  return (
    <ViewFrame
      title={tr("Third parties")}
      subtitle={tr("Relations other than clients: vendors, advisers, banks, landlords and more. Private entries are visible only to you.")}
      crumbs={[{ label: tr("Third parties") }]}
      actions={<button className="primary" onClick={() => openNew('client', { thirdParty: '1' })}>{tr("+ New third party")}</button>}
    >
      <div className="list-toolbar">
        <select aria-label={tr("Category")} value={category} onChange={(e) => set({ category: e.target.value === 'third' ? null : e.target.value })}>
          <option value="third">{tr("All categories")}</option>
          {sortedCategories(true).map((k) => <option key={k} value={k}>{ENTITY_CATEGORY[k]}</option>)}
        </select>
        <select aria-label={tr("Organisation type")} value={type} onChange={(e) => set({ type: e.target.value || null })}>
          <option value="">{tr("All organisation types")}</option>
          {(Object.keys(ORGANIZATION_TYPE) as OrganizationType[]).map((k) => <option key={k} value={k}>{ORGANIZATION_TYPE[k]}</option>)}
        </select>
        <SearchInput value={q} onChange={(v) => set({ q: v || null })} placeholder={tr("Filter by name, city, phone or e-mail")} />
      </div>
      <div className="az-filter" role="group" aria-label={tr("First letter")}>
        <button type="button" className={letter === '' ? 'active' : ''} onClick={() => set({ letter: null })}>{tr("All")}</button>
        {LETTERS.map((l) => (
          <button key={l} type="button" className={letter === l ? 'active' : ''} disabled={!present.has(l)} onClick={() => set({ letter: l })}>{l === '#' ? '0–9' : l}</button>
        ))}
      </div>
      {!data && <Loading error={error} />}
      {data && filtered.length === 0 && <EmptyState title={tr("No third parties match this filter")} action={<button className="primary" onClick={() => openNew('client', { thirdParty: '1' })}>{tr("+ New third party")}</button>} />}
      {filtered.length > 0 && (
        <table className="grid clickable">
          <thead>
            <tr>
              <th>{tr("Name")}</th>
              <th>{tr("Category")}</th>
              <th>{tr("Organisation type")}</th>
              <th>{tr("City")}</th>
              <th>{tr("Phone")}</th>
              <th>{tr("Email")}</th>
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
                <td><EmailLink email={c.email} name={c.name} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ViewFrame>
  );
}
