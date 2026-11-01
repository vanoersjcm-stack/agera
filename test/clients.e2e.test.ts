/** B1: clients and contacts (/v1/clients), incl. tenant isolation and client-user access. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface ClientSummary {
  id: string;
  name: string;
  legalName: string | null;
  city: string | null;
  status: string;
  activeAgreements: number;
  activeRooms: number;
  contractValue: string;
}
interface Contact {
  id: string;
  clientId: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  isPrimary: boolean;
}
interface ClientRecord {
  client: ClientSummary;
  contacts: Contact[];
  agreements: { id: string }[];
  rooms: { id: string }[];
  plans: { id: string }[];
}

let alice: string;
let devAdmin: string;
let carol: string;
let clientId: string;

before(async () => {
  [alice, devAdmin, carol] = await Promise.all([getToken('alice', 'alice'), getToken('dev.admin', 'devadmin'), getToken('carol', 'carol')]);
});

describe('/v1/clients', () => {
  it('creates a client and lists it with zeroed stats', async () => {
    const name = `Client ${Date.now()}`;
    const created = await api<ClientSummary>(alice, 'POST', '/v1/clients', { name, legalName: `${name} B.V.`, city: 'Utrecht' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'active');
    assert.equal(created.body.activeAgreements, 0);
    assert.equal(created.body.contractValue, '0');
    clientId = created.body.id;
    const list = await api<ClientSummary[]>(alice, 'GET', '/v1/clients');
    assert.equal(list.status, 200);
    assert.ok(list.body.some((c) => c.id === clientId && c.name === name));
  });

  it('validates input', async () => {
    assert.equal((await api(alice, 'POST', '/v1/clients', { name: '  ' })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/v1/clients/${clientId}`, {})).status, 400);
    assert.equal((await api(alice, 'PATCH', `/v1/clients/${clientId}`, { status: 'deleted' })).status, 400);
    assert.equal((await api(alice, 'POST', `/v1/clients/${clientId}/contacts`, { firstName: 'X', email: 'nope' })).status, 400);
  });

  it('manages contacts with a single primary contact', async () => {
    const first = await api<Contact>(alice, 'POST', `/v1/clients/${clientId}/contacts`, {
      firstName: 'Anna',
      lastName: 'Jansen',
      email: 'Anna@Example.com',
      isPrimary: true,
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.email, 'anna@example.com');
    const second = await api<Contact>(alice, 'POST', `/v1/clients/${clientId}/contacts`, { firstName: 'Bas', isPrimary: true });
    assert.equal(second.status, 201);
    const record = await api<ClientRecord>(alice, 'GET', `/v1/clients/${clientId}`);
    assert.equal(record.status, 200);
    assert.deepEqual(
      record.body.contacts.map((c) => [c.firstName, c.isPrimary]),
      [['Bas', true], ['Anna', false]],
    );
    const renamed = await api<Contact>(alice, 'PATCH', `/v1/clients/${clientId}/contacts/${first.body.id}`, { roleTitle: 'Buyer', isPrimary: true });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.isPrimary, true);
  });

  it('shows linked agreements and client rooms in the record and stats', async () => {
    const agreement = await api<{ id: string }>(alice, 'POST', '/v1/agreements', {
      clientId,
      title: 'Framework 2027',
      documentUrl: 'https://docs.example.com/fw-2027.pdf',
    });
    assert.equal(agreement.status, 201, JSON.stringify(agreement.body));
    assert.equal((await api(alice, 'PATCH', `/v1/agreements/${agreement.body.id}/status`, { status: 'active' })).status, 200);
    const room = await api<{ id: string }>(alice, 'POST', '/v1/dsrs', { clientId, agreementId: agreement.body.id, roomName: 'Framework room' });
    assert.equal(room.status, 201, JSON.stringify(room.body));
    const record = await api<ClientRecord>(alice, 'GET', `/v1/clients/${clientId}`);
    assert.deepEqual(record.body.agreements.map((a) => a.id), [agreement.body.id]);
    assert.deepEqual(record.body.rooms.map((r) => r.id), [room.body.id]);
    assert.equal(record.body.client.activeAgreements, 1);
    assert.equal(record.body.client.activeRooms, 1);
  });

  it('is found by global search', async () => {
    const record = await api<ClientRecord>(alice, 'GET', `/v1/clients/${clientId}`);
    const hits = await api<{ entityType: string; id: string; route: string }[]>(
      alice,
      'GET',
      `/search?q=${encodeURIComponent(record.body.client.name)}`,
    );
    assert.equal(hits.status, 200);
    const hit = hits.body.find((h) => h.entityType === 'client' && h.id === clientId);
    assert.ok(hit);
    assert.equal(hit.route, `/nexus/clients/${clientId}`);
  });

  it('archives and reactivates a client', async () => {
    const archived = await api<ClientSummary>(alice, 'PATCH', `/v1/clients/${clientId}`, { status: 'archived', city: 'Amsterdam' });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.status, 'archived');
    assert.equal(archived.body.city, 'Amsterdam');
    assert.equal((await api<ClientSummary>(alice, 'PATCH', `/v1/clients/${clientId}`, { status: 'active' })).body.status, 'active');
  });

  it('isolates tenants and denies client users', async () => {
    assert.equal((await api(devAdmin, 'GET', `/v1/clients/${clientId}`)).status, 404);
    assert.ok(!(await api<ClientSummary[]>(devAdmin, 'GET', '/v1/clients')).body.some((c) => c.id === clientId));
    assert.equal((await api(devAdmin, 'PATCH', `/v1/clients/${clientId}`, { name: 'Hijack' })).status, 404);
    assert.equal((await api(carol, 'GET', '/v1/clients')).status, 403);
    assert.equal((await api(carol, 'POST', '/v1/clients', { name: 'Nope' })).status, 403);
  });
});
