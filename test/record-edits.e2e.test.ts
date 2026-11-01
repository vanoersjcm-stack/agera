/** B2: editing stores, work orders, visits and agreements (PATCH /:id). */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

let alice: string;
let devAdmin: string;
let carol: string;
const run = Date.now();

before(async () => {
  [alice, devAdmin, carol] = await Promise.all([getToken('alice', 'alice'), getToken('dev.admin', 'devadmin'), getToken('carol', 'carol')]);
});

describe('PATCH /stores/:id', () => {
  it('edits name, address and status, rejects duplicates and other tenants', async () => {
    const a = await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `E1-${run}`, name: 'Edit me' });
    const b = await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `E2-${run}`, name: 'Other' });
    assert.equal(a.status, 201);
    const edited = await api<{ name: string; address: string | null; status: string }>(alice, 'PATCH', `/stores/${a.body.id}`, {
      name: 'Edited store',
      address: 'Damrak 1',
      status: 'closed',
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.name, 'Edited store');
    assert.equal(edited.body.address, 'Damrak 1');
    assert.equal(edited.body.status, 'closed');
    assert.equal((await api(alice, 'PATCH', `/stores/${b.body.id}`, { storeCode: `E1-${run}` })).status, 409);
    assert.equal((await api(alice, 'PATCH', `/stores/${a.body.id}`, { status: 'gone' })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/stores/${a.body.id}`, {})).status, 400);
    assert.equal((await api(devAdmin, 'PATCH', `/stores/${a.body.id}`, { name: 'x' })).status, 404);
  });
});

describe('PATCH /work-orders/:id', () => {
  it('edits title, description and priority', async () => {
    const created = await api<{ id: string; priority: string }>(alice, 'POST', '/work-orders', { title: `WO ${run}`, priority: 'high' });
    assert.equal(created.status, 201);
    assert.equal(created.body.priority, 'high');
    const edited = await api<{ title: string; description: string | null; priority: string }>(alice, 'PATCH', `/work-orders/${created.body.id}`, {
      title: 'Renamed',
      description: 'More detail',
      priority: 'urgent',
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.deepEqual([edited.body.title, edited.body.description, edited.body.priority], ['Renamed', 'More detail', 'urgent']);
    assert.equal((await api(alice, 'PATCH', `/work-orders/${created.body.id}`, { priority: 'asap' })).status, 400);
    assert.equal((await api(devAdmin, 'PATCH', `/work-orders/${created.body.id}`, { title: 'x' })).status, 404);
  });

  it('defaults priority to normal', async () => {
    const created = await api<{ priority: string }>(alice, 'POST', '/work-orders', { title: `WO default ${run}` });
    assert.equal(created.body.priority, 'normal');
  });
});

describe('PATCH /visits/:id', () => {
  it('edits date and notes of an open visit, not of a cancelled one', async () => {
    const store = await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `EV-${run}`, name: 'Visit store' });
    const visit = await api<{ id: string }>(alice, 'POST', '/visits', { storeId: store.body.id, visitDate: '2026-11-02T09:30:00Z' });
    assert.equal(visit.status, 201);
    const edited = await api<{ visitDate: string; notes: string | null }>(alice, 'PATCH', `/visits/${visit.body.id}`, {
      visitDate: '2026-11-05T14:00:00Z',
      notes: 'Bring planogram',
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(new Date(edited.body.visitDate).toISOString(), '2026-11-05T14:00:00.000Z');
    assert.equal(edited.body.notes, 'Bring planogram');
    assert.equal((await api(alice, 'PATCH', `/visits/${visit.body.id}`, { fieldRepId: 'nope' })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/visits/${visit.body.id}`, { fieldRepId: '00000000-0000-4000-8000-000000000000' })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/visits/${visit.body.id}/status`, { status: 'CANCELLED' })).status, 200);
    assert.equal((await api(alice, 'PATCH', `/visits/${visit.body.id}`, { notes: 'too late' })).status, 409);
  });
});

describe('PATCH /v1/agreements/:id', () => {
  it('edits title and document link; client users cannot', async () => {
    const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Agreement client ${run}` });
    const agreement = await api<{ id: string }>(alice, 'POST', '/v1/agreements', {
      clientId: client.body.id,
      title: 'Draft terms',
      documentUrl: 'https://docs.example.com/a.pdf',
    });
    assert.equal(agreement.status, 201, JSON.stringify(agreement.body));
    const edited = await api<{ title: string; documentUrl: string }>(alice, 'PATCH', `/v1/agreements/${agreement.body.id}`, {
      title: 'Final terms',
      documentUrl: 'https://docs.example.com/b.pdf',
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.title, 'Final terms');
    assert.equal(edited.body.documentUrl, 'https://docs.example.com/b.pdf');
    assert.equal((await api(alice, 'PATCH', `/v1/agreements/${agreement.body.id}`, { documentUrl: 'ftp://x' })).status, 400);
    assert.equal((await api(carol, 'PATCH', `/v1/agreements/${agreement.body.id}`, { title: 'x' })).status, 403);
  });
});
