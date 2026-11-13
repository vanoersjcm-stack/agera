import { type FormEvent, useMemo, useState } from 'react';
import { keycloak } from './auth';
import { api, type CalendarEvent, type CalendarItem, type CalendarKind } from './api';
import { userContext } from './context';
import { activeClients, useClients, useUsers, userName } from './directory';
import { live, locale, t, tf } from './i18n';
import { formatDateTime } from './labels';
import { EmptyState, ViewFrame } from './Layout';
import { navigate, type Route, withParams } from './router';
import { DetailList, Drawer, ErrorText, Field, FilterChips, FormActions, Loading, StatusBadge, useAction, useLoad } from './ui';

type Mode = 'day' | 'week' | 'month';
const KIND: Record<CalendarKind, string> = live(() => ({ appointment: t("Appointment"), visit: t("Store visit"), round: t("Round"), milestone: t("Milestone") }));
const RESPONSE: Record<string, string> = live(() => ({ pending: t("No answer yet"), accepted: t("Accepted"), declined: t("Declined") }));

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monday = (d: Date) => { const s = startOfDay(d); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toLocalInput = (d: Date) => `${dayKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
/** All-day items carry a plain date; timed items an ISO timestamp. */
const itemDay = (i: CalendarItem) => (i.allDay && i.start.length === 10 ? i.start : dayKey(new Date(i.start)));
const myEmail = () => (keycloak.tokenParsed as { email?: string } | undefined)?.email ?? '';
const time = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

function range(mode: Mode, anchor: Date): { from: Date; to: Date; days: Date[] } {
  if (mode === 'day') return { from: startOfDay(anchor), to: addDays(anchor, 1), days: [startOfDay(anchor)] };
  if (mode === 'week') { const m = monday(anchor); return { from: m, to: addDays(m, 7), days: Array.from({ length: 7 }, (_, i) => addDays(m, i)) }; }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const m = monday(first);
  return { from: m, to: addDays(m, 42), days: Array.from({ length: 42 }, (_, i) => addDays(m, i)) };
}

function shift(mode: Mode, anchor: Date, n: number): Date {
  if (mode === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + n, 1);
  return addDays(anchor, n * (mode === 'week' ? 7 : 1));
}

/** Agera Calendar: Agera's own appointments plus dated records from the other modules, all stored in Agera. */
export function CalendarView({ route }: { route: Route }) {
  const user = userContext();
  const field = user.jobRole === 'FIELD_REPRESENTATIVE';
  const mode = (['day', 'week', 'month'].includes(route.params.get('view') ?? '') ? route.params.get('view') : 'week') as Mode;
  const scope = field ? 'mine' : route.params.get('scope') === 'team' ? 'team' : 'mine';
  const anchor = useMemo(() => { const d = route.params.get('date'); return d ? new Date(`${d}T00:00:00`) : startOfDay(new Date()); }, [route.params]);
  const { from, to, days } = range(mode, anchor);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState<Date | null>(null);
  const items = useLoad(() => api.calendar(from.toISOString(), to.toISOString(), scope), [from.getTime(), to.getTime(), scope, reload]);
  const eventId = route.params.get('event');
  const byDay = new Map<string, CalendarItem[]>();
  for (const i of items.data ?? []) byDay.set(itemDay(i), [...(byDay.get(itemDay(i)) ?? []), i]);
  const go = (changes: Record<string, string | null>) => navigate(withParams(route, changes));
  const title = mode === 'month'
    ? anchor.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })
    : mode === 'week' ? tf("Week of {date}", { date: from.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) })
    : anchor.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const today = dayKey(new Date());

  const open = (i: CalendarItem) => (i.kind === 'appointment' ? go({ event: i.id }) : i.link && navigate(i.link));
  const chip = (i: CalendarItem) => (
    <button key={`${i.kind}-${i.id}`} type="button" className={`cal-item cal-${i.kind}`} onClick={() => open(i)} title={[KIND[i.kind], i.ownerName, i.detail].filter(Boolean).join(' · ')}>
      {!i.allDay && <span className="cal-time">{time(i.start)}</span>} {i.title}
    </button>
  );

  return (
    <ViewFrame
      title={t("Calendar")}
      subtitle={title}
      crumbs={[{ label: t("Calendar") }]}
      actions={
        <>
          <button className="secondary" onClick={() => go({ date: dayKey(shift(mode, anchor, -1)) })} aria-label={t("Previous")}>‹</button>
          <button className="secondary" onClick={() => go({ date: null })}>{t("Today")}</button>
          <button className="secondary" onClick={() => go({ date: dayKey(shift(mode, anchor, 1)) })} aria-label={t("Next")}>›</button>
          <button onClick={() => setCreating(new Date())}>{t("+ New appointment")}</button>
        </>
      }
    >
      <div className="cal-toolbar">
        <FilterChips chips={[{ value: 'day', label: t("Day") }, { value: 'week', label: t("Week") }, { value: 'month', label: t("Month") }]} value={mode} onChange={(v) => go({ view: v === 'week' ? null : v })} />
        {!field && <FilterChips chips={[{ value: 'mine', label: t("My calendar") }, { value: 'team', label: t("Team calendar") }]} value={scope} onChange={(v) => go({ scope: v === 'mine' ? null : v })} />}
        <span className="cal-legend">
          {(Object.keys(KIND) as CalendarKind[]).filter((k) => !(field && k === 'milestone')).map((k) => <span key={k} className={`cal-item cal-${k}`}>{KIND[k]}</span>)}
        </span>
      </div>
      {!items.data && <Loading error={items.error} />}
      {items.data && mode !== 'day' && (
        <div className={`agenda-grid ${mode}`}>
          {days.slice(0, 7).map((d) => <div key={`h${d.getDay()}`} className="agenda-head">{d.toLocaleDateString(locale(), { weekday: 'short' })}</div>)}
          {days.map((d) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            const outside = mode === 'month' && d.getMonth() !== anchor.getMonth();
            return (
              <div key={k} className={`agenda-cell${outside ? ' outside' : ''}${k === today ? ' today' : ''}`} onDoubleClick={() => setCreating(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9))}>
                <button type="button" className="agenda-date" onClick={() => go({ view: 'day', date: k })}>{d.getDate()}</button>
                {(mode === 'month' ? list.slice(0, 4) : list).map(chip)}
                {mode === 'month' && list.length > 4 && <button type="button" className="agenda-more" onClick={() => go({ view: 'day', date: k })}>{tf("+{n} more", { n: list.length - 4 })}</button>}
              </div>
            );
          })}
        </div>
      )}
      {items.data && mode === 'day' && ((byDay.get(dayKey(anchor)) ?? []).length === 0
        ? <EmptyState title={t("Nothing planned on this day")}>{t("Create an appointment with “+ New appointment”.")}</EmptyState>
        : (
          <ul className="agenda-day">
            {(byDay.get(dayKey(anchor)) ?? []).map((i) => (
              <li key={`${i.kind}-${i.id}`}>
                <span className="agenda-day-time">{i.allDay ? t("All day") : `${time(i.start)}–${time(i.end)}`}</span>
                {chip(i)}
                <span className="muted">{[KIND[i.kind], i.ownerName, i.detail].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        ))}
      {creating && <AppointmentForm start={creating} onClose={() => setCreating(null)} onSaved={(e) => { setCreating(null); setReload((n) => n + 1); go({ event: e.id, date: dayKey(new Date(e.startsAt)) }); }} />}
      {eventId && <AppointmentDrawer id={eventId} onClose={() => go({ event: null })} onChanged={() => setReload((n) => n + 1)} />}
    </ViewFrame>
  );
}

function AppointmentForm({ start, event, onClose, onSaved }: { start: Date; event?: CalendarEvent; onClose: () => void; onSaved: (e: CalendarEvent) => void }) {
  const users = useUsers();
  const clients = activeClients(useClients());
  const s0 = event ? new Date(event.startsAt) : (() => { const d = new Date(start); if (d.getMinutes() || d.getSeconds()) { d.setHours(d.getHours() + 1, 0, 0, 0); } return d; })();
  const e0 = event ? new Date(event.endsAt) : new Date(s0.getTime() + 3_600_000);
  const [title, setTitle] = useState(event?.title ?? '');
  const [startsAt, setStartsAt] = useState(toLocalInput(s0));
  const [endsAt, setEndsAt] = useState(toLocalInput(e0));
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [location, setLocation] = useState(event?.location ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [visibility, setVisibility] = useState<'team' | 'private'>(event?.visibility ?? 'team');
  const [clientId, setClientId] = useState(event?.clientId ?? '');
  const [attendeeIds, setAttendeeIds] = useState<string[]>(event?.attendees.map((a) => a.userId) ?? []);
  const { busy, error, run, setError } = useAction();
  const colleagues = users.filter((u) => u.email !== myEmail());

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const s = allDay ? new Date(`${startsAt.slice(0, 10)}T00:00:00`) : new Date(startsAt);
    const e = allDay ? new Date(`${endsAt.slice(0, 10)}T23:59:00`) : new Date(endsAt);
    if (e < s) { setError(t("The end must be after the start")); return; }
    const body = { title, startsAt: s.toISOString(), endsAt: e.toISOString(), allDay, location: location || null, description: description || null, visibility, clientId: clientId || null, attendeeIds };
    const saved = await run(() => (event ? api.updateCalendarEvent(event.id, body) : api.createCalendarEvent(body)));
    if (saved) onSaved(saved);
  };

  return (
    <Drawer title={event ? t("Change appointment") : t("New appointment")} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <Field label={t("Title")}><input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Quarterly review with Jumbo")} /></Field>
        <label className="checkbox"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> {t("All day")}</label>
        <Field label={t("Start")}><input required type={allDay ? 'date' : 'datetime-local'} value={allDay ? startsAt.slice(0, 10) : startsAt} onChange={(e) => setStartsAt(allDay ? `${e.target.value}T00:00` : e.target.value)} /></Field>
        <Field label={t("End")}><input required type={allDay ? 'date' : 'datetime-local'} value={allDay ? endsAt.slice(0, 10) : endsAt} onChange={(e) => setEndsAt(allDay ? `${e.target.value}T23:59` : e.target.value)} /></Field>
        <Field label={t("Location")}><input maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("e.g. HQ meeting room 2 or the client's office")} /></Field>
        <Field label={t("Client")} hint={t("Optional: links the appointment to a client")}>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">{t("No client")}</option>
            {clients.map((c) => <option key={c.clientId} value={c.clientId}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={tf("Invitees ({n} selected)", { n: attendeeIds.length })} hint={t("Colleagues get a notification in Agera and can accept or decline")}>
          <div className="checklist-box">
            {colleagues.map((u) => (
              <label key={u.id} className="checkbox">
                <input type="checkbox" checked={attendeeIds.includes(u.id)} onChange={(e) => setAttendeeIds(e.target.checked ? [...attendeeIds, u.id] : attendeeIds.filter((x) => x !== u.id))} /> {userName(users, u.id)}
              </label>
            ))}
          </div>
        </Field>
        <Field label={t("Visibility")}>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'team' | 'private')}>
            <option value="team">{t("Team: colleagues see it in the team calendar")}</option>
            <option value="private">{t("Private: only you and the invitees")}</option>
          </select>
        </Field>
        <Field label={t("Notes")}><textarea rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <ErrorText error={error} />
        <FormActions busy={busy} submitLabel={event ? t("Save") : t("Create appointment")} onCancel={onClose} />
      </form>
    </Drawer>
  );
}

function AppointmentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const users = useUsers();
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const ev = useLoad(() => api.calendarEvent(id), [id, reload]);
  const { busy, error, run } = useAction();
  const e = ev.data;
  const myId = users.find((u) => u.email === myEmail())?.id;
  const organiser = !!e && e.createdBy === myId;
  const mine = e?.attendees.find((a) => a.userId === myId);
  const act = async (fn: () => Promise<unknown>) => { if (await run(fn)) { setReload((n) => n + 1); onChanged(); } };
  if (editing && e) return <AppointmentForm start={new Date(e.startsAt)} event={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setReload((n) => n + 1); onChanged(); }} />;
  return (
    <Drawer title={e?.title ?? t("Appointment")} onClose={onClose}>
      {!e && <Loading error={ev.error} />}
      {e && (
        <>
          {e.status === 'cancelled' && <p className="notice">{t("This appointment is cancelled.")}</p>}
          <DetailList items={[
            ["When", e.allDay ? `${new Date(e.startsAt).toLocaleDateString(locale())} · ${t("All day")}` : `${formatDateTime(e.startsAt)} – ${time(e.endsAt)}`],
            ["Location", e.location ?? '—'],
            ["Client", e.clientName ?? '—'],
            ["Organiser", e.createdByName],
            ["Visibility", e.visibility === 'private' ? t("Private") : t("Team")],
            ["Notes", e.description ?? '—'],
          ]} />
          <h3>{t("Invitees")}</h3>
          {e.attendees.length === 0 ? <p className="muted">{t("No invitees")}</p> : (
            <ul className="plain-list">
              {e.attendees.map((a) => <li key={a.userId}>{a.name} <StatusBadge status={a.response === 'accepted' ? 'ok' : a.response === 'declined' ? 'danger' : 'pending'} label={RESPONSE[a.response]} /></li>)}
            </ul>
          )}
          <ErrorText error={error} />
          {e.status === 'scheduled' && (
            <div className="form-actions">
              {mine && mine.response !== 'accepted' && <button disabled={busy} onClick={() => act(() => api.respondCalendarEvent(id, 'accepted'))}>{t("Accept")}</button>}
              {mine && mine.response !== 'declined' && <button className="secondary" disabled={busy} onClick={() => act(() => api.respondCalendarEvent(id, 'declined'))}>{t("Decline")}</button>}
              {organiser && <button className="secondary" disabled={busy} onClick={() => setEditing(true)}>{t("Change or move")}</button>}
              {organiser && <button className="danger" disabled={busy} onClick={() => window.confirm(t("Cancel this appointment? Invitees get a notification.")) && act(() => api.cancelCalendarEvent(id))}>{t("Cancel appointment")}</button>}
            </div>
          )}
          <p className="muted">{tf("Created by {name}", { name: e.createdByName ?? userName(users, e.createdBy) })}</p>
        </>
      )}
    </Drawer>
  );
}
