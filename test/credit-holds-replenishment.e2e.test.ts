/** Slice 4 (audit §13 G9/G37/G38): emergency credit locks and out-of-stock → replenishment client rooms. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Hold { id: string; clientId: string | null; active: boolean; releasedAt: string | null }

let devAdmin: string;
let alice: string;
const stamp = Date.now();
const openHolds: string[] = [];

before(async () => {
  [devAdmin, alice] = await Promise.all([getToken('dev.admin', 'devadmin'), getToken('alice', 'alice')]);
});

after(async () => {
  for (const id of openHolds) await api(devAdmin, 'DELETE', `/v1/governance/credit-holds/${id}`);
});

async function agreementFor(clientId: string): Promise<string> {
  const a = await api<{ id: string }>(devAdmin, 'POST', '/v1/agreements', { clientId, title: `Locked ${stamp}`, documentUrl: 'https://docs.example/l.pdf' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  return a.body.id;
}

describe('/v1/governance/credit-holds', () => {
  let clientId: string;

  before(async () => {
    clientId = (await api<{ id: string }>(devAdmin, 'POST', '/v1/clients', { name: `Credit ${stamp}` })).body.id;
  });

  it('blocks agreement activation for a locked client until the lock is released', async () => {
    const agreementId = await agreementFor(clientId);
    const hold = await api<Hold>(devAdmin, 'POST', '/v1/governance/credit-holds', { clientId, reason: 'Payment overdue' });
    assert.equal(hold.status, 201, JSON.stringify(hold.body));
    assert.equal(hold.body.active, true);
    openHolds.push(hold.body.id);
    const client = await api<{ client: { creditStatus: string } }>(devAdmin, 'GET', `/v1/clients/${clientId}`);
    assert.equal(client.body.client.creditStatus, 'locked');
    assert.equal((await api(devAdmin, 'POST', '/v1/governance/credit-holds', { clientId, reason: 'again' })).status, 409);

    const blocked = await api<{ message: string }>(devAdmin, 'PATCH', `/v1/agreements/${agreementId}/status`, { status: 'active' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.message, /Credit lock/);

    const released = await api<Hold>(devAdmin, 'DELETE', `/v1/governance/credit-holds/${hold.body.id}`);
    assert.equal(released.status, 200);
    assert.ok(released.body.releasedAt);
    openHolds.splice(openHolds.indexOf(hold.body.id), 1);
    assert.equal((await api(devAdmin, 'DELETE', `/v1/governance/credit-holds/${hold.body.id}`)).status, 409);
    assert.equal((await api(devAdmin, 'PATCH', `/v1/agreements/${agreementId}/status`, { status: 'active' })).status, 200);
  });

  it('supports an organisation-wide lock', async () => {
    const other = (await api<{ id: string }>(devAdmin, 'POST', '/v1/clients', { name: `Other credit ${stamp}` })).body.id;
    const agreementId = await agreementFor(other);
    const hold = await api<Hold>(devAdmin, 'POST', '/v1/governance/credit-holds', { reason: 'Liquidity freeze' });
    assert.equal(hold.status, 201, JSON.stringify(hold.body));
    assert.equal(hold.body.clientId, null);
    openHolds.push(hold.body.id);
    const list = await api<Hold[]>(devAdmin, 'GET', '/v1/governance/credit-holds');
    assert.ok(list.body.some((h) => h.id === hold.body.id));
    assert.equal((await api(devAdmin, 'PATCH', `/v1/agreements/${agreementId}/status`, { status: 'active' })).status, 409);
    await api(devAdmin, 'DELETE', `/v1/governance/credit-holds/${hold.body.id}`);
    openHolds.splice(openHolds.indexOf(hold.body.id), 1);
    assert.equal((await api(devAdmin, 'PATCH', `/v1/agreements/${agreementId}/status`, { status: 'active' })).status, 200);
  });

  it('only lets administrators set or release locks', async () => {
    assert.equal((await api(alice, 'GET', '/v1/governance/credit-holds')).status, 200);
    assert.equal((await api(alice, 'POST', '/v1/governance/credit-holds', { reason: 'x' })).status, 403);
    assert.equal((await api(devAdmin, 'POST', '/v1/governance/credit-holds', { reason: ' ' })).status, 400);
  });
});

describe('out-of-stock → replenishment client room', () => {
  let visitId: string;
  let clientId: string;

  before(async () => {
    clientId = (await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Brand ${stamp}` })).body.id;
    const store = await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `OOS-${stamp}`, name: `Shop ${stamp}`, clientId });
    assert.equal(store.status, 201, JSON.stringify(store.body));
    const visit = await api<{ id: string }>(alice, 'POST', '/visits', { storeId: store.body.id, visitDate: new Date().toISOString() });
    assert.equal(visit.status, 201, JSON.stringify(visit.body));
    visitId = visit.body.id;
  });

  it('opens one replenishment room per visit with a client step per product', async () => {
    const saved = await api<{ replenishmentRoomId: string | null }>(alice, 'POST', `/visits/${visitId}/report`, {
      summary: 'Gaps on shelf', auditData: { complianceStatus: 'not_compliant', outOfStockItems: ['Cola 1L', 'Chips', 'Cola 1L'] },
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    const roomId = saved.body.replenishmentRoomId;
    assert.ok(roomId);
    const room = await api<{ roomName: string; clientId: string }>(alice, 'GET', `/v1/dsrs/${roomId}`);
    assert.match(room.body.roomName, new RegExp(`^Replenishment: Shop ${stamp} - \\d{4}-\\d{2}-\\d{2}$`));
    assert.equal(room.body.clientId, clientId);
    const steps = await api<{ title: string; ownerSide: string }[]>(alice, 'GET', `/v1/nexus/client-rooms/${roomId}/milestones`);
    assert.equal(steps.body.length, 2);
    assert.ok(steps.body.every((s) => s.ownerSide === 'client'));

    const again = await api<{ replenishmentRoomId: string | null }>(alice, 'POST', `/visits/${visitId}/report`, {
      summary: 'Updated', auditData: { complianceStatus: 'not_compliant', outOfStockItems: ['Cola 1L', 'Water'] },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.replenishmentRoomId, roomId);
    assert.equal((await api<unknown[]>(alice, 'GET', `/v1/nexus/client-rooms/${roomId}/milestones`)).body.length, 3);
  });

  it('validates the product list and skips stores without a client', async () => {
    assert.equal((await api(alice, 'POST', `/visits/${visitId}/report`, { auditData: { outOfStockItems: 'Cola' } })).status, 400);
    assert.equal((await api(alice, 'POST', `/visits/${visitId}/report`, { auditData: { outOfStockItems: [''] } })).status, 400);
    const store = await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `NOC-${stamp}`, name: 'No client' });
    const visit = await api<{ id: string }>(alice, 'POST', '/visits', { storeId: store.body.id, visitDate: new Date().toISOString() });
    const saved = await api<{ replenishmentRoomId: string | null }>(alice, 'POST', `/visits/${visit.body.id}/report`, { auditData: { outOfStockItems: ['Cola'] } });
    assert.equal(saved.body.replenishmentRoomId ?? null, null);
  });
});
