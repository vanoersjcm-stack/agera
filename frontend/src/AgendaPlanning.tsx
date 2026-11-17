import { useEffect, useState } from 'react';
import { api, type Availability, type BusyPeriod, type PlanningMode } from './api';
import { live, locale, t, tf } from './i18n';
import { ErrorText, Field, FilterChips, StatusBadge } from './ui';

const WEEKDAYS: { day: number; label: string }[] = live(() => [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, label: new Date(2024, 0, day === 0 ? 7 : day).toLocaleDateString(locale(), { weekday: 'short' }) })));
const time = (d: Date) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const overlaps = (b: BusyPeriod, s: number, e: number) => new Date(b.start).getTime() < e && new Date(b.end).getTime() > s;

function busyLabel(b: BusyPeriod): string {
  if (b.source === 'leave') return t("On leave");
  if (b.source === 'visit') return tf("Store visit: {name}", { name: b.title ?? '' });
  return b.title ? tf("Busy: {title}", { title: b.title }) : t("Busy (private)");
}

export function PlanningChoice({ mode, onChange }: { mode: PlanningMode; onChange: (m: PlanningMode) => void }) {
  return (
    <Field label={t("How do you want to plan this?")} hint={mode === 'find' ? t("Agera finds moments when the invitees, rooms and equipment are free.") : t("You pick the moment; Agera shows who can come.")}>
      <FilterChips chips={[{ value: 'fixed', label: t("Fixed date") }, { value: 'find', label: t("Find a time") }]} value={mode} onChange={(v) => onChange(v as PlanningMode)} />
    </Field>
  );
}

