/** Wave B: RetailPower back office — dashboard, crew directory, validated hours, fleet, apparel, RMA and stock-protection claims. */
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  api, type ApparelAssignment, type ClaimStatus, type CrewAvailability, type CrewMember, type OpsDashboard, type PoBilling, type PoCategory, type PurchaseOrder, type RackjobCheck, type ReturnChannel,
  type RmaCase, type RmaStatus, type RotationRule, type Shift, type StockClaim, type VehicleAllocation, type VehicleSide,
} from '../api';
import { userContext } from '../context';
import { formatAmount } from '../format';
import { useClients, useUsers } from '../directory';
import { formatDate, formatDateTime } from '../labels';
import { EmptyState, ViewFrame } from '../Layout';
import { Drawer, ErrorText, Field, FilterChips, FormActions, includesText, Loading, SearchInput, StatusBadge, Tabs, useAction, useLoad } from '../ui';
import { numberLocale, t, tf, live } from '../i18n';

const SUITE = live(() => ({ label: t("RetailPower"), href: '#/retailpower' }));
const SIDES: VehicleSide[] = ['front', 'back', 'left', 'right'];
const SIDE_LABEL: Record<VehicleSide, string> = live(() => ({ front: t("Front"), back: t("Back"), left: t("Left side"), right: t("Right side") }));
const AVAILABILITY_LABEL: Record<CrewAvailability, string> = live(() => ({ available: t("Available"), busy: t("Busy"), on_leave: t("On leave"), inactive: t("Inactive") }));
const DAY_LABEL = live(() => ([t("Mon"), t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat"), t("Sun")]));
const SHIFT_LABEL: Record<string, string> = live(() => ({ pending: t("Awaiting sign-off"), approved: t("Approved"), rejected: t("Rejected") }));
const VEHICLE_LABEL: Record<string, string> = live(() => ({ pending_check: t("Pending 4-photo check"), active: t("Vehicle active"), returned: t("Vehicle returned") }));
const CHANNEL_LABEL: Record<ReturnChannel, string> = live(() => ({ merchandiser: t("Merchandiser / rackjobber"), store: t("Direct return by store") }));

/** Return channel picker; the tracking/reference field only appears for direct returns by the store. */
function ChannelFields({ channel, tracking, onChannel, onTracking }: { channel: ReturnChannel; tracking: string; onChannel: (c: ReturnChannel) => void; onTracking: (v: string) => void }) {
  return (
    <>
      <select aria-label={t("Return channel")} value={channel} onChange={(e) => onChannel(e.target.value as ReturnChannel)}>
        {(Object.keys(CHANNEL_LABEL) as ReturnChannel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
      </select>
      {channel === 'store' && <input aria-label={t("Tracking / reference")} placeholder={t("Tracking / reference (optional)")} maxLength={100} value={tracking} onChange={(e) => onTracking(e.target.value)} />}
    </>
  );
}

function ChannelCell({ channel, tracking }: { channel: ReturnChannel; tracking: string | null }) {
  return <td>{CHANNEL_LABEL[channel]}{tracking && <><br /><span className="muted small">{tracking}</span></>}</td>;
}

const RMA_LABEL: Record<RmaStatus, string> = live(() => ({ open: t("Open"), approved: t("Approved"), shipped: t("Shipped back"), credited: t("Credited"), rejected: t("Rejected") }));
const RMA_NEXT: Record<RmaStatus, RmaStatus[]> = { open: ['approved', 'rejected'], approved: ['shipped', 'rejected'], shipped: ['credited', 'rejected'], credited: [], rejected: [] };
const RMA_REASON: Record<string, string> = live(() => ({ damaged: t("Damaged"), defective: t("Defective"), wrong_delivery: t("Wrong delivery"), expired: t("Expired"), recall: t("Recall"), other: t("Other") }));
const CLAIM_LABEL: Record<ClaimStatus, string> = live(() => ({ submitted: t("Submitted"), approved: t("Approved"), rejected: t("Rejected"), paid: t("Paid") }));
const CLAIM_NEXT: Record<ClaimStatus, ClaimStatus[]> = { submitted: ['approved', 'rejected'], approved: ['paid'], rejected: [], paid: [] };
const CLAIM_TYPE: Record<string, string> = live(() => ({ price_protection: t("Price protection"), damaged: t("Damaged"), expired: t("Expired"), shrinkage: t("Shrinkage"), other: t("Other") }));
const APPAREL_ITEM: Record<string, string> = live(() => ({ polo: t("Polo shirt"), jacket: t("Jacket"), trousers: t("Trousers"), cap: t("Cap"), shoes: t("Safety shoes"), badge: t("Badge"), other: t("Other") }));

const today = () => new Date().toISOString().slice(0, 10);
const num = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '—' : n.toLocaleString(numberLocale(), { maximumFractionDigits: digits }));
const euro = (v: string | number) => Number(v).toLocaleString(numberLocale(), { style: 'currency', currency: 'EUR' });

function useStores() {
  return useLoad(() => api.stores().then((p) => p.items)).data ?? [];
}

function Photo({ url, alt }: { url: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    api.photoBlob(url).then((blob) => {
      obj = URL.createObjectURL(blob);
      setSrc(obj);
    }, () => setSrc(null));
    return () => {
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [url]);
  return src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={alt} /></a> : <div className="photo-placeholder">{t("Loading…")}</div>;
}

/* ---------- Back office dashboard ---------- */

export function BackOfficeView() {
  const { data, error } = useLoad<OpsDashboard>(() => api.opsDashboard());
  const k = data?.kpis;
  return (
    <ViewFrame title={t("Back office")} subtitle={t("Last 30 days across all chains")} crumbs={[SUITE, { label: t("Back office") }]}>
      {!data && <Loading error={error} />}
      {data && k && (
        <>
          <div className="kpi-grid" aria-label={t("KPIs across chains")}>
            <div className="kpi kpi-purple"><span>{t("Chains")}</span><strong>{num(k.chains)}</strong></div>
            <div className="kpi kpi-indigo"><span>{t("Stores")}</span><strong>{num(k.stores)}</strong></div>
            <div className="kpi kpi-blue"><span>{t("Visits completed")}</span><strong>{num(k.completed30)} / {num(k.visits30)}</strong></div>
            <div className="kpi kpi-emerald"><span>{t("Compliance")}</span><strong>{k.compliancePercent === null ? '—' : `${num(k.compliancePercent)}%`}</strong></div>
            <div className="kpi kpi-purple"><span>{t("Photos")}</span><strong>{num(k.photos30)}</strong></div>
            <div className="kpi kpi-indigo"><span>{t("Hours awaiting sign-off")}</span><strong><a href="#/retailpower/hours">{num(k.pendingShifts)}</a></strong></div>
            <div className="kpi kpi-blue"><span>{t("Open returns / claims")}</span><strong><a href="#/retailpower/fleet">{num(k.openRma)} / {num(k.openClaims)}</a></strong></div>
            <div className="kpi kpi-emerald"><span>{t("Crew available")}</span><strong><a href="#/retailpower/crew">{num(k.availableCrew)}</a></strong></div>
          </div>
          <section className="card-panel">
            <h2>{t("Chain performance")}</h2>
            {(

              <div className="table-wrap">
                <table className="grid">
                  <thead><tr><th>{t("Chain")}</th><th>{t("Stores")}</th><th>{t("Visits")}</th><th>{t("Completed")}</th><th>{t("Compliant")}</th><th>{t("Not compliant")}</th><th>{t("Photos")}</th><th>{t("Last visit")}</th></tr></thead>
                  <tbody>
                    {data.chains.length === 0 && (
                      <tr className="muted"><td>{t("No chains yet")}</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>—</td></tr>
                    )}
                    {data.chains.map((c) => (
                      <tr key={c.clientId ?? 'none'}>
                        <td>{c.clientId ? <a href={`#/nexus/clients/${c.clientId}`}>{c.chain}</a> : c.chain ? t(c.chain) : <span className="muted">{t("No chain")}</span>}</td>
                        <td>{num(c.stores)}</td><td>{num(c.visits30)}</td><td>{num(c.completed30)}</td><td>{num(c.compliant)}</td>
                        <td>{c.nonCompliant > 0 ? <StatusBadge status="not_compliant" label={num(c.nonCompliant)} /> : 0}</td>
                        <td>{num(c.photos30)}</td><td>{c.lastVisit ? formatDate(c.lastVisit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card-panel">
            <h2>{t("Photo audit gallery")}</h2>
            {data.photos.length === 0 ? <p className="muted">{t("No visit photos yet.")}</p> : (
              <div className="photos">
                {data.photos.map((p) => (
                  <figure className="photo" key={p.id}>
                    <Photo url={p.url} alt={t("Visit photo")} />
                    <figcaption><a href={`#/retailpower/store-visits/${p.visitId}`}>{p.storeName}</a>{p.chain ? ` · ${p.chain}` : ''}<br />{formatDate(p.visitDate)}{p.repName ? ` · ${p.repName}` : ''}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </ViewFrame>
  );
}

/* ---------- Crew directory ---------- */

function tagList(value: string): string[] {
  return [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
}

function CrewForm({ member, onDone, onCancel }: { member: CrewMember | null; onDone: () => void; onCancel: () => void }) {
  const users = useUsers();
  const [userId, setUserId] = useState(member?.userId ?? '');
  const [contractType, setContractType] = useState(member?.contractType ?? 'fixed');
  const [availability, setAvailability] = useState<CrewAvailability>(member?.availability ?? 'available');
  const [languages, setLanguages] = useState((member?.languages ?? []).join(', '));
  const [certs, setCerts] = useState((member?.brandCertifications ?? []).join(', '));
  const [days, setDays] = useState<number[]>(member?.availableDays ?? [1, 2, 3, 4, 5]);
  const [homeRegion, setHomeRegion] = useState(member?.homeRegion ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = { contractType, availability, languages: tagList(languages), brandCertifications: tagList(certs), availableDays: days, homeRegion: homeRegion || null, phone: phone || null };
    const ok = await run(() => (member ? api.updateCrew(member.id, body) : api.createCrew({ ...body, userId })));
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit}>
      {!member && (
        <Field label={t("Person")}>
          <select required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">{t("Choose…")}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
        </Field>
      )}
      <Field label={t("Contract")}>
        <select value={contractType} onChange={(e) => setContractType(e.target.value as 'fixed' | 'flex')}>
          <option value="fixed">{t("Fixed")}</option><option value="flex">{t("Flex")}</option>
        </select>
      </Field>
      <Field label={t("Availability")}>
        <select value={availability} onChange={(e) => setAvailability(e.target.value as CrewAvailability)}>
          {Object.entries(AVAILABILITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label={t("Working days")}>
        <div className="chip-row">
          {DAY_LABEL.map((d, i) => (
            <label key={d} className="check-row"><input type="checkbox" checked={days.includes(i + 1)} onChange={(e) => setDays(e.target.checked ? [...days, i + 1].sort() : days.filter((x) => x !== i + 1))} /> {d}</label>
          ))}
        </div>
      </Field>
      <Field label={t("Languages")} hint={t("Comma-separated, e.g. nl, en, ar")}><input value={languages} onChange={(e) => setLanguages(e.target.value)} /></Field>
      <Field label={t("Brand certifications")} hint={t("Comma-separated")}><input value={certs} onChange={(e) => setCerts(e.target.value)} /></Field>
      <Field label={t("Home region")}><input value={homeRegion} maxLength={100} onChange={(e) => setHomeRegion(e.target.value)} /></Field>
      <Field label={t("Phone")}><input value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={member ? t("Save") : t("Add to crew")} onCancel={onCancel} />
    </form>
  );
}

export function CrewView() {
  const list = useLoad(() => api.crew());
  const [availability, setAvailability] = useState('all');
  const [contract, setContract] = useState('all');
  const [language, setLanguage] = useState('');
  const [cert, setCert] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CrewMember | 'new' | null>(null);
  const crew = list.data ?? [];
  const languages = useMemo(() => [...new Set(crew.flatMap((c) => c.languages))].sort(), [crew]);
  const certs = useMemo(() => [...new Set(crew.flatMap((c) => c.brandCertifications))].sort(), [crew]);
  const shown = crew.filter((c) =>
    (availability === 'all' || c.availability === availability)
    && (contract === 'all' || c.contractType === contract)
    && (!language || c.languages.includes(language))
    && (!cert || c.brandCertifications.includes(cert))
    && includesText([c.name, c.email, c.homeRegion], search));
  return (
    <ViewFrame title={t("Crew directory")} subtitle={t("Merchandisers, their contract, languages, brand certifications and availability")} crumbs={[SUITE, { label: t("Crew directory") }]}
      actions={<button className="primary" onClick={() => setEditing('new')}>{t("+ Add crew member")}</button>}>
      {!list.data && <Loading error={list.error} />}
      {list.data && (
        <>
          <div className="list-toolbar">
            <SearchInput value={search} onChange={setSearch} placeholder={t("Search name, e-mail or region")} />
            <FilterChips value={availability} onChange={setAvailability} chips={[{ value: 'all', label: t("All") }, ...Object.entries(AVAILABILITY_LABEL).map(([value, label]) => ({ value, label }))]} />
            <FilterChips value={contract} onChange={setContract} chips={[{ value: 'all', label: t("Fixed & flex") }, { value: 'fixed', label: t("Fixed") }, { value: 'flex', label: t("Flex") }]} />
            <label>{t("Language")} <select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="">{t("Any")}</option>{languages.map((l) => <option key={l}>{l}</option>)}</select></label>
            <label>{t("Certification")} <select value={cert} onChange={(e) => setCert(e.target.value)}><option value="">{t("Any")}</option>{certs.map((l) => <option key={l}>{l}</option>)}</select></label>
          </div>
          {shown.length === 0 ? <EmptyState title={crew.length ? t("No crew members match these filters") : t("No crew members yet")} /> : (
            <div className="table-wrap">
              <table className="grid">
                <thead><tr><th>{t("Name")}</th><th>{t("Availability")}</th><th>{t("Contract")}</th><th>{t("Working days")}</th><th>{t("Languages")}</th><th>{t("Brand certifications")}</th><th>{t("Region")}</th><th>{t("Open visits")}</th><th>{t("Vehicle")}</th><th /></tr></thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}<br /><span className="muted">{c.email}</span></td>
                      <td><StatusBadge status={c.availability === 'available' ? 'active' : c.availability === 'busy' ? 'needs_follow_up' : 'archived'} label={AVAILABILITY_LABEL[c.availability]} /></td>
                      <td>{c.contractType === 'fixed' ? t("Fixed") : t("Flex")}</td>
                      <td>{c.availableDays.map((d) => DAY_LABEL[d - 1]).join(' ')}</td>
                      <td>{c.languages.join(', ') || '—'}</td>
                      <td>{c.brandCertifications.join(', ') || '—'}</td>
                      <td>{c.homeRegion ?? '—'}</td>
                      <td>{c.openVisits}</td>
                      <td>{c.vehicleId ?? '—'}</td>
                      <td><button onClick={() => setEditing(c)}>{t("Edit")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editing && (
        <Drawer title={editing === 'new' ? t("Add crew member") : t("Edit crew member")} onClose={() => setEditing(null)}>
          <CrewForm member={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} />
        </Drawer>
      )}
    </ViewFrame>
  );
}

/* ---------- Validated hours ---------- */

function position(): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(undefined), { timeout: 8000 });
  });
}

function ClockCard({ onChange }: { onChange: () => void }) {
  const open = useLoad(() => api.myOpenShift());
  const stores = useStores();
  const [storeId, setStoreId] = useState('');
  const { busy, error, run } = useAction();
  const shift = open.data;
  const clockIn = async () => {
    const pos = await position();
    if (await run(() => api.clockIn({ storeId: storeId || null, ...pos }))) { open.reload(); onChange(); }
  };
  const clockOut = async () => {
    const pos = await position();
    if (await run(() => api.clockOut({ ...pos }))) { open.reload(); onChange(); }
  };
  return (
    <section className="card-panel">
      <h2>{t("My shift")}</h2>
      {open.data === null && !open.error && open.data !== undefined && !shift && (
        <div className="list-toolbar">
          <label>{t("Store")} <select value={storeId} onChange={(e) => setStoreId(e.target.value)}><option value="">{t("No store")}</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className="primary" disabled={busy} onClick={clockIn}>{t("Clock in")}</button>
        </div>
      )}
      {shift && (
        <p>
          {t("Clocked in since")} {formatDateTime(shift.clockInAt)}{shift.storeName ? ` · ${shift.storeName}` : ''}
          {shift.geofenceDistanceM !== null && ` · ${num(shift.geofenceDistanceM)} m ${t("from the store")}`}
          {' '}<button className="primary" disabled={busy} onClick={clockOut}>{t("Clock out")}</button>
        </p>
      )}
      <p className="muted">{t("Your location is only used to check the distance to the store (geofence).")}</p>
      <ErrorText error={error ?? open.error} />
    </section>
  );
}

function RecordShiftForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const users = useUsers();
  const stores = useStores();
  const [userId, setUserId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [date, setDate] = useState(today());
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api.recordShift({ userId, storeId: storeId || null, clockInAt: new Date(`${date}T${start}`).toISOString(), clockOutAt: new Date(`${date}T${end}`).toISOString(), notes: notes || null }));
    if (ok) onDone();
  };
  return (
    <form onSubmit={submit}>
      <Field label={t("Person")}>
        <select required value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">{t("Choose…")}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
      </Field>
      <Field label={t("Store")}><select value={storeId} onChange={(e) => setStoreId(e.target.value)}><option value="">{t("No store")}</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label={t("Date")}><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t("Start")}><input type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
      <Field label={t("End")}><input type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      <Field label={t("Notes")}><textarea value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={t("Record shift")} onCancel={onCancel} />
    </form>
  );
}

export function HoursView() {
  const [status, setStatus] = useState('pending');
  const list = useLoad(() => api.shifts(status === 'all' ? {} : { status: status as Shift['validationStatus'] }), [status]);
  const [recording, setRecording] = useState(false);
  const monthStart = new Date(); monthStart.setDate(1);
  const [from, setFrom] = useState(monthStart.toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const { busy, error, run } = useAction();
  const decide = async (s: Shift, decision: 'approved' | 'rejected') => {
    let reason: string | undefined;
    if (decision === 'rejected') {
      reason = window.prompt(t("Why are these hours rejected?")) ?? undefined;
      if (!reason) return;
    }
    if (await run(() => api.validateShift(s.id, decision, reason))) list.reload();
  };
  const exportCsv = () => run(() => api.exportHours(new Date(`${from}T00:00`).toISOString(), new Date(`${to}T23:59:59`).toISOString()));
  return (
    <ViewFrame title={t("Validated hours")} subtitle={t("Shifts are signed off by a coordinator before they go to HR")} crumbs={[SUITE, { label: t("Validated hours") }]}
      actions={<button onClick={() => setRecording(true)}>{t("+ Record shift")}</button>}>
      <ClockCard onChange={list.reload} />
      <section className="card-panel">
        <h2>{t("Export approved hours for HR")}</h2>
        <div className="list-toolbar">
          <label>{t("From")} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{t("To")} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button disabled={busy} onClick={exportCsv}>{t("Download CSV")}</button>
        </div>
      </section>
      <div className="list-toolbar">
        <FilterChips value={status} onChange={setStatus} chips={[{ value: 'pending', label: t("Awaiting sign-off") }, { value: 'approved', label: t("Approved") }, { value: 'rejected', label: t("Rejected") }, { value: 'all', label: t("All") }]} />
      </div>
      <ErrorText error={error} />
      {!list.data && <Loading error={list.error} />}
      {list.data?.length === 0 && <EmptyState title={t("No shifts here")} />}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>{t("Person")}</th><th>{t("Store")}</th><th>{t("Clock in")}</th><th>{t("Clock out")}</th><th>{t("Hours")}</th><th>{t("Distance to store")}</th><th>{t("Status")}</th><th /></tr></thead>
            <tbody>
              {list.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.userName}{s.contractType && <span className="muted"> · {s.contractType === 'fixed' ? t("Fixed") : t("Flex")}</span>}</td>
                  <td>{s.storeName ?? '—'}</td>
                  <td>{formatDateTime(s.clockInAt)}</td>
                  <td>{s.clockOutAt ? formatDateTime(s.clockOutAt) : <StatusBadge status="needs_follow_up" label={t("Running")} />}</td>
                  <td>{num(s.hours, 2)}</td>
                  <td>{s.geofenceDistanceM === null ? '—' : <span className={s.geofenceDistanceM > 250 ? 'error' : undefined}>{num(s.geofenceDistanceM)} m</span>}</td>
                  <td><StatusBadge status={s.validationStatus} label={SHIFT_LABEL[s.validationStatus]} />{s.rejectionReason && <><br /><span className="muted">{s.rejectionReason}</span></>}{s.validatedByName && <><br /><span className="muted">{s.validatedByName}</span></>}</td>
                  <td>{s.validationStatus === 'pending' && s.clockOutAt && (
                    <><button className="primary" disabled={busy} onClick={() => decide(s, 'approved')}>{t("Approve")}</button> <button disabled={busy} onClick={() => decide(s, 'rejected')}>{t("Reject")}</button></>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recording && (
        <Drawer title={t("Record shift")} onClose={() => setRecording(false)}>
          <RecordShiftForm onCancel={() => setRecording(false)} onDone={() => { setRecording(false); list.reload(); }} />
        </Drawer>
      )}
    </ViewFrame>
  );
}

/* ---------- Fleet, apparel, RMA, stock claims ---------- */

function VehicleCard({ v, onChange }: { v: VehicleAllocation; onChange: () => void }) {
  const [odometer, setOdometer] = useState('');
  const [damage, setDamage] = useState('');
  const { busy, error, run } = useAction();
  const complete = SIDES.every((s) => v.photos[s]);
  const upload = async (side: VehicleSide, file: File | undefined) => {
    if (file && (await run(() => api.uploadVehiclePhoto(v.id, side, file)))) onChange();
  };
  return (
    <section className="card-panel">
      <h3>{v.vehicleId} <StatusBadge status={v.status === 'pending_check' ? 'needs_follow_up' : v.status === 'active' ? 'active' : 'archived'} label={VEHICLE_LABEL[v.status]} /></h3>
      <p className="muted">{v.userName}{v.description ? ` · ${v.description}` : ''} · {t("from")} {formatDate(v.allocatedFrom)}{v.allocatedUntil ? ` ${t("until")} ${formatDate(v.allocatedUntil)}` : ''}{v.odometerKm !== null ? ` · ${num(v.odometerKm)} km` : ''}</p>
      <div className="photos">
        {SIDES.map((side) => (
          <figure className="photo" key={side}>
            {v.photos[side] ? <Photo url={api.vehiclePhotoUrl(v.id, side)} alt={SIDE_LABEL[side]} /> : <div className="photo-placeholder">{t("No photo")}</div>}
            <figcaption>
              {SIDE_LABEL[side]}
              {v.status === 'pending_check' && <label className="button-like"> {v.photos[side] ? t("Replace") : t("Upload")}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => upload(side, e.target.files?.[0])} /></label>}
            </figcaption>
          </figure>
        ))}
      </div>
      {v.status === 'pending_check' && (
        <div className="list-toolbar">
          <label>{t("Odometer (km)")} <input type="number" min={0} value={odometer} onChange={(e) => setOdometer(e.target.value)} /></label>
          <label>{t("Damage notes")} <input value={damage} maxLength={2000} onChange={(e) => setDamage(e.target.value)} /></label>
          <button className="primary" disabled={busy || !complete} title={complete ? undefined : t("All four photos are required")}
            onClick={async () => { if (await run(() => api.completeVehicleCheck(v.id, { odometerKm: odometer ? Number(odometer) : null, damageNotes: damage || null }))) onChange(); }}>
            {t("Complete pre-trip check")}
          </button>
          {!complete && <span className="muted">{t("All four photos are required")}</span>}
        </div>
      )}
      {v.status === 'active' && <button disabled={busy} onClick={async () => { if (await run(() => api.returnVehicle(v.id))) onChange(); }}>{t("Register return")}</button>}
      <ErrorText error={error} />
    </section>
  );
}

function AllocateForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const users = useUsers();
  const [userId, setUserId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [description, setDescription] = useState('');
  const [fromDate, setFromDate] = useState(today());
  const [until, setUntil] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.allocateVehicle({ userId, vehicleId, description: description || null, allocatedFrom: fromDate || null, allocatedUntil: until || null }))) onDone();
  };
  return (
    <form onSubmit={submit}>
      <Field label={t("Person")}><select required value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">{t("Choose…")}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      <Field label={t("Licence plate")}><input required maxLength={30} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} /></Field>
      <Field label={t("Vehicle")}><input maxLength={150} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="VW Caddy" /></Field>
      <Field label={t("From")}><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
      <Field label={t("Until")}><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      <p className="muted">{t("The vehicle becomes active after the driver uploads four photos (front, back, left, right).")}</p>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={t("Allocate vehicle")} onCancel={onCancel} />
    </form>
  );
}

function FleetTab() {
  const list = useLoad(() => api.vehicles());
  const [show, setShow] = useState('current');
  const [adding, setAdding] = useState(false);
  const shown = (list.data ?? []).filter((v) => (show === 'current' ? v.status !== 'returned' : v.status === 'returned'));
  return (
    <>
      <div className="list-toolbar">
        <FilterChips value={show} onChange={setShow} chips={[{ value: 'current', label: t("Current") }, { value: 'returned', label: t("Returned vehicles") }]} />
        <button className="primary" onClick={() => setAdding(true)}>{t("+ Allocate vehicle")}</button>
      </div>
      {!list.data && <Loading error={list.error} />}
      {list.data && shown.length === 0 && <EmptyState title={t("No vehicles here")} />}
      {shown.map((v) => <VehicleCard key={v.id} v={v} onChange={list.reload} />)}
      {adding && <Drawer title={t("Allocate vehicle")} onClose={() => setAdding(false)}><AllocateForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} /></Drawer>}
    </>
  );
}

function ApparelTab() {
  const list = useLoad(() => api.apparel());
  const users = useUsers();
  const [userId, setUserId] = useState('');
  const [item, setItem] = useState('polo');
  const [size, setSize] = useState('');
  const [quantity, setQuantity] = useState('1');
  const { busy, error, run } = useAction();
  const issue = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.issueApparel({ userId, item, size: size || null, quantity: Number(quantity), issuedOn: null, notes: null }))) { setSize(''); list.reload(); }
  };
  return (
    <>
      <form className="list-toolbar" onSubmit={issue}>
        <select required aria-label={t("Person")} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">{t("Person…")}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <select aria-label={t("Item")} value={item} onChange={(e) => setItem(e.target.value)}>{Object.entries(APPAREL_ITEM).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input aria-label={t("Size")} placeholder={t("Size")} maxLength={10} value={size} onChange={(e) => setSize(e.target.value)} style={{ width: '6rem' }} />
        <input aria-label={t("Quantity")} type="number" min={1} max={100} value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: '5rem' }} />
        <button className="primary" disabled={busy}>{t("Issue")}</button>
      </form>
      <ErrorText error={error} />
      {!list.data && <Loading error={list.error} />}
      {list.data?.length === 0 && <EmptyState title={t("No apparel issued yet")} />}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>{t("Person")}</th><th>{t("Item")}</th><th>{t("Size")}</th><th>{t("Quantity")}</th><th>{t("Issued")}</th><th>{t("Returned")}</th><th /></tr></thead>
          <tbody>{list.data.map((a: ApparelAssignment) => (
            <tr key={a.id}>
              <td>{a.userName}</td><td>{APPAREL_ITEM[a.item] ?? a.item}</td><td>{a.size ?? '—'}</td><td>{a.quantity}</td><td>{formatDate(a.issuedOn)}</td><td>{a.returnedOn ? formatDate(a.returnedOn) : '—'}</td>
              <td>{!a.returnedOn && <button disabled={busy} onClick={async () => { if (await run(() => api.returnApparel(a.id))) list.reload(); }}>{t("Register return")}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function StoreProductClient({ value, onChange }: { value: { storeId: string; productId: string; clientId: string }; onChange: (v: { storeId: string; productId: string; clientId: string }) => void }) {
  const stores = useStores();
  const products = useLoad(() => api.products()).data ?? [];
  const clients = useClients();
  return (
    <>
      <select required aria-label={t("Store")} value={value.storeId} onChange={(e) => onChange({ ...value, storeId: e.target.value })}><option value="">{t("Store…")}</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <select aria-label={t("Product")} value={value.productId} onChange={(e) => onChange({ ...value, productId: e.target.value })}><option value="">{t("Product (optional)")}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <select aria-label={t("Client")} value={value.clientId} onChange={(e) => onChange({ ...value, clientId: e.target.value })}><option value="">{t("Client (optional)")}</option>{clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}</select>
    </>
  );
}

function RmaTab() {
  const list = useLoad(() => api.rmaCases());
  const [ref, setRef] = useState({ storeId: '', productId: '', clientId: '' });
  const [reason, setReason] = useState('damaged');
  const [quantity, setQuantity] = useState('1');
  const [description, setDescription] = useState('');
  const [channel, setChannel] = useState<ReturnChannel>('merchandiser');
  const [tracking, setTracking] = useState('');
  const { busy, error, run } = useAction();
  const open = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.openRma({ storeId: ref.storeId, productId: ref.productId || null, clientId: ref.clientId || null, quantity: Number(quantity), reason, description: description || null, returnChannel: channel, trackingReference: channel === 'store' ? tracking || null : null }))) { setDescription(''); setTracking(''); list.reload(); }
  };
  return (
    <>
      <form className="list-toolbar" onSubmit={open}>
        <StoreProductClient value={ref} onChange={setRef} />
        <select aria-label={t("Reason")} value={reason} onChange={(e) => setReason(e.target.value)}>{Object.entries(RMA_REASON).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input aria-label={t("Quantity")} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: '5rem' }} />
        <input aria-label={t("Description")} placeholder={t("Description")} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        <ChannelFields channel={channel} tracking={tracking} onChannel={setChannel} onTracking={setTracking} />
        <button className="primary" disabled={busy}>{t("Open return case")}</button>
      </form>
      <ErrorText error={error} />
      {!list.data && <Loading error={list.error} />}
      {list.data?.length === 0 && <EmptyState title={t("No return cases yet")} />}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>{t("Case")}</th><th>{t("Store")}</th><th>{t("Product")}</th><th>{t("Client")}</th><th>{t("Quantity")}</th><th>{t("Reason")}</th><th>{t("Return channel")}</th><th>{t("Status")}</th><th>{t("Opened")}</th><th /></tr></thead>
          <tbody>{list.data.map((r: RmaCase) => (
            <tr key={r.id}>
              <td>{r.caseNumber}</td><td>{r.storeName}</td><td>{r.productName ?? '—'}</td><td>{r.clientName ?? '—'}</td><td>{r.quantity}</td><td>{RMA_REASON[r.reason] ?? r.reason}</td><ChannelCell channel={r.returnChannel} tracking={r.trackingReference} />
              <td><StatusBadge status={r.status === 'credited' ? 'approved' : r.status} label={RMA_LABEL[r.status]} /></td>
              <td>{formatDate(r.createdAt)} · {r.openedByName}</td>
              <td>{RMA_NEXT[r.status].map((s) => <button key={s} disabled={busy} onClick={async () => { if (await run(() => api.setRmaStatus(r.id, s))) list.reload(); }}>{RMA_LABEL[s]}</button>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function ClaimsTab() {
  const list = useLoad(() => api.stockClaims());
  const [ref, setRef] = useState({ storeId: '', productId: '', clientId: '' });
  const [claimType, setClaimType] = useState('price_protection');
  const [quantity, setQuantity] = useState('1');
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<ReturnChannel>('merchandiser');
  const [tracking, setTracking] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.submitClaim({ storeId: ref.storeId, productId: ref.productId || null, clientId: ref.clientId || null, claimType, quantity: Number(quantity), amount: amount || 0, description: null, returnChannel: channel, trackingReference: channel === 'store' ? tracking || null : null }))) { setAmount(''); setTracking(''); list.reload(); }
  };
  return (
    <>
      <form className="list-toolbar" onSubmit={submit}>
        <StoreProductClient value={ref} onChange={setRef} />
        <select aria-label={t("Claim type")} value={claimType} onChange={(e) => setClaimType(e.target.value)}>{Object.entries(CLAIM_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input aria-label={t("Quantity")} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} style={{ width: '5rem' }} />
        <input aria-label={t("Amount (EUR)")} placeholder={t("Amount (EUR)")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: '8rem' }} />
        <ChannelFields channel={channel} tracking={tracking} onChannel={setChannel} onTracking={setTracking} />
        <button className="primary" disabled={busy}>{t("Submit claim")}</button>
      </form>
      <p className="muted">{t("A claim is decided by someone other than the person who submitted it.")}</p>
      <ErrorText error={error} />
      {!list.data && <Loading error={list.error} />}
      {list.data?.length === 0 && <EmptyState title={t("No stock-protection claims yet")} />}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>{t("Store")}</th><th>{t("Product")}</th><th>{t("Client")}</th><th>{t("Type")}</th><th>{t("Quantity")}</th><th>{t("Amount")}</th><th>{t("Return channel")}</th><th>{t("Status")}</th><th>{t("Submitted")}</th><th /></tr></thead>
          <tbody>{list.data.map((c: StockClaim) => (
            <tr key={c.id}>
              <td>{c.storeName}</td><td>{c.productName ?? '—'}</td><td>{c.clientName ?? '—'}</td><td>{CLAIM_TYPE[c.claimType] ?? c.claimType}</td><td>{c.quantity}</td><td>{euro(c.amount)}</td><ChannelCell channel={c.returnChannel} tracking={c.trackingReference} />
              <td><StatusBadge status={c.status === 'paid' ? 'approved' : c.status} label={CLAIM_LABEL[c.status]} />{c.decidedByName && <><br /><span className="muted">{c.decidedByName}</span></>}</td>
              <td>{formatDate(c.createdAt)} · {c.submittedByName}</td>
              <td>{CLAIM_NEXT[c.status].map((s) => <button key={s} disabled={busy} onClick={async () => { if (await run(() => api.setClaimStatus(c.id, s))) list.reload(); }}>{CLAIM_LABEL[s]}</button>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

export function FleetView() {
  const [tab, setTab] = useState('fleet');
  return (
    <ViewFrame title={t("Fleet & apparel")} subtitle={t("Vehicles with a mandatory four-photo pre-trip check, and crew apparel. Merchandise returns are under Rackjobbing & RMA.")} crumbs={[SUITE, { label: t("Fleet & apparel") }]}>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'fleet', label: t("Vehicles") }, { id: 'apparel', label: t("Apparel") }]} />
      {tab === 'fleet' && <FleetTab />}
      {tab === 'apparel' && <ApparelTab />}
    </ViewFrame>
  );
}

/* ---------- Rackjobbing & RMA ---------- */

/** Coordinators plan; account managers only read (the backend enforces this too). */
function isCoordinator(): boolean {
  const u = userContext();
  return u.jobRole === null || u.jobRole === 'PLATFORM_ADMIN' || u.jobRole === 'HQ_ADMIN';
}

const ROTATION_LABEL: Record<RotationRule, string> = live(() => ({ fifo: t("FIFO (first in, first out)"), expiry_check: t("Expiry date check"), none: t("No rotation") }));

function NewRackjobForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [ref, setRef] = useState({ storeId: '', productId: '', clientId: '' });
  const [pickup, setPickup] = useState('0');
  const [dropoff, setDropoff] = useState('0');
  const [rotation, setRotation] = useState<RotationRule>('fifo');
  const [priceProtection, setPriceProtection] = useState(false);
  const [instructions, setInstructions] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.createRackjobCheck({ storeId: ref.storeId, productId: ref.productId || null, visitId: null, rmaCaseId: null, pickupQty: Number(pickup), dropoffQty: Number(dropoff), rotationRule: rotation, priceProtectionEligible: priceProtection, instructions: instructions.trim() || null }))) onDone();
  };
  return (
    <form onSubmit={submit}>
      <Field label={t("Store and product")}><div className="list-toolbar"><StoreProductClient value={ref} onChange={setRef} /></div></Field>
      <div className="field-row">
        <Field label={t("Pick up (units)")} hint={t("Old or returned stock to take away")}><input type="number" min={0} max={100000} value={pickup} onChange={(e) => setPickup(e.target.value)} /></Field>
        <Field label={t("Drop off (units)")} hint={t("New stock to put on the shelf")}><input type="number" min={0} max={100000} value={dropoff} onChange={(e) => setDropoff(e.target.value)} /></Field>
      </div>
      <Field label={t("Stock rotation")}><select value={rotation} onChange={(e) => setRotation(e.target.value as RotationRule)}>{Object.entries(ROTATION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <label className="check-row"><input type="checkbox" checked={priceProtection} onChange={(e) => setPriceProtection(e.target.checked)} /> {t("Eligible for price protection")}</label>
      <Field label={t("Instructions")}><textarea rows={3} maxLength={2000} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder={t("e.g. Move short-dated stock to the front")} /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy || !ref.storeId} submitLabel={t("Create checklist")} onCancel={onCancel} />
    </form>
  );
}

function CompleteRackjobForm({ check, onDone, onCancel }: { check: RackjobCheck; onDone: () => void; onCancel: () => void }) {
  const [pickup, setPickup] = useState(String(check.pickupQty));
  const [dropoff, setDropoff] = useState(String(check.dropoffQty));
  const [rotated, setRotated] = useState(check.rotationRule !== 'none');
  const [notes, setNotes] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.completeRackjobCheck(check.id, { actualPickupQty: Number(pickup), actualDropoffQty: Number(dropoff), rotationDone: rotated, notes: notes.trim() || null }))) onDone();
  };
  return (
    <form onSubmit={submit}>
      <p className="muted">{check.storeName}{check.productName ? ` · ${check.productName}` : ''}{check.instructions ? ` · ${check.instructions}` : ''}</p>
      <div className="field-row">
        <Field label={tf("Picked up (planned {n})", { n: check.pickupQty })}><input type="number" min={0} max={100000} value={pickup} onChange={(e) => setPickup(e.target.value)} /></Field>
        <Field label={tf("Dropped off (planned {n})", { n: check.dropoffQty })}><input type="number" min={0} max={100000} value={dropoff} onChange={(e) => setDropoff(e.target.value)} /></Field>
      </div>
      <label className="check-row"><input type="checkbox" checked={rotated} onChange={(e) => setRotated(e.target.checked)} /> {tf("Stock rotated ({rule})", { rule: ROTATION_LABEL[check.rotationRule] })}</label>
      <Field label={t("Notes")}><textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={t("Save result")} onCancel={onCancel} />
    </form>
  );
}

function RackjobTab() {
  const list = useLoad(() => api.rackjobChecks());
  const coordinator = isCoordinator();
  const fieldRep = userContext().jobRole === 'FIELD_REPRESENTATIVE';
  const [adding, setAdding] = useState(false);
  const [completing, setCompleting] = useState<RackjobCheck | null>(null);
  return (
    <>
      <div className="list-toolbar">
        <p className="muted">{t("Per store visit and product: exact pick-up and drop-off quantities, the stock rotation rule and whether price protection applies.")}</p>
        {coordinator && <button className="primary" onClick={() => setAdding(true)}>{t("+ New rackjobbing checklist")}</button>}
      </div>
      {!list.data && <Loading error={list.error} />}
      {list.data?.length === 0 && <EmptyState title={t("No rackjobbing checklists yet")} />}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>{t("Store")}</th><th>{t("Product")}</th><th className="num">{t("Pick up")}</th><th className="num">{t("Drop off")}</th><th>{t("Rotation")}</th><th>{t("Price protection")}</th><th>{t("Instructions")}</th><th>{t("Status")}</th><th /></tr></thead>
          <tbody>{list.data.map((k) => (
            <tr key={k.id}>
              <td>{k.storeName}</td>
              <td>{k.productName ?? '—'}{k.productSku && <div className="muted small">{k.productSku}</div>}</td>
              <td className="num">{k.pickupQty}{k.status === 'done' && <div className="muted small">{tf("actual {n}", { n: k.actualPickupQty ?? 0 })}</div>}</td>
              <td className="num">{k.dropoffQty}{k.status === 'done' && <div className="muted small">{tf("actual {n}", { n: k.actualDropoffQty ?? 0 })}</div>}</td>
              <td>{ROTATION_LABEL[k.rotationRule]}{k.status === 'done' && <div className="muted small">{k.rotationDone ? t("Done") : t("Not done")}</div>}</td>
              <td>{k.priceProtectionEligible ? <StatusBadge status="approved" label={t("Eligible")} /> : <span className="muted">{t("No")}</span>}</td>
              <td>{k.instructions ?? '—'}{k.resultNotes && <div className="muted small">{k.resultNotes}</div>}</td>
              <td><StatusBadge status={k.status === 'done' ? 'COMPLETED' : 'PLANNED'} label={k.status === 'done' ? t("Done") : t("Planned")} />{k.completedByName && <div className="muted small">{k.completedByName} · {formatDate(k.completedAt!)}</div>}</td>
              <td>{k.status === 'planned' && (coordinator || fieldRep) && <button onClick={() => setCompleting(k)}>{t("Record result")}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {adding && <Drawer title={t("New rackjobbing checklist")} onClose={() => setAdding(false)}><NewRackjobForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} /></Drawer>}
      {completing && <Drawer title={t("Record rackjobbing result")} onClose={() => setCompleting(null)}><CompleteRackjobForm check={completing} onCancel={() => setCompleting(null)} onDone={() => { setCompleting(null); list.reload(); }} /></Drawer>}
    </>
  );
}

export function RackjobbingView() {
  const [tab, setTab] = useState('checklists');
  return (
    <ViewFrame title={t("Rackjobbing & RMA")} subtitle={t("Merchandise only: rackjobbing checklists, return cases and stock-protection claims. Vehicle returns are under Fleet & apparel.")} crumbs={[SUITE, { label: t("Rackjobbing & RMA") }]}>
      <Tabs active={tab} onChange={setTab} tabs={[{ id: 'checklists', label: t("Rackjobbing checklists") }, { id: 'rma', label: t("Returns (RMA)") }, { id: 'claims', label: t("Stock protection") }]} />
      {tab === 'checklists' && <RackjobTab />}
      {tab === 'rma' && <RmaTab />}
      {tab === 'claims' && <ClaimsTab />}
    </ViewFrame>
  );
}

/* ---------- Procurement & POs ---------- */

const PO_CATEGORY: Record<PoCategory, string> = live(() => ({ car_rental: t("Car rental"), apparel: t("Apparel"), pos_material: t("POS material") }));
const PO_BILLING_LABEL: Record<PoBilling, string> = live(() => ({ client: t("Billed separately to client"), included: t("Included in visit price") }));
const DEFAULT_BILLING: Record<PoCategory, PoBilling> = { car_rental: 'included', apparel: 'client', pos_material: 'client' };
const PO_STATUS: Record<string, string> = live(() => ({ open: t("Open"), matched: t("Matched"), disputed: t("Disputed"), cancelled: t("Cancelled") }));

interface PoLineDraft { category: PoCategory; description: string; quantity: string; unitPrice: string; billing: PoBilling }

function decimal(input: string): string {
  const s = input.replace(/[€\s]/g, '');
  return s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
}

function NewPurchaseOrderForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const clients = useClients();
  const rounds = useLoad(() => api.auditRounds()).data ?? [];
  const [supplier, setSupplier] = useState('');
  const [clientId, setClientId] = useState('');
  const [roundId, setRoundId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PoLineDraft[]>([{ category: 'car_rental', description: '', quantity: '1', unitPrice: '', billing: 'included' }]);
  const { busy, error, run } = useAction();
  const setLine = (i: number, patch: Partial<PoLineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((n, l) => n + (Number(decimal(l.quantity)) || 0) * (Number(decimal(l.unitPrice)) || 0), 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.createPurchaseOrder({
      supplierName: supplier.trim(), clientId: clientId || null, auditRoundId: roundId || null, orderDate: null, notes: notes.trim() || null,
      lines: lines.map((l) => ({ ...l, description: l.description.trim(), quantity: decimal(l.quantity), unitPrice: decimal(l.unitPrice) || '0' })),
    }))) onDone();
  };
  return (
    <form onSubmit={submit}>
      <Field label={t("Supplier")}><input required maxLength={200} value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={t("e.g. Sixt, a print shop or a uniform supplier")} autoFocus /></Field>
      <Field label={t("Client")} hint={t("Required when a line is billed separately to the client")}>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">—</option>{clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}</select>
      </Field>
      <Field label={t("Campaign or audit round")} hint={t("Optional")}>
        <select value={roundId} onChange={(e) => setRoundId(e.target.value)}><option value="">—</option>{rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      </Field>
      <h3>{t("Lines")}</h3>
      {lines.map((l, i) => (
        <div key={i} className="card-panel">
          <div className="field-row">
            <Field label={t("Type")}><select value={l.category} onChange={(e) => { const category = e.target.value as PoCategory; setLine(i, { category, billing: DEFAULT_BILLING[category] }); }}>{Object.entries(PO_CATEGORY).map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}</select></Field>
            <Field label={t("Billing")}><select value={l.billing} onChange={(e) => setLine(i, { billing: e.target.value as PoBilling })}>{Object.entries(PO_BILLING_LABEL).map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}</select></Field>
          </div>
          <Field label={t("Description")}><input required maxLength={200} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></Field>
          <div className="field-row">
            <Field label={t("Quantity")}><input required inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></Field>
            <Field label={t("Unit price (EUR)")}><input required inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} placeholder="0,00" /></Field>
          </div>
          {lines.length > 1 && <button type="button" className="link-button" onClick={() => setLines(lines.filter((_, j) => j !== i))}>{t("Remove line")}</button>}
        </div>
      ))}
      <button type="button" className="secondary" onClick={() => setLines([...lines, { category: 'apparel', description: '', quantity: '1', unitPrice: '', billing: 'client' }])}>{t("+ Add line")}</button>
      <p><strong>{t("Total")}: {formatAmount(total.toFixed(2), 'EUR')}</strong></p>
      <Field label={t("Notes")}><textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={t("Create purchase order")} onCancel={onCancel} />
    </form>
  );
}

function MatchInvoiceForm({ po, onDone, onCancel }: { po: PurchaseOrder; onDone: () => void; onCancel: () => void }) {
  const [number, setNumber] = useState(po.supplierInvoiceNumber ?? '');
  const [date, setDate] = useState(po.supplierInvoiceDate ?? '');
  const [amount, setAmount] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => api.matchPurchaseOrder(po.id, { invoiceNumber: number.trim(), invoiceDate: date || null, amount: decimal(amount) }))) onDone();
  };
  return (
    <form onSubmit={submit}>
      <p className="muted">{tf("{po} from {supplier}: order total {total}. An invoice for exactly this amount is matched; any other amount is marked Disputed.", { po: po.poNumber, supplier: po.supplierName, total: formatAmount(po.total, 'EUR') })}</p>
      <Field label={t("Supplier invoice number")}><input required maxLength={60} value={number} onChange={(e) => setNumber(e.target.value)} autoFocus /></Field>
      <Field label={t("Invoice date")}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={t("Invoice amount (EUR)")}><input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></Field>
      <ErrorText error={error} />
      <FormActions busy={busy} submitLabel={t("Match invoice")} onCancel={onCancel} />
    </form>
  );
}

export function ProcurementView() {
  const list = useLoad(() => api.purchaseOrders());
  const coordinator = isCoordinator();
  const [adding, setAdding] = useState(false);
  const [matching, setMatching] = useState<PurchaseOrder | null>(null);
  const [status, setStatus] = useState('');
  const { busy, error, run } = useAction();
  const shown = (list.data ?? []).filter((p) => !status || p.status === status);
  const sum = (k: 'billableTotal' | 'includedTotal') => (list.data ?? []).filter((p) => p.status !== 'cancelled').reduce((n, p) => n + Number(p[k]), 0);
  return (
    <ViewFrame
      title={t("Procurement & POs")}
      subtitle={t("Purchase orders for operational field costs, matched to supplier invoices. Apparel and POS material are billed separately to the client; car rental is included in the visit price.")}
      crumbs={[SUITE, { label: t("Procurement & POs") }]}
      actions={coordinator && <button className="primary" onClick={() => setAdding(true)}>{t("+ New purchase order")}</button>}
    >
      {!coordinator && <p className="callout">{t("Read-only: only HQ administrators create purchase orders and match supplier invoices.")}</p>}
      <div className="kpi-grid">
        <div className="kpi kpi-purple"><span>{t("Open orders")}</span><strong>{(list.data ?? []).filter((p) => p.status === 'open').length}</strong></div>
        <div className="kpi kpi-indigo"><span>{t("Disputed invoices")}</span><strong>{(list.data ?? []).filter((p) => p.status === 'disputed').length}</strong></div>
        <div className="kpi kpi-emerald"><span>{t("Billable to clients")}</span><strong>{formatAmount(sum('billableTotal').toFixed(2), 'EUR')}</strong></div>
        <div className="kpi kpi-blue"><span>{t("Included in visit price")}</span><strong>{formatAmount(sum('includedTotal').toFixed(2), 'EUR')}</strong></div>
      </div>
      <div className="list-toolbar">
        <FilterChips value={status} onChange={setStatus} chips={[{ value: '', label: t("All") }, ...Object.entries(PO_STATUS).map(([value, label]) => ({ value, label }))]} />
      </div>
      <ErrorText error={error} />
      {!list.data && <Loading error={list.error} />}
      {list.data && shown.length === 0 && <EmptyState title={t("No purchase orders yet")}>{coordinator ? t("Create one with “+ New purchase order”.") : null}</EmptyState>}
      {shown.length > 0 && (
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>{t("PO")}</th><th>{t("Supplier")}</th><th>{t("Lines")}</th><th className="num">{t("Total")}</th><th className="num">{t("Billable to client")}</th><th className="num">{t("Included")}</th><th>{t("Supplier invoice")}</th><th>{t("Status")}</th><th /></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.poNumber}</strong><div className="muted small">{formatDate(p.orderDate)} · {p.createdByName}</div></td>
              <td>{p.supplierName}{(p.clientName || p.auditRoundName) && <div className="muted small">{[p.clientName, p.auditRoundName].filter(Boolean).join(' · ')}</div>}</td>
              <td>{p.lines.map((l) => <div key={l.id} className="small">{PO_CATEGORY[l.category]}: {l.description} · {formatAmount(l.lineTotal, 'EUR')} <span className="muted">({PO_BILLING_LABEL[l.billing]})</span></div>)}</td>
              <td className="num">{formatAmount(p.total, 'EUR')}</td>
              <td className="num">{formatAmount(p.billableTotal, 'EUR')}</td>
              <td className="num">{formatAmount(p.includedTotal, 'EUR')}</td>
              <td>{p.supplierInvoiceNumber ? <>{p.supplierInvoiceNumber} · {formatAmount(p.supplierInvoiceAmount, 'EUR')}{p.status === 'disputed' && <div className="small bad">{tf("Difference {amount}", { amount: formatAmount(p.variance, 'EUR') })}</div>}</> : '—'}</td>
              <td><StatusBadge status={p.status === 'matched' ? 'approved' : p.status === 'disputed' ? 'not_compliant' : p.status === 'cancelled' ? 'archived' : 'pending_approval'} label={PO_STATUS[p.status]} /></td>
              <td>{coordinator && (p.status === 'open' || p.status === 'disputed') && <button disabled={busy} onClick={() => setMatching(p)}>{t("Match invoice")}</button>}
                {coordinator && p.status === 'open' && <button disabled={busy} onClick={async () => { if (window.confirm(t("Cancel this purchase order?")) && (await run(() => api.cancelPurchaseOrder(p.id)))) list.reload(); }}>{t("Cancel")}</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {adding && <Drawer title={t("New purchase order")} onClose={() => setAdding(false)}><NewPurchaseOrderForm onCancel={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} /></Drawer>}
      {matching && <Drawer title={t("Match supplier invoice")} onClose={() => setMatching(null)}><MatchInvoiceForm po={matching} onCancel={() => setMatching(null)} onDone={() => { setMatching(null); list.reload(); }} /></Drawer>}
    </ViewFrame>
  );
}
