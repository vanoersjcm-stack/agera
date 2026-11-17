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
