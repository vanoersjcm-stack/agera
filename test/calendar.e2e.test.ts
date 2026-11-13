/** Agera Calendar: appointments inside Agera plus visits, rounds and milestones; roles and privacy. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

let hannah: string, adam: string, fiona: string, victor: string, alice: string;
let adamId: string, fionaId: string, hannahId: string;
const from = '2026-12-01T00:00:00.000Z';
const to = '2026-12-31T00:00:00.000Z';

interface Ev { id: string; title: string; status: string; createdBy: string; attendees: { userId: string; response: string }[]; documents: { id: string; kind: string; title: string }[] }
interface Item { id: string; kind: string; title: string }

before(async () => {
  [hannah, adam, fiona, victor] = await Promise.all(['hannah', 'adam', 'fiona', 'victor'].map((u) => getToken(u, u)));
  alice = await getToken('alice', 'alice');
  [adamId, fionaId, hannahId] = await Promise.all([adam, fiona, hannah].map(async (tk) => (await api<{ id: string }>(tk, 'GET', '/users/me')).body.id));
});

describe('Agera Calendar', () => {
  it('creates an appointment with invitees who see it, respond and get notified', async () => {
    const title = `Quarterly review ${Date.now()}`;
    const created = await api<Ev>(hannah, 'POST', '/v1/calendar/events', { title, startsAt: '2026-12-10T09:00:00.000Z', endsAt: '2026-12-10T10:00:00.000Z', attendeeIds: [adamId], location: 'HQ' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.attendees.map((a) => a.response), ['pending']);
    const mine = await api<Item[]>(adam, 'GET', `/v1/calendar?from=${from}&to=${to}&scope=mine`);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.some((i) => i.id === created.body.id && i.kind === 'appointment'));
    const notes = await api<{ items: { title: string }[] }>(adam, 'GET', '/v1/notifications');
    assert.ok(notes.body.items.some((n) => n.title === `Invitation: ${title}`));
    const accepted = await api<Ev>(adam, 'POST', `/v1/calendar/events/${created.body.id}/respond`, { response: 'accepted' });
    assert.equal(accepted.body.attendees[0].response, 'accepted');
    assert.equal((await api(adam, 'PATCH', `/v1/calendar/events/${created.body.id}`, { title: 'Hijack' })).status, 403);
    const moved = await api<Ev & { startsAt: string }>(hannah, 'PATCH', `/v1/calendar/events/${created.body.id}`, { startsAt: '2026-12-11T09:00:00.000Z', endsAt: '2026-12-11T10:00:00.000Z' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const cancelled = await api<Ev>(hannah, 'POST', `/v1/calendar/events/${created.body.id}/cancel`);
    assert.equal(cancelled.body.status, 'cancelled');
    const after = await api<Item[]>(adam, 'GET', `/v1/calendar?from=${from}&to=${to}`);
    assert.ok(!after.body.some((i) => i.id === created.body.id));
  });

  it('keeps private appointments to the organiser and attendees', async () => {
    const p = await api<Ev>(hannah, 'POST', '/v1/calendar/events', { title: 'Private 1:1', startsAt: '2026-12-12T09:00:00.000Z', endsAt: '2026-12-12T09:30:00.000Z', visibility: 'private' });
    assert.equal(p.status, 201);
    const team = await api<Item[]>(adam, 'GET', `/v1/calendar?from=${from}&to=${to}&scope=team`);
    assert.ok(!team.body.some((i) => i.id === p.body.id));
    assert.equal((await api(adam, 'GET', `/v1/calendar/events/${p.body.id}`)).status, 404);
  });

  it('shows store visits for the field rep, validates input and refuses client contacts', async () => {
    const visits = await api<Item[]>(fiona, 'GET', `/v1/calendar?from=${from}&to=${to}&scope=team`);
    assert.equal(visits.status, 200);
    assert.ok(visits.body.every((i) => i.kind !== 'milestone'), 'field reps do not see client-room milestones');
    assert.equal((await api(victor, 'GET', `/v1/calendar?from=${from}&to=${to}`)).status, 403);
    assert.equal((await api(hannah, 'GET', `/v1/calendar?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z`)).status, 400);
    assert.equal((await api(hannah, 'POST', '/v1/calendar/events', { title: 'x', startsAt: '2026-12-10T10:00:00Z', endsAt: '2026-12-10T09:00:00Z' })).status, 400);
    assert.equal((await api(hannah, 'POST', '/v1/calendar/events', { title: 'x', startsAt: '2026-12-10T10:00:00Z', endsAt: '2026-12-10T11:00:00Z', attendeeIds: ['00000000-0000-4000-8000-000000000000'] })).status, 400);
    assert.ok(fionaId);
  });

  it('links documents and one-click meeting notes that follow the appointment visibility', async (t) => {
    const stamp = Date.now();
    const team = await api<Ev>(adam, 'POST', '/v1/calendar/events', { title: `Docs ${stamp}`, startsAt: '2026-12-14T09:00:00.000Z', endsAt: '2026-12-14T10:00:00.000Z', attendeeIds: [hannahId] });
    assert.equal(team.status, 201);
    assert.deepEqual(team.body.documents, []);
    const doc = await api<{ id: string }>(adam, 'POST', '/v1/documents', { title: `Agenda ${stamp}`, format: 'docx' });
    assert.equal(doc.status, 201, JSON.stringify(doc.body));
    assert.equal((await api(hannah, 'GET', `/v1/documents/${doc.body.id}`)).status, 404, 'a personal document starts with its creator only');
    assert.equal((await api(hannah, 'POST', `/v1/calendar/events/${team.body.id}/documents`, { documentId: doc.body.id })).status, 404, 'an invitee cannot link a document they cannot see');
    const linked = await api<Ev>(adam, 'POST', `/v1/calendar/events/${team.body.id}/documents`, { documentId: doc.body.id });
    assert.equal(linked.status, 201, JSON.stringify(linked.body));
    assert.deepEqual(linked.body.documents.map((d) => d.kind), ['attachment']);
    assert.equal((await api(hannah, 'GET', `/v1/documents/${doc.body.id}`)).status, 200, 'linked to a team appointment, invitees can open it');
    assert.equal((await api(alice, 'GET', `/v1/documents/${doc.body.id}`)).status, 200, 'and so can colleagues who see the team appointment');
    assert.equal((await api(hannah, 'DELETE', `/v1/calendar/events/${team.body.id}/documents/${doc.body.id}`)).status, 403, 'only the organiser or whoever linked it removes it');
    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${team.body.id}/documents`, { documentId: 'nope' })).status, 400);

    const priv = await api<Ev>(adam, 'POST', '/v1/calendar/events', { title: `Private docs ${stamp}`, startsAt: '2026-12-15T09:00:00.000Z', endsAt: '2026-12-15T10:00:00.000Z', visibility: 'private', attendeeIds: [hannahId] });
    const doc2 = await api<{ id: string }>(adam, 'POST', '/v1/documents', { title: `Private agenda ${stamp}`, format: 'docx' });
    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${priv.body.id}/documents`, { documentId: doc2.body.id })).status, 201);
    assert.equal((await api(hannah, 'GET', `/v1/documents/${doc2.body.id}`)).status, 200, 'invitees of a private appointment can open its documents');
    assert.equal((await api(alice, 'GET', `/v1/documents/${doc2.body.id}`)).status, 404, 'colleagues outside a private appointment cannot');
    assert.equal((await api(alice, 'POST', `/v1/calendar/events/${priv.body.id}/meeting-notes`, {})).status, 404);
    assert.equal((await api(victor, 'POST', `/v1/calendar/events/${team.body.id}/meeting-notes`, {})).status, 403);

    const removed = await api<Ev>(adam, 'DELETE', `/v1/calendar/events/${team.body.id}/documents/${doc.body.id}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.documents, []);
    assert.equal((await api(hannah, 'GET', `/v1/documents/${doc.body.id}`)).status, 404, 'unlinked, the document is personal again');

    const notes = await api<Ev>(hannah, 'POST', `/v1/calendar/events/${team.body.id}/meeting-notes`, { language: 'nl' });
    if (notes.status === 503) return t.skip('Agera Office not connected');
    assert.equal(notes.status, 201, JSON.stringify(notes.body));
    const n = notes.body.documents.find((d) => d.kind === 'notes');
    assert.ok(n && n.title.startsWith(`Notulen – Docs ${stamp}`), JSON.stringify(notes.body.documents));
    assert.equal((await api(adam, 'GET', `/v1/documents/${n.id}`)).status, 200, 'the organiser opens notes an invitee created');
    const again = await api<Ev>(adam, 'POST', `/v1/calendar/events/${team.body.id}/meeting-notes`, {});
    assert.equal(again.body.documents.filter((d) => d.kind === 'notes').length, 1, 'one set of meeting notes per appointment');
    assert.equal((await api(adam, 'POST', `/v1/calendar/events/${team.body.id}/meeting-notes`, { language: 'fr' })).status, 400);
  });
});
