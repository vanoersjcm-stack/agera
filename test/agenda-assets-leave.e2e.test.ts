/** Agenda: bookable rooms/equipment with buffer and no double booking, coordinator-only equipment, and the leave approval gate. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Asset { id: string; name: string; bookingMode: string; active: boolean }
interface Event { id: string; assets: { assetId: string; bufferMinutes: number }[] }
interface Leave { id: string; status: string; userId: string }

const stamp = Date.now();
const base = new Date(Date.UTC(2031, 0, 6 + (stamp % 200) * 7, 9, 0));
const at = (h: number, m = 0) => new Date(base.getTime() + (h * 60 + m) * 60_000).toISOString();
let hannah: string;
let adam: string;
let room: Asset;
let tv: Asset;

const event = async (token: string, title: string, start: string, end: string) => {
  const r = await api<Event>(token, 'POST', '/v1/calendar/events', { title, startsAt: start, endsAt: end });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};

before(async () => {
  [hannah, adam] = await Promise.all([getToken('hannah', 'hannah'), getToken('adam', 'adam')]);
  const r = await api<Asset>(hannah, 'POST', '/v1/calendar/assets', { name: `Room ${stamp}`, category: 'meeting_room', bookingMode: 'self_service' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  room = r.body;
  tv = (await api<Asset>(hannah, 'POST', '/v1/calendar/assets', { name: `TV ${stamp}`, category: 'av_equipment', bookingMode: 'coordinator_only' })).body;
});

describe('bookable assets', () => {
  it('only admins manage rooms and equipment', async () => {
    assert.equal((await api(adam, 'POST', '/v1/calendar/assets', { name: `No ${stamp}` })).status, 403);
    assert.equal((await api(adam, 'PATCH', `/v1/calendar/assets/${room.id}`, { active: false })).status, 403);
    assert.equal((await api(hannah, 'POST', '/v1/calendar/assets', { name: `Room ${stamp}` })).status, 409);
    const list = (await api<Asset[]>(adam, 'GET', '/v1/calendar/assets')).body.map((a) => a.id);
    assert.ok(list.includes(room.id) && list.includes(tv.id));
  });

  it('refuses a double booking, buffer included, and frees the slot when released', async () => {
    const first = await event(adam, 'First', at(0), at(1));
    const booked = await api<Event>(adam, 'POST', `/v1/calendar/events/${first.id}/assets`, { assetId: room.id, bufferMinutes: 30 });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.deepEqual(booked.body.assets.map((a) => [a.assetId, a.bufferMinutes]), [[room.id, 30]]);
    const second = await event(adam, 'Second', at(1, 15), at(2));
    const clash = await api<{ message: string }>(adam, 'POST', `/v1/calendar/events/${second.id}/assets`, { assetId: room.id });
    assert.equal(clash.status, 409, 'starts inside the 30-minute buffer');
    const later = await event(adam, 'Later', at(1, 30), at(2));
    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${later.id}/assets`, { assetId: room.id })).status, 201, 'right after the buffer is fine');
    assert.equal((await api(adam, 'PATCH', `/v1/calendar/events/${first.id}`, { startsAt: at(1, 0), endsAt: at(1, 45) })).status, 409, 'moving into a booked slot is refused');
    assert.equal((await api(adam, 'DELETE', `/v1/calendar/events/${later.id}/assets/${room.id}`)).status, 200);
    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${second.id}/assets`, { assetId: room.id })).status, 409, 'still inside the buffer of the first');
    const bookings = (await api<{ assetId: string; eventTitle: string | null }[]>(hannah, 'GET', `/v1/calendar/bookings?from=${at(-1)}&to=${at(4)}`)).body;
    assert.ok(bookings.some((b) => b.assetId === room.id && b.eventTitle === 'First'));
  });

  it('lets only admins assign coordinator-only equipment', async () => {
    const meeting = await event(adam, 'Screen needed', at(3), at(4));
    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${meeting.id}/assets`, { assetId: tv.id })).status, 403);
    assert.equal((await api(hannah, 'POST', `/v1/calendar/events/${meeting.id}/assets`, { assetId: tv.id, bufferMinutes: 15 })).status, 201);
    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${meeting.id}/assets`, { assetId: room.id, bufferMinutes: 10 })).status, 400);
  });
});

describe('leave and vacation', () => {
  it('shows leave on the grid and team agenda only after approval', async () => {
    const day = new Date(base.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
    const r = await api<Leave>(adam, 'POST', '/v1/calendar/leave', { leaveType: 'vacation', startDate: day, endDate: day });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'pending');
    const team = async () => (await api<{ kind: string; id: string }[]>(hannah, 'GET', `/v1/calendar?from=${day}T00:00:00Z&to=${day}T23:59:00Z&scope=team`)).body;
    assert.ok(!(await team()).some((i) => i.kind === 'leave' && i.id.startsWith(r.body.id)), 'pending leave is not on the agenda');
    const otherView = (await api<{ requests: Leave[] }>(await getToken('fiona', 'fiona'), 'GET', `/v1/calendar/leave?from=${day}&to=${day}`)).body;
    assert.ok(!otherView.requests.some((l) => l.id === r.body.id), 'colleagues do not see pending leave');
    assert.equal((await api(adam, 'POST', `/v1/calendar/leave/${r.body.id}/decision`, { decision: 'approved' })).status, 403);
    const ok = await api<Leave>(hannah, 'POST', `/v1/calendar/leave/${r.body.id}/decision`, { decision: 'approved' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'approved');
    assert.ok((await team()).some((i) => i.kind === 'leave' && i.id.startsWith(r.body.id)));
    assert.equal((await api(hannah, 'POST', `/v1/calendar/leave/${r.body.id}/decision`, { decision: 'rejected' })).status, 409);
  });
});

describe('creating an agenda item with rooms and equipment', () => {
  it('books in the same step and saves nothing when a booking clashes', async () => {
    const r = await api<Event>(adam, 'POST', '/v1/calendar/events', { title: `With room ${stamp}`, startsAt: at(6), endsAt: at(7), assets: [{ assetId: room.id, bufferMinutes: 15 }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual(r.body.assets.map((a) => [a.assetId, a.bufferMinutes]), [[room.id, 15]]);
    const clash = await api(adam, 'POST', '/v1/calendar/events', { title: `Clash ${stamp}`, startsAt: at(7, 10), endsAt: at(8), assets: [{ assetId: room.id }] });
    assert.equal(clash.status, 409, 'starts inside the 15-minute buffer');
    assert.equal((await api(adam, 'POST', '/v1/calendar/events', { title: `Screen ${stamp}`, startsAt: at(9), endsAt: at(10), assets: [{ assetId: tv.id }] })).status, 403);
    assert.equal((await api(adam, 'POST', '/v1/calendar/events', { title: 'Bad', startsAt: at(9), endsAt: at(10), assets: [{ assetId: room.id, bufferMinutes: 20 }] })).status, 400);
    const items = (await api<{ title: string }[]>(adam, 'GET', `/v1/calendar?from=${at(5)}&to=${at(11)}&scope=mine`)).body;
    const titles = (Array.isArray(items) ? items : (items as unknown as { items: { title: string }[] }).items).map((i) => i.title);
    assert.ok(titles.includes(`With room ${stamp}`));
    assert.ok(!titles.includes(`Clash ${stamp}`) && !titles.includes(`Screen ${stamp}`), 'refused items are not saved');
  });
});

describe('planning a meeting', () => {
  interface Busy { start: string; end: string; source: string; title: string | null; refId: string | null }
  interface Avail { me: string; people: { userId: string; busy: Busy[] }[]; assets: { assetId: string; busy: Busy[] }[] }
  it('shows colleagues busy (private items without details) and rooms booked, and stores optional invitees', async () => {
    const hannahId = (await api<Avail>(hannah, 'POST', '/v1/calendar/availability', { from: at(0), to: at(1) })).body.me;
    const secret = await api<Event>(hannah, 'POST', '/v1/calendar/events', { title: `Secret ${stamp}`, startsAt: at(30), endsAt: at(31), visibility: 'private' });
    assert.equal(secret.status, 201, JSON.stringify(secret.body));
    const booked = await api<Event>(hannah, 'POST', '/v1/calendar/events', { title: `Room taken ${stamp}`, startsAt: at(32), endsAt: at(33), assets: [{ assetId: room.id, bufferMinutes: 15 }] });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));

    const r = await api<Avail>(adam, 'POST', '/v1/calendar/availability', { userIds: [hannahId], assetIds: [room.id], from: at(29), to: at(34) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const busy = r.body.people[0].busy;
    const hidden = busy.find((b) => b.start === at(30));
    assert.ok(hidden, 'private item counts as busy');
    assert.equal(hidden.title, null, 'without its title');
    assert.ok(busy.some((b) => b.title === `Room taken ${stamp}`));
    assert.equal(new Date(r.body.assets[0].busy[0].end).toISOString(), at(33, 15), 'room busy until the buffer ends');
    assert.equal((await api(adam, 'POST', '/v1/calendar/availability', { from: at(1), to: at(0) })).status, 400);

    const meet = await api<Event & { planningMode: string; attendees: { userId: string; required: boolean }[] }>(adam, 'POST', '/v1/calendar/events', {
      title: `Planned ${stamp}`, startsAt: at(35), endsAt: at(36), planningMode: 'find', attendeeIds: [hannahId], optionalIds: [hannahId],
    });
    assert.equal(meet.status, 201, JSON.stringify(meet.body));
    assert.equal(meet.body.planningMode, 'find');
    assert.equal(meet.body.attendees.find((a) => a.userId === hannahId)?.required, false);
    assert.equal((await api(adam, 'POST', '/v1/calendar/events', { title: 'x', startsAt: at(37), endsAt: at(38), optionalIds: [hannahId] })).status, 400);
  });
});

describe('mandatory meeting', () => {
  interface Full extends Event { planningMode: string; overrides: { kind: string; action: string; detail: string | null }[]; overriddenBy: { eventId: string }[]; attendees: { userId: string; response: string; reason: string | null }[] }
  it('overrides the invitees planning: flags items, moves visits, takes over rooms; cannot be declined', async () => {
    const fiona = await getToken('fiona', 'fiona');
    const ids = async (token: string) => (await api<{ me: string }>(token, 'POST', '/v1/calendar/availability', { from: at(0), to: at(1) })).body.me;
    const [adamId, fionaId] = [await ids(adam), await ids(fiona)];
    const store = (await api<{ items: { id: string }[] }>(hannah, 'GET', '/stores?limit=1')).body.items[0];
    const visit = await api<{ id: string }>(fiona, 'POST', '/visits', { storeId: store.id, visitDate: at(48) });
    assert.equal(visit.status, 201, JSON.stringify(visit.body));
    const own = await api<Event>(adam, 'POST', '/v1/calendar/events', { title: `Own ${stamp}`, startsAt: at(48), endsAt: at(49), assets: [{ assetId: room.id }] });
    assert.equal(own.status, 201, JSON.stringify(own.body));

    assert.equal((await api(fiona, 'POST', '/v1/calendar/events', { title: 'No', startsAt: at(50), endsAt: at(51), planningMode: 'mandatory' })).status, 403);
    const blocked = await api(hannah, 'POST', '/v1/calendar/events', { title: 'Free only', startsAt: at(48), endsAt: at(49), planningMode: 'mandatory', assets: [{ assetId: room.id }] });
    assert.equal(blocked.status, 409, 'only free rooms by default');

    const r = await api<Full>(hannah, 'POST', '/v1/calendar/events', {
      title: `All hands ${stamp}`, startsAt: at(48), endsAt: at(49), planningMode: 'mandatory', attendeeIds: [adamId, fionaId],
      visitConflicts: 'move', roomConflicts: 'take_over', assets: [{ assetId: room.id }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const actions = r.body.overrides.map((o) => `${o.kind}:${o.action}`).sort();
    assert.deepEqual(actions, ['asset:taken_over', 'event:flagged', 'visit:moved']);
    assert.deepEqual(r.body.assets.map((a) => a.assetId), [room.id]);

    const mine = (await api<Full>(adam, 'GET', `/v1/calendar/events/${own.body.id}`)).body;
    assert.deepEqual(mine.overriddenBy.map((o) => o.eventId), [r.body.id]);
    assert.equal(mine.assets.length, 0, 'room taken over');
    const moved = r.body.overrides.find((o) => o.kind === 'visit')?.detail ?? '';
    assert.match(moved, new RegExp(`${at(48)} -> ${at(49)}`), 'moved to right after the meeting');

    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${r.body.id}/respond`, { response: 'declined' })).status, 400);
    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${r.body.id}/respond`, { response: 'unable' })).status, 400);
    const unable = await api<Full>(adam, 'POST', `/v1/calendar/events/${r.body.id}/respond`, { response: 'unable', reason: 'At a client' });
    assert.equal(unable.status, 201, JSON.stringify(unable.body));
    assert.deepEqual(unable.body.attendees.filter((a) => a.userId === adamId).map((a) => [a.response, a.reason]), [['unable', 'At a client']]);
  });
});