/** Fixed date: who can come and whether the rooms/equipment are free at the chosen moment. */
export function AttendanceCheck({ userIds, optionalIds, assetIds, start, end, buffer }: { userIds: string[]; optionalIds: string[]; assetIds: string[]; start: Date; end: Date; buffer: number }) {
  const [data, setData] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = start.getTime(); const e = end.getTime();
  const key = `${userIds.join()}|${assetIds.join()}|${s}|${e}|${buffer}`;
  useEffect(() => {
    if ((!userIds.length && !assetIds.length) || !(e > s)) { setData(null); return; }
    const id = setTimeout(() => { api.calendarAvailability({ userIds, assetIds, from: new Date(s).toISOString(), to: new Date(e + buffer * 60_000).toISOString() }).then(setData, (err) => setError(err instanceof Error ? err.message : String(err))); }, 300);
    return () => clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!userIds.length && !assetIds.length) return null;
  return (
    <div className="plan-check">
      <strong>{t("Who can come")}</strong>
      <ErrorText error={error} />
      {!data ? <p className="muted small">{t("Checking agendas…")}</p> : (
        <ul className="plain-list">
          {data.people.map((p) => {
            const clash = p.busy.filter((b) => overlaps(b, s, e));
            const leave = clash.find((b) => b.source === 'leave');
            return (
              <li key={p.userId}>
                {p.name}{optionalIds.includes(p.userId) && <span className="muted small"> · {t("optional")}</span>}{' '}
                {clash.length === 0 ? <StatusBadge status="ok" label={t("Available")} /> : <StatusBadge status={leave ? 'danger' : 'pending'} label={busyLabel(leave ?? clash[0])} />}
              </li>
            );
          })}
          {data.assets.map((a) => {
            const clash = a.busy.find((b) => overlaps(b, s, e + buffer * 60_000));
            return <li key={a.assetId}>{a.name} {clash ? <StatusBadge status="danger" label={tf("Booked until {time}", { time: time(new Date(clash.end)) })} /> : <StatusBadge status="ok" label={t("Free")} />}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

interface Slot { start: Date; end: Date; optionalFree: number }

/** Find a time: moments when every required invitee and every room/equipment is free, best attendance first. */
export function FindTime({ userIds, optionalIds, assetIds, buffer, onPick }: { userIds: string[]; optionalIds: string[]; assetIds: string[]; buffer: number; onPick: (start: Date, end: Date) => void }) {
  const today = new Date();
  const [duration, setDuration] = useState('60');
  const [from, setFrom] = useState(dateInput(today));
  const [to, setTo] = useState(dateInput(new Date(today.getTime() + 13 * 86_400_000)));
  const [workStart, setWorkStart] = useState('08:30');
  const [workEnd, setWorkEnd] = useState('17:30');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true); setError(null); setSlots(null);
    try {
      const rangeFrom = new Date(`${from}T00:00:00`); const rangeTo = new Date(`${to}T23:59:59`);
      if (!(rangeTo > rangeFrom)) throw new Error(t("The end must be after the start"));
      const data = await api.calendarAvailability({ userIds, assetIds, from: rangeFrom.toISOString(), to: rangeTo.toISOString() });
      const len = Number(duration) * 60_000; const now = Date.now();
      const required = data.people.filter((p) => !optionalIds.includes(p.userId));
      const optional = data.people.filter((p) => optionalIds.includes(p.userId));
      const found: Slot[] = [];
      for (let d = new Date(rangeFrom); d <= rangeTo; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
        if (!days.includes(d.getDay())) continue;
        const dayStart = new Date(`${dateInput(d)}T${workStart}:00`).getTime(); const dayEnd = new Date(`${dateInput(d)}T${workEnd}:00`).getTime();
        for (let s = dayStart; s + len <= dayEnd; s += 15 * 60_000) {
          if (s < now) continue;
          const e = s + len;
          if (required.some((p) => p.busy.some((b) => overlaps(b, s, e)))) continue;
          if (data.assets.some((a) => a.busy.some((b) => overlaps(b, s, e + buffer * 60_000)))) continue;
          found.push({ start: new Date(s), end: new Date(e), optionalFree: optional.filter((p) => !p.busy.some((b) => overlaps(b, s, e))).length });
        }
      }
      found.sort((a, b) => b.optionalFree - a.optionalFree || a.start.getTime() - b.start.getTime());
      const picked: Slot[] = [];
      for (const f of found) {
        if (picked.length >= 5) break;
        if (picked.some((p) => Math.abs(p.start.getTime() - f.start.getTime()) < len)) continue;
        if (picked.filter((p) => p.start.toDateString() === f.start.toDateString()).length >= 2) continue;
        picked.push(f);
      }
      setSlots(picked.sort((a, b) => a.start.getTime() - b.start.getTime()));
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  const optionalCount = optionalIds.filter((id) => userIds.includes(id)).length;
  return (
    <div className="plan-check">
      <div className="plan-row">
        <label>{t("Duration")}
          <select value={duration} onChange={(e) => setDuration(e.target.value)}>
            {[30, 45, 60, 90, 120, 180, 240].map((n) => <option key={n} value={n}>{n < 60 ? tf("{n} min", { n }) : tf("{n} h", { n: n / 60 })}</option>)}
          </select>
        </label>
        <label>{t("From")}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>{t("Until")}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="plan-row">
        <label>{t("Working hours")}<span className="plan-hours"><input type="time" value={workStart} onChange={(e) => setWorkStart(e.target.value)} />–<input type="time" value={workEnd} onChange={(e) => setWorkEnd(e.target.value)} /></span></label>
        <span className="plan-days" role="group" aria-label={t("Working days")}>
          {WEEKDAYS.map((w) => (
            <label key={w.day} className="checkbox"><input type="checkbox" checked={days.includes(w.day)} onChange={(e) => setDays(e.target.checked ? [...days, w.day] : days.filter((x) => x !== w.day))} /> {w.label}</label>
          ))}
        </span>
      </div>
      <button type="button" className="secondary" disabled={busy || (!userIds.length && !assetIds.length)} onClick={search}>{busy ? t("Searching…") : t("Find times")}</button>
      {!userIds.length && !assetIds.length && <p className="muted small">{t("Choose invitees or rooms/equipment first.")}</p>}
      <ErrorText error={error} />
      {slots && (slots.length === 0 ? <p className="notice">{t("No moment found when all required invitees and the rooms/equipment are free. Try a longer period, other hours, or make some invitees optional.")}</p> : (
        <ul className="plan-slots">
          {slots.map((sl) => (
            <li key={sl.start.getTime()}>
              <button type="button" className="chip" onClick={() => onPick(sl.start, sl.end)}>
                {sl.start.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })} {time(sl.start)}–{time(sl.end)}
              </button>
              <span className="muted small"> {t("all required invitees")}{optionalCount ? ` · ${tf("{n} of {m} optional", { n: sl.optionalFree, m: optionalCount })}` : ''}{assetIds.length ? ` · ${t("rooms/equipment free")}` : ''}</span>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}
