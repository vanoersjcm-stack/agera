import { type FormEvent, useState } from 'react';
import { api, type AssetCategory, type BookableAsset, type BookingMode, type CalendarEvent, type LeaveRequest, type LeaveType } from './api';
import { userContext, type UserContext } from './context';
import { live, locale, t, tf } from './i18n';
import { formatDateTime } from './labels';
import { navigate, type Route, withParams } from './router';
import { Drawer, ErrorText, Field, FormActions, Loading, StatusBadge, useAction, useLoad } from './ui';

export const ASSET_CATEGORY: Record<AssetCategory, string> = live(() => ({ meeting_room: t("Meeting room"), av_equipment: t("AV equipment"), other: t("Other") }));
export const BOOKING_MODE: Record<BookingMode, string> = live(() => ({ self_service: t("Self-service"), coordinator_only: t("Assigned by HQ admins") }));
export const LEAVE_TYPE: Record<LeaveType, string> = live(() => ({ vacation: t("Vacation"), leave: t("Leave"), sick: t("Sick"), other: t("Other") }));
const LEAVE_STATUS: Record<LeaveRequest['status'], string> = live(() => ({ pending: t("Waiting for approval"), approved: t("Approved"), rejected: t("Not approved"), cancelled: t("Cancelled") }));

export function isAgendaAdmin(u: UserContext): boolean {
  return u.isPlatformAdmin || u.jobRole === 'HQ_ADMIN' || u.jobRole === 'PLATFORM_ADMIN' || (u.jobRole === null && u.role === 'admin');
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

/** Rooms and equipment booked on one appointment, with booking and release for the organiser (and admins). */
export function AppointmentAssets({ event: e, myId, onChanged }: { event: CalendarEvent; myId: string | undefined; onChanged: () => void }) {
  const admin = isAgendaAdmin(userContext());
  const assets = useLoad(() => api.bookableAssets(), []);
  const [assetId, setAssetId] = useState('');
  const [buffer, setBuffer] = useState('0');
  const { busy, error, run } = useAction();
  const canBook = (e.createdBy === myId || admin) && e.status === 'scheduled';
  const options = (assets.data ?? []).filter((a) => !e.assets.some((x) => x.assetId === a.id));
  return (
    <section className="cal-docs">
      <h3>{t("Rooms & equipment")}</h3>
      {e.assets.length === 0 ? <p className="muted">{t("No room or equipment booked")}</p> : (
        <ul className="plain-list">
          {e.assets.map((a) => (
            <li key={a.assetId} className="cal-doc">
              <span className="cal-doc-title">{a.name}{a.bufferMinutes ? ` · ${tf("+{n} min buffer", { n: a.bufferMinutes })}` : ''}</span>
              {canBook && <button className="link-button danger" disabled={busy} onClick={async () => { if (await run(() => api.releaseAsset(e.id, a.assetId))) onChanged(); }}>{t("Release")}</button>}
            </li>
          ))}
        </ul>
      )}
      {canBook && (
        <div className="cal-attach">
          <select value={assetId} onChange={(ev) => setAssetId(ev.target.value)} aria-label={t("Room or equipment")}>
            <option value="">{t("Book a room or equipment…")}</option>
            {options.map((a) => (
              <option key={a.id} value={a.id} disabled={a.bookingMode === 'coordinator_only' && !admin}>
                {a.name}{a.bookingMode === 'coordinator_only' ? ` (${BOOKING_MODE.coordinator_only})` : ''}
              </option>
            ))}
          </select>
          <select value={buffer} onChange={(ev) => setBuffer(ev.target.value)} aria-label={t("Buffer time")}>
            <option value="0">{t("No buffer")}</option>
            <option value="15">{tf("+{n} min buffer", { n: 15 })}</option>
            <option value="30">{tf("+{n} min buffer", { n: 30 })}</option>
          </select>
          <button className="primary" disabled={busy || !assetId} onClick={async () => { if (await run(() => api.bookAsset(e.id, assetId, Number(buffer)))) { setAssetId(''); onChanged(); } }}>{t("Book")}</button>
        </div>
      )}
      <p className="muted small">{t("The buffer keeps the room free after the meeting for overrun and tidying. Double bookings are refused.")}</p>
      <ErrorText error={error} />
    </section>
  );
}

/** Agenda › Rooms & equipment: who has which room or screen in the period; admins manage the list. */
export function RoomsPanel({ from, to }: { from: Date; to: Date }) {
  const admin = isAgendaAdmin(userContext());
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<BookableAsset | 'new' | null>(null);
  const assets = useLoad(() => api.bookableAssets(admin), [admin, reload]);
  const bookings = useLoad(() => api.assetBookings(from.toISOString(), to.toISOString()), [from.getTime(), to.getTime(), reload]);
  const { busy, error, run } = useAction();
  return (
    <>
      <h2>{t("Bookings in this period")}</h2>
      {!bookings.data ? <Loading error={bookings.error} /> : bookings.data.length === 0 ? <p className="muted">{t("No rooms or equipment booked in this period.")}</p> : (
        <table className="grid">
          <thead><tr><th>{t("Room or equipment")}</th><th>{t("When")}</th><th>{t("Meeting")}</th><th>{t("Booked by")}</th><th>{t("Buffer")}</th></tr></thead>
          <tbody>
            {bookings.data.map((b) => (
              <tr key={`${b.assetId}-${b.eventId}`}>
                <td>{b.assetName}</td>
                <td>{formatDateTime(b.startsAt)} – {time(b.endsAt)}</td>
                <td>{b.private ? <span className="muted">{t("Private appointment")}</span> : <a href={`#/calendar?event=${b.eventId}`}>{b.eventTitle}</a>}</td>
                <td>{b.bookedByName}</td>
                <td>{b.bufferMinutes ? tf("+{n} min, free from {time}", { n: b.bufferMinutes, time: time(b.blockedUntil) }) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>{t("Rooms & equipment")}</h2>
      {admin && <p><button className="primary" onClick={() => setEditing('new')}>{t("+ Add room or equipment")}</button></p>}
      {!assets.data ? <Loading error={assets.error} /> : (
        <table className="grid">
          <thead><tr><th>{t("Name")}</th><th>{t("Kind")}</th><th>{t("Booking")}</th><th>{t("Status")}</th>{admin && <th />}</tr></thead>
          <tbody>
            {assets.data.map((a) => (
              <tr key={a.id}>
                <td>{a.name}{a.notes && <div className="muted small">{a.notes}</div>}</td>
                <td>{ASSET_CATEGORY[a.category]}</td>
                <td>{BOOKING_MODE[a.bookingMode]}</td>
                <td><StatusBadge status={a.active ? 'ok' : 'pending'} label={a.active ? t("Active") : t("Deactivated")} /></td>
                {admin && (
                  <td>
                    <button className="link-button" onClick={() => setEditing(a)}>{t("Edit")}</button>{' '}
                    <button className="link-button" disabled={busy} onClick={async () => { if (await run(() => api.updateAsset(a.id, { active: !a.active }))) setReload((n) => n + 1); }}>{a.active ? t("Deactivate") : t("Reactivate")}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ErrorText error={error} />
      {editing && <AssetForm asset={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload((n) => n + 1); }} />}
    </>
  );
}

function AssetForm({ asset, onClose, onSaved }: { asset: BookableAsset | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(asset?.name ?? '');
  const [category, setCategory] = useState<AssetCategory>(asset?.category ?? 'meeting_room');
  const [bookingMode, setBookingMode] = useState<BookingMode>(asset?.bookingMode ?? 'self_service');
  const [notes, setNotes] = useState(asset?.notes ?? '');
  const { busy, error, run } = useAction();
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const body = { name: name.trim(), category, bookingMode, notes: notes.trim() || null };
    if (await run(() => (asset ? api.updateAsset(asset.id, body) : api.createAsset(body)))) onSaved();
  };
  return (
    <Drawer title={asset ? t("Edit room or equipment") : t("New room or equipment")} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <Field label={t("Name")}><input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Spreekkamer 4")} /></Field>
        <Field label={t("Kind")}>
          <select value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
            {(Object.keys(ASSET_CATEGORY) as AssetCategory[]).map((k) => <option key={k} value={k}>{ASSET_CATEGORY[k]}</option>)}
          </select>
        </Field>
        <Field label={t("Booking")} hint={t("Self-service: anyone books it on their own appointment. Assigned by HQ admins: only HQ or platform admins book it; everyone sees for which meeting.")}>
          <select value={bookingMode} onChange={(e) => setBookingMode(e.target.value as BookingMode)}>
            {(Object.keys(BOOKING_MODE) as BookingMode[]).map((k) => <option key={k} value={k}>{BOOKING_MODE[k]}</option>)}
          </select>
        </Field>
        <Field label={t("Notes")}><textarea rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel={t("Save")} onCancel={onClose} />
      </form>
    </Drawer>
  );
}

/** Agenda › Leave & vacation: colleagues in rows, working days in columns; only approved leave is published. */
export function LeaveGrid({ route, anchor }: { route: Route; anchor: Date }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const days: Date[] = [];
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d));
  const [reload, setReload] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const data = useLoad(() => api.leave(dayKey(first), dayKey(last)), [first.getTime(), reload]);
  const { busy, error, run } = useAction();
  const me = (data.data?.requests ?? []).length >= 0 ? userContext() : null;
  const go = (d: Date) => navigate(withParams(route, { date: dayKey(d) }));
  const today = dayKey(new Date());
  const act = async (fn: () => Promise<unknown>) => { if (await run(fn)) setReload((n) => n + 1); };
  const cell = (userId: string, d: Date) => {
    const k = dayKey(d);
    return (data.data?.requests ?? []).find((l) => l.userId === userId && l.startDate <= k && l.endDate >= k && (l.status === 'approved' || l.status === 'pending'));
  };
  const pending = (data.data?.requests ?? []).filter((l) => l.status === 'pending');
  return (
    <>
      <div className="cal-toolbar">
        <button className="secondary" onClick={() => go(new Date(first.getFullYear(), first.getMonth() - 1, 1))} aria-label={t("Previous")}>‹</button>
        <strong>{first.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</strong>
        <button className="secondary" onClick={() => go(new Date(first.getFullYear(), first.getMonth() + 1, 1))} aria-label={t("Next")}>›</button>
        <span className="cal-legend">
          <span className="leave-key approved">{t("Approved")}</span>
          <span className="leave-key pending">{t("Waiting for approval")}</span>
        </span>
        <button className="primary" onClick={() => setRequesting(true)}>{t("+ Request leave")}</button>
      </div>
      {!data.data ? <Loading error={data.error} /> : (
        <div className="leave-grid-wrap">
          <table className="leave-grid">
            <thead>
              <tr>
                <th className="leave-name">{t("Employee")}</th>
                {days.map((d) => <th key={dayKey(d)} className={dayKey(d) === today ? 'today' : undefined} title={d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}>{d.toLocaleDateString(locale(), { weekday: 'narrow' })}<br />{d.getDate()}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.data.employees.map((u) => (
                <tr key={u.id}>
                  <td className="leave-name">{u.name}</td>
                  {days.map((d) => {
                    const l = cell(u.id, d);
                    return <td key={dayKey(d)} className={l ? `leave-cell ${l.status} ${l.leaveType}` : undefined} title={l ? `${u.name} · ${LEAVE_TYPE[l.leaveType]} · ${LEAVE_STATUS[l.status]}${l.note ? ` · ${l.note}` : ''}` : undefined} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.data && pending.length > 0 && (
        <>
          <h2>{data.data.canApprove ? t("Waiting for your approval") : t("Your requests waiting for approval")}</h2>
          <table className="grid">
            <thead><tr><th>{t("Employee")}</th><th>{t("Type")}</th><th>{t("From")}</th><th>{t("Until")}</th><th>{t("Note")}</th><th /></tr></thead>
            <tbody>
              {pending.map((l) => (
                <tr key={l.id}>
                  <td>{l.userName}</td><td>{LEAVE_TYPE[l.leaveType]}</td><td>{l.startDate}</td><td>{l.endDate}</td><td>{l.note ?? '—'}</td>
                  <td>
                    {data.data!.canApprove && <><button className="primary small" disabled={busy} onClick={() => act(() => api.decideLeave(l.id, 'approved'))}>{t("Approve")}</button>{' '}<button className="secondary small" disabled={busy} onClick={() => act(() => api.decideLeave(l.id, 'rejected'))}>{t("Reject")}</button>{' '}</>}
                    <button className="link-button danger" disabled={busy} onClick={() => act(() => api.cancelLeave(l.id))}>{t("Withdraw")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="muted small">{t("Leave appears on the grid and in the team agenda once an HQ or platform admin approves it.")}</p>
      <ErrorText error={error} />
      {requesting && me && data.data && <LeaveForm employees={data.data.employees} canChooseEmployee={data.data.canApprove} onClose={() => setRequesting(false)} onSaved={() => { setRequesting(false); setReload((n) => n + 1); }} />}
    </>
  );
}

function LeaveForm({ employees, canChooseEmployee, onClose, onSaved }: { employees: { id: string; name: string }[]; canChooseEmployee: boolean; onClose: () => void; onSaved: () => void }) {
  const today = dayKey(new Date());
  const [userId, setUserId] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('vacation');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (await run(() => api.requestLeave({ userId: userId || null, leaveType, startDate, endDate, note: note.trim() || null }))) onSaved();
  };
  return (
    <Drawer title={t("Request leave")} onClose={onClose}>
      <form onSubmit={submit} className="form">
        {canChooseEmployee && (
          <Field label={t("Employee")} hint={t("Leave you enter for a colleague is approved straight away.")}>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">{t("Myself")}</option>
              {employees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={t("Type")}>
          <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
            {(Object.keys(LEAVE_TYPE) as LeaveType[]).map((k) => <option key={k} value={k}>{LEAVE_TYPE[k]}</option>)}
          </select>
        </Field>
        <Field label={t("From")}><input required type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value); }} /></Field>
        <Field label={t("Until")}><input required type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <Field label={t("Note")}><input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel={t("Send request")} onCancel={onClose} />
      </form>
    </Drawer>
  );
}
