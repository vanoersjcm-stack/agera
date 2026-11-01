/** Slice 1 (audit §13 G7/G8/G17/G18): client master data, store-to-client link, user title/zone, search by ERP ID/KvK. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface ClientSummary {
  id: string;
  name: string;
  kvkNumber: string | null;
  sector: string | null;
  address: string | null;
  paymentTerms: string;
  creditLimit: string;
  creditStatus: string;
  erpId: string | null;
  accountManagerId: string | null;
  accountManagerName: string | null;
}
interface UserSummary { id: string; name: string; title: string | null }

let alice: string;
let devAdmin: string;
let clientId: string;
let managerId: string;
const stamp = Date.now();

before(async () => {
  [alice, devAdmin] = await Promise.all([getToken('alice', 'alice'), getToken('dev.admin', 'devadmin')]);
  const users = await api<UserSummary[]>(alice, 'GET', '/users');
  managerId = users.body[0].id;
});

describe('client master data', () => {
  it('defaults new clients to Net 30 days, zero credit and approved', async () => {
    const created = await api<ClientSummary>(alice, 'POST', '/v1/clients', { name: `Master ${stamp}` });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.paymentTerms, 'Net 30 days');
    assert.equal(created.body.creditLimit, '0.00');
    assert.equal(created.body.creditStatus, 'approved');
    assert.equal(created.body.accountManagerName, null);
    clientId = created.body.id;
  });

  it('persists KvK, sector, address, ERP ID, credit and account manager', async () => {
    const patch = await api<ClientSummary>(alice, 'PATCH', `/v1/clients/${clientId}`, {
      kvkNumber: '12345678',
      sector: 'Consumer electronics',
      address: 'Stationsplein 1',
      erpId: `ERP-${stamp}`,
      paymentTerms: 'Net 14 days',
      creditLimit: 75000,
      creditStatus: 'review_required',
      accountManagerId: managerId,
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    assert.equal(patch.body.creditLimit, '75000.00');
    assert.equal(patch.body.accountManagerId, managerId);
    assert.ok(patch.body.accountManagerName);
    const list = await api<ClientSummary[]>(alice, 'GET', '/v1/clients');
    const row = list.body.find((c) => c.id === clientId);
    assert.equal(row?.erpId, `ERP-${stamp}`);
    assert.equal(row?.kvkNumber, '12345678');
    assert.equal(row?.creditStatus, 'review_required');
  });

  it('rejects invalid credit data, unknown account managers and duplicate ERP IDs', async () => {
    assert.equal((await api(alice, 'PATCH', `/v1/clients/${clientId}`, { creditLimit: -1 })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/v1/clients/${clientId}`, { creditStatus: 'maybe' })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/v1/clients/${clientId}`, { accountManagerId: '00000000-0000-4000-8000-000000000000' })).status, 400);
    const other = await api<ClientSummary>(alice, 'POST', '/v1/clients', { name: `Other ${stamp}` });
    assert.equal((await api(alice, 'PATCH', `/v1/clients/${other.body.id}`, { erpId: `ERP-${stamp}` })).status, 409);
  });

  it('finds clients by ERP ID and KvK number', async () => {
    const byErp = await api<{ id: string }[]>(alice, 'GET', `/search?q=ERP-${stamp}`);
    assert.ok(byErp.body.some((h) => h.id === clientId));
    const byKvk = await api<{ id: string }[]>(alice, 'GET', '/search?q=12345678');
    assert.ok(byKvk.body.some((h) => h.id === clientId));
  });
});

describe('store-to-client link', () => {
  it('links a store to a client and shows it in the client record', async () => {
    const store = await api<{ id: string; clientId: string | null }>(alice, 'POST', '/stores', { storeCode: `CL-${stamp}`, name: `Linked store ${stamp}`, clientId });
    assert.equal(store.status, 201, JSON.stringify(store.body));
    assert.equal(store.body.clientId, clientId);
    const record = await api<{ stores: { id: string }[] }>(alice, 'GET', `/v1/clients/${clientId}`);
    assert.ok(record.body.stores.some((s) => s.id === store.body.id));
    const unlinked = await api<{ clientId: string | null }>(alice, 'PATCH', `/stores/${store.body.id}`, { clientId: null });
    assert.equal(unlinked.body.clientId, null);
  });

  it('rejects clients of another organisation or unknown clients', async () => {
    const res = await api(alice, 'POST', '/stores', { storeCode: `CLX-${stamp}`, name: 'X', clientId: '00000000-0000-4000-8000-000000000000' });
    assert.equal(res.status, 400);
  });
});

describe('user title and zone', () => {
  it('lets admins set a job title and zone, shown in pickers and the profile', async () => {
    const colleagues = await api<UserSummary[]>(devAdmin, 'GET', '/users');
    const target = colleagues.body[0].id;
    const set = await api<{ title: string; zone: string }>(devAdmin, 'PATCH', `/users/${target}/profile`, { title: 'Key account manager', zone: 'Benelux' });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.zone, 'Benelux');
    const users = await api<UserSummary[]>(devAdmin, 'GET', '/users');
    assert.equal(users.body.find((u) => u.id === target)?.title, 'Key account manager');
    assert.equal((await api(devAdmin, 'PATCH', `/users/${target}/profile`, {})).status, 400);
    assert.equal((await api(alice, 'PATCH', `/users/${target}/profile`, { title: 'x' })).status, 403);
  });
});
