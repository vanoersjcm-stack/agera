/**
 * Golden Thread across the suites on real records: a store visit with out-of-stock products opens a
 * replenishment client room, the client signs the agreement, approval activates it, and the prognosis
 * moves at once. Then every record the Golden Thread tour visits is opened.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken, tierLock } from './helpers.ts';

const C2 = 'c1e00000-0000-4000-8000-000000000002';
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(300, 1)]).toString('base64');
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);
const year = new Date().getFullYear();

interface Waterfall { expansion: string; prognosis: string }

let alice: string;
let dave: string;
let storeId: string;
let visitId: string;
let roomId: string;
let dealId: string;
let agreementId: string;
let orderId: string;

before(async () => {
  [alice, dave] = await Promise.all([getToken('alice', 'alice'), getToken('dave', 'dave')]);
});

/** Activation can briefly hit an organisation-wide credit lock set by a parallel test; that is retried. */
async function activate(id: string): Promise<number> {
  for (let i = 0; ; i++) {
    const r = await api<{ message?: string }>(alice, 'PATCH', `/v1/agreements/${id}/status`, { status: 'active' });
    if (r.status !== 409 || !/Credit lock/.test(r.body.message ?? '') || i >= 40) return r.status;
    await new Promise((res) => setTimeout(res, 250));
  }
}

describe('Golden Thread (store → client room → signature → prognosis)', () => {
  it('opens a replenishment client room for the client when a visit reports out-of-stock products', async () => {
    const store = await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `GT-${stamp}`, name: `Golden ${stamp}`, clientId: C2 });
    assert.equal(store.status, 201, JSON.stringify(store.body));
    storeId = store.body.id;
    const visit = await api<{ id: string }>(alice, 'POST', '/visits', { storeId, visitDate: new Date().toISOString() });
    assert.equal(visit.status, 201, JSON.stringify(visit.body));
    visitId = visit.body.id;

    const saved = await api<{ replenishmentRoomId: string | null }>(alice, 'POST', `/visits/${visitId}/report`, {
      summary: 'Empty facings', auditData: { complianceStatus: 'not_compliant', outOfStockItems: ['Cola Zero 1.5L', 'Sparkling water'] },
    });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.ok(saved.body.replenishmentRoomId, 'a replenishment room is created');
    roomId = saved.body.replenishmentRoomId;

    const room = await api<{ roomName: string; clientId: string }>(alice, 'GET', `/v1/dsrs/${roomId}`);
    assert.equal(room.body.roomName, `Replenishment: Golden ${stamp} - ${today}`);
    assert.equal(room.body.clientId, C2);
    const steps = await api<{ title: string; ownerSide: string }[]>(dave, 'GET', `/v1/nexus/client-rooms/${roomId}/milestones`);
    assert.equal(steps.status, 200, 'the client sees the replenishment steps');
    assert.equal(steps.body.length, 2);
  });

  it('activates the client-signed agreement on approval and the prognosis reflects it immediately', async (t) => {
    const deal = await api<{ id: string }>(alice, 'POST', '/v1/deals', { clientId: C2, title: `Golden deal ${stamp}`, value: '7500' });
    assert.equal(deal.status, 201, JSON.stringify(deal.body));
    dealId = deal.body.id;
    const agreement = await api<{ id: string; status: string }>(alice, 'POST', '/v1/agreements', {
      clientId: C2, title: `Golden agreement ${stamp}`, documentUrl: 'https://docs.example.eu/golden.pdf', annualValue: 7500,
    });
    assert.equal(agreement.status, 201, JSON.stringify(agreement.body));
    agreementId = agreement.body.id;

    const signed = await api<{ contentSha256: string }>(dave, 'POST', `/v1/agreements/${agreementId}/signatures`, { signerName: 'Dave Client', signatureImage: PNG });
    assert.equal(signed.status, 201, JSON.stringify(signed.body));
    assert.match(signed.body.contentSha256, /^[0-9a-f]{64}$/);
    assert.notEqual((await api<{ status: string }>(alice, 'GET', `/v1/agreements/${agreementId}`)).body.status, 'active', 'a signature alone does not activate');

    t.after(await tierLock('waterfall'));
    const before = (await api<Waterfall>(alice, 'GET', `/v1/financials/waterfall?fiscalYear=${year}`)).body;
    assert.equal(await activate(agreementId), 200);
    const after = await api<Waterfall>(alice, 'GET', `/v1/financials/waterfall?fiscalYear=${year}`);
    assert.equal(after.status, 200, JSON.stringify(after.body));
    assert.equal(Math.round((Number(after.body.expansion) - Number(before.expansion)) * 100) / 100, 7500);
    assert.equal(Math.round((Number(after.body.prognosis) - Number(before.prognosis)) * 100) / 100, 7500);
  });

  it('takes a field order in the same store', async () => {
    const product = await api<{ id: string }>(alice, 'POST', '/v1/field/products', { sku: `GT-${stamp}`, name: 'Cola Zero 1.5L', unitPrice: 1.25 });
    assert.equal(product.status, 201, JSON.stringify(product.body));
    const order = await api<{ id: string; clientId: string | null }>(alice, 'POST', '/v1/field/orders', { storeId, lines: [{ productId: product.body.id, quantity: 12 }] });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    assert.equal(order.body.clientId, C2);
    orderId = order.body.id;
  });

  it('opens every record the Golden Thread tour visits without errors', async () => {
    const lists = ['/v1/clients', '/v1/deals', '/v1/dsrs', '/v1/agreements', '/visits?limit=100', '/v1/field/orders', '/v1/invoices', '/v1/clients-health'];
    for (const path of lists) assert.equal((await api(alice, 'GET', path)).status, 200, path);
    const records = [`/v1/clients/${C2}`, `/v1/deals/${dealId}`, `/v1/dsrs/${roomId}`, `/v1/agreements/${agreementId}`, `/visits/${visitId}/summary`, `/v1/field/orders/${orderId}`];
    for (const path of records) assert.equal((await api(alice, 'GET', path)).status, 200, path);
    const dossier = await api<{ agreements: { id: string }[]; rooms: { id: string }[] }>(alice, 'GET', `/v1/clients/${C2}`);
    assert.ok(dossier.body.agreements.some((a) => a.id === agreementId), 'the agreement is on the client dossier');
    assert.ok(dossier.body.rooms.some((r) => r.id === roomId), 'the replenishment room is on the client dossier');
    const health = await api<{ clientId: string }[]>(alice, 'GET', '/v1/clients-health');
    assert.ok(health.body.some((h) => h.clientId === C2), 'the client has a health score');
  });
});
