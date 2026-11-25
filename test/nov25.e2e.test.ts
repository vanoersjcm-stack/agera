/** Nov 25 batch: no past dates in the agenda and action plans, formal salutations, client name on approvals. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';
import { attentionLine, salutation } from '../src/modules/clients/salutation.ts';

const stamp = Date.now();
const day = 86_400_000;
let alice: string;
let hannah: string;

before(async () => {
  [alice, hannah] = await Promise.all([getToken('alice', 'alice'), getToken('hannah', 'hannah')]);
});

describe('forward-only dates', () => {
  it('refuses agenda items that start before today, also when moved', async () => {
    const past = new Date(Date.now() - 2 * day);
    const r = await api(hannah, 'POST', '/v1/calendar/events', { title: `Past ${stamp}`, startsAt: past.toISOString(), endsAt: new Date(past.getTime() + 3_600_000).toISOString() });
    assert.equal(r.status, 400);
    const future = new Date(Date.now() + 3 * day);
    const ok = await api<{ id: string }>(hannah, 'POST', '/v1/calendar/events', { title: `Future ${stamp}`, startsAt: future.toISOString(), endsAt: new Date(future.getTime() + 3_600_000).toISOString() });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal((await api(hannah, 'PATCH', `/v1/calendar/events/${ok.body.id}`, { startsAt: past.toISOString(), endsAt: new Date(past.getTime() + 3_600_000).toISOString() })).status, 400);
  });

  it('refuses action plan steps due before today', async () => {
    const clients = (await api<{ id: string; entityCategory: string }[]>(alice, 'GET', '/v1/clients')).body.filter((c) => c.entityCategory === 'client');
    const room = await api<{ id: string }>(alice, 'POST', '/v1/dsrs', { clientId: clients[0].id, roomName: `Dates ${stamp}` });
    assert.equal(room.status, 201, JSON.stringify(room.body));
    const yesterday = new Date(Date.now() - day).toISOString().slice(0, 10);
    assert.equal((await api(alice, 'POST', `/v1/nexus/client-rooms/${room.body.id}/milestones`, { title: 'Too late', dueDate: yesterday })).status, 400);
    const later = new Date(Date.now() + 7 * day).toISOString().slice(0, 10);
    assert.equal((await api(alice, 'POST', `/v1/nexus/client-rooms/${room.body.id}/milestones`, { title: 'On time', dueDate: later })).status, 201);
  });
});

describe('formal salutation', () => {
  const peter = { firstName: 'Peter', initials: 'P.', surnamePrefix: 'van', lastName: 'Adrichem', gender: 'male' as const, academicTitlePrefix: null };
  it('writes the address line and salutation per language', () => {
    assert.equal(attentionLine(peter, 'nl'), 't.a.v. de heer P. van Adrichem');
    assert.equal(salutation(peter, 'nl'), 'Geachte heer Van Adrichem,');
    assert.equal(salutation(peter, 'en'), 'Dear Mr. Van Adrichem,');
    assert.equal(salutation({ ...peter, academicTitlePrefix: 'Herr Dr.' }, 'de'), 'Sehr geehrter Herr Dr. van Adrichem,');
    assert.equal(attentionLine({ ...peter, academicTitlePrefix: 'Dr.' }, 'de'), 'z. Hd. Herrn Dr. P. van Adrichem');
    assert.equal(salutation(peter, 'fr'), 'Cher Monsieur Van Adrichem,');
    assert.equal(salutation({ ...peter, gender: 'unknown' }, 'nl'), 'Geachte heer/mevrouw,');
    assert.equal(salutation({ ...peter, salutationMode: 'informal' }, 'nl'), 'Beste Peter,');
  });

  it('stores the name parts on a contact and fills {{salutation}} in a letter', async () => {
    const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Salutation client ${stamp}`, entityCategory: 'client' });
    assert.equal(client.status, 201, JSON.stringify(client.body));
    const contact = await api<{ id: string; surnamePrefix: string }>(alice, 'POST', `/v1/clients/${client.body.id}/contacts`, {
      firstName: 'Peter', initials: 'P.', surnamePrefix: 'van', lastName: 'Adrichem', gender: 'male', letterLanguage: 'nl', isPrimary: true,
    });
    assert.equal(contact.status, 201, JSON.stringify(contact.body));
    assert.equal((await api(alice, 'POST', `/v1/clients/${client.body.id}/contacts`, { firstName: 'X', gender: 'other' })).status, 400);
    const tpl = await api<{ id: string }>(alice, 'POST', '/v1/document-templates', { name: `Brief ${stamp}`, kind: 'letter', body: '{{contact.attention}}\n\n{{salutation}}' });
    assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
    const r = await api<{ text: string }>(alice, 'POST', `/v1/document-templates/${tpl.body.id}/render`, { clientId: client.body.id });
    assert.equal(r.body.text, 't.a.v. de heer P. van Adrichem\n\nGeachte heer Van Adrichem,');
  });
});
