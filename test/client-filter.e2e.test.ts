/**
 * The client pill in the action bar filters work orders and store visits through the stores of that client.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Page<T> { items: T[] }

let alice: string;

before(async () => {
  alice = await getToken('alice', 'alice');
});

describe('client filter on work orders and visits', () => {
  it('returns only work orders and visits linked to the client’s stores', async () => {
    const stamp = Date.now();
    const client = (await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Filter client ${stamp}` })).body;
    const store = (await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `F-${stamp}`, name: `Filter store ${stamp}`, clientId: client.id })).body;
    const otherStore = (await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `G-${stamp}`, name: `Other store ${stamp}` })).body;
    const linked = (await api<{ id: string }>(alice, 'POST', '/work-orders', { title: `Linked ${stamp}` })).body;
    const unlinked = (await api<{ id: string }>(alice, 'POST', '/work-orders', { title: `Unlinked ${stamp}` })).body;
    const visit = (await api<{ id: string }>(alice, 'POST', '/visits', { storeId: store.id, workOrderId: linked.id, visitDate: '2026-11-02T09:30:00Z' })).body;
    const otherVisit = (await api<{ id: string }>(alice, 'POST', '/visits', { storeId: otherStore.id, workOrderId: unlinked.id, visitDate: '2026-11-02T10:30:00Z' })).body;

    const orders = await api<Page<{ id: string }>>(alice, 'GET', `/work-orders?clientId=${client.id}&limit=100`);
    assert.equal(orders.status, 200);
    assert.deepEqual(orders.body.items.map((w) => w.id), [linked.id]);

    const visits = await api<Page<{ id: string }>>(alice, 'GET', `/visits?clientId=${client.id}&limit=100`);
    assert.equal(visits.status, 200);
    assert.deepEqual(visits.body.items.map((v) => v.id), [visit.id]);
    assert.equal((await api<Page<unknown>>(alice, 'GET', `/visits?clientId=${client.id}&storeId=${otherStore.id}`)).body.items.length, 0);
    assert.ok((await api<Page<{ id: string }>>(alice, 'GET', '/visits?limit=100')).body.items.some((v) => v.id === otherVisit.id));

    assert.equal((await api<Page<unknown>>(alice, 'GET', `/work-orders?clientId=${randomUUID()}`)).body.items.length, 0);
    assert.equal((await api(alice, 'GET', '/work-orders?clientId=nope')).status, 400);
    assert.equal((await api(alice, 'GET', '/visits?clientId=nope')).status, 400);
  });

  it('does not leak another organisation’s work orders through the filter', async () => {
    const stamp = Date.now();
    const client = (await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Private client ${stamp}` })).body;
    const store = (await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `P-${stamp}`, name: `Private store ${stamp}`, clientId: client.id })).body;
    const order = (await api<{ id: string }>(alice, 'POST', '/work-orders', { title: `Private ${stamp}` })).body;
    await api(alice, 'POST', '/visits', { storeId: store.id, workOrderId: order.id, visitDate: '2026-11-02T09:30:00Z' });
    const devAdmin = await getToken('dev.admin', 'devadmin');
    assert.equal((await api<Page<unknown>>(devAdmin, 'GET', `/work-orders?clientId=${client.id}`)).body.items.length, 0);
    assert.equal((await api<Page<unknown>>(devAdmin, 'GET', `/visits?clientId=${client.id}`)).body.items.length, 0);
  });
});
