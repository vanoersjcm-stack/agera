/** Test 1a rounds 4 and 5: campaign rounds, rackjobbing checklists, procurement & PO matching, P&L scoping, plan-line category, exception owners, scan notification. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { API_URL, api, getToken } from './helpers.ts';

const stamp = Date.now();
let alice: string, adam: string, hannah: string, fiona: string, victor: string;
let aliceId: string, fionaId: string, adamId: string, hannahId: string;
let storeIds: string[];
let clientId: string;

interface Round { id: string; roundType: string; merchandiserIds: string[]; requirements: { vehicles: number; posMaterials: string | null; apparel: string | null }; visits: { id: string; fieldRepName: string | null }[] }
interface Po { id: string; poNumber: string; status: string; total: string; billableTotal: string; includedTotal: string; variance: string | null; lines: { category: string; billing: string; lineTotal: string }[] }

before(async () => {
  [alice, adam, hannah, fiona, victor] = await Promise.all(['alice', 'adam', 'hannah', 'fiona', 'victor'].map((u) => getToken(u, u)));
  [aliceId, fionaId, adamId, hannahId] = await Promise.all([alice, fiona, adam, hannah].map(async (tk) => (await api<{ id: string }>(tk, 'GET', '/users/me')).body.id));
  storeIds = [];
  for (const [i, region] of ['Randstad', 'Randstad', 'Noord'].entries()) {
    const s = await api<{ id: string; region: string | null }>(alice, 'POST', '/stores', { storeCode: `R45-${stamp}-${i}`.slice(0, 50), name: `Round45 store ${i}`, country: 'Netherlands', region });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.region, region);
    storeIds.push(s.body.id);
  }
  const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Round45 client ${stamp}` });
  assert.equal(client.status, 201, JSON.stringify(client.body));
  clientId = client.body.id;
});

describe('campaign rounds', () => {
  it('lets an HQ admin plan one date across stores and share the visits among merchandisers, with resource needs', async () => {
    const r = await api<Round>(hannah, 'POST', '/v1/field/campaign-rounds', {
      name: `Spring campaign ${stamp}`, visitDate: '2026-12-01T09:00:00.000Z', storeIds, merchandiserIds: [aliceId, fionaId],
      checklist: ['Display built'], requirements: { vehicles: 2, posMaterials: '40 shelf wobblers', apparel: '4 polos size M' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.roundType, 'campaign');
    assert.equal(r.body.visits.length, 3);
    assert.deepEqual([...r.body.merchandiserIds].sort(), [aliceId, fionaId].sort());
    assert.equal(r.body.requirements.vehicles, 2);
    assert.equal(new Set(r.body.visits.map((v) => v.fieldRepName)).size, 2, 'visits are shared out among both merchandisers');
    const list = await api<{ id: string; roundType: string }[]>(hannah, 'GET', '/v1/field/audit-rounds');
    assert.equal(list.body.find((x) => x.id === r.body.id)?.roundType, 'campaign');
  });

  it('refuses field representatives, client viewers and account managers (403) and validates input (400)', async () => {
    const body = { name: 'x', visitDate: '2026-12-01T09:00:00.000Z', storeIds, merchandiserIds: [fionaId] };
    for (const tk of [fiona, victor, adam]) assert.equal((await api(tk, 'POST', '/v1/field/campaign-rounds', body)).status, 403);
    assert.equal((await api(hannah, 'POST', '/v1/field/campaign-rounds', { ...body, merchandiserIds: [] })).status, 400);
    assert.equal((await api(hannah, 'POST', '/v1/field/campaign-rounds', { ...body, requirements: { vehicles: -1 } })).status, 400);
  });
});

describe('rackjobbing checklists', () => {
  it('coordinators plan pick-up/drop-off, rotation and price protection; the field rep records the result', async () => {
    const created = await api<{ id: string; status: string; rotationRule: string; priceProtectionEligible: boolean }>(hannah, 'POST', '/v1/operations/rackjobbing', {
      storeId: storeIds[0], pickupQty: 6, dropoffQty: 24, rotationRule: 'expiry_check', priceProtectionEligible: true, instructions: 'Move short-dated stock to the front',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.rotationRule, 'expiry_check');
    assert.equal(created.body.priceProtectionEligible, true);
    assert.equal((await api(fiona, 'POST', '/v1/operations/rackjobbing', { storeId: storeIds[0] })).status, 403);
    assert.equal((await api(hannah, 'POST', '/v1/operations/rackjobbing', { storeId: storeIds[0], rotationRule: 'lifo' })).status, 400);
    const done = await api<{ status: string; actualDropoffQty: number; rotationDone: boolean }>(fiona, 'POST', `/v1/operations/rackjobbing/${created.body.id}/complete`, { actualPickupQty: 6, actualDropoffQty: 22, rotationDone: true });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.status, 'done');
    assert.equal(done.body.actualDropoffQty, 22);
    assert.equal((await api(fiona, 'POST', `/v1/operations/rackjobbing/${created.body.id}/complete`, {})).status, 409);
    assert.equal((await api(victor, 'GET', '/v1/operations/rackjobbing')).status, 403);
  });
});

describe('procurement & purchase orders', () => {
  let po: Po;
  it('creates a PO with billable (apparel, POS) and included (car rental) lines', async () => {
    const r = await api<Po>(hannah, 'POST', '/v1/operations/purchase-orders', {
      supplierName: 'Sixt Benelux', clientId, lines: [
        { category: 'car_rental', description: 'Van, 3 days', quantity: 3, unitPrice: '85.00' },
        { category: 'apparel', description: 'Campaign polos', quantity: 4, unitPrice: '12.50' },
        { category: 'pos_material', description: 'Shelf wobblers', quantity: 40, unitPrice: '1.10' },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    po = r.body;
    assert.match(po.poNumber, /^PO-\d{4}-\d{4}$/);
    assert.equal(po.total, '349.00');
    assert.equal(po.includedTotal, '255.00');
    assert.equal(po.billableTotal, '94.00');
    assert.deepEqual(po.lines.map((l) => l.billing), ['included', 'client', 'client']);
  });

  it('matches a supplier invoice: a different amount is disputed, the exact total is matched', async () => {
    const off = await api<Po>(hannah, 'POST', `/v1/operations/purchase-orders/${po.id}/match`, { invoiceNumber: 'SX-1001', amount: '360.00' });
    assert.equal(off.status, 201, JSON.stringify(off.body));
    assert.equal(off.body.status, 'disputed');
    assert.equal(off.body.variance, '11.00');
    const ok = await api<Po>(hannah, 'POST', `/v1/operations/purchase-orders/${po.id}/match`, { invoiceNumber: 'SX-1001', amount: '349.00', invoiceDate: '2026-11-20' });
    assert.equal(ok.body.status, 'matched');
    assert.equal((await api(hannah, 'POST', `/v1/operations/purchase-orders/${po.id}/match`, { invoiceNumber: 'SX-1002', amount: '349.00' })).status, 409);
    assert.equal((await api(hannah, 'POST', `/v1/operations/purchase-orders/${po.id}/cancel`)).status, 409);
  });

  it('account managers read only; field representatives and client viewers get 403', async () => {
    assert.equal((await api(adam, 'GET', '/v1/operations/purchase-orders')).status, 200);
    assert.equal((await api(adam, 'POST', '/v1/operations/purchase-orders', { supplierName: 'x', lines: [{ category: 'apparel', description: 'x', unitPrice: 1 }] })).status, 403);
    assert.equal((await api(adam, 'POST', `/v1/operations/purchase-orders/${po.id}/match`, { invoiceNumber: 'x', amount: 1 })).status, 403);
    for (const tk of [fiona, victor]) assert.equal((await api(tk, 'GET', '/v1/operations/purchase-orders')).status, 403);
    assert.equal((await api(hannah, 'POST', '/v1/operations/purchase-orders', { supplierName: 'No client', lines: [{ category: 'apparel', description: 'Polos', unitPrice: 5 }] })).status, 400, 'billable lines need a client');
  });
});

describe('Profit & loss scoping and plan-line category', () => {
  it('P&L is for HQ admins and account managers only', async () => {
    assert.equal((await api(hannah, 'GET', '/v1/financials/pnl')).status, 200);
    assert.equal((await api(adam, 'GET', '/v1/financials/pnl')).status, 200);
    assert.equal((await api(fiona, 'GET', '/v1/financials/pnl')).status, 403);
    assert.equal((await api(victor, 'GET', '/v1/financials/pnl')).status, 403);
  });

  it('plan lines carry existing-contract baseline vs. new-business category', async () => {
    const model = await api<{ id: string }>(adam, 'POST', '/v1/financials/models', { modelName: `R45 plan ${stamp}`, fiscalYear: 2026 });
    assert.equal(model.status, 201, JSON.stringify(model.body));
    const base = await api<{ id: string; lineCategory: string }>(adam, 'POST', `/v1/financials/models/${model.body.id}/line-items`, { category: 'revenue', periodCode: '2026-Q1', projectedAmount: '1000.00' });
    assert.equal(base.status, 201, JSON.stringify(base.body));
    assert.equal(base.body.lineCategory, 'existing_contract');
    const growth = await api<{ id: string; lineCategory: string }>(adam, 'POST', `/v1/financials/models/${model.body.id}/line-items`, { category: 'revenue', lineCategory: 'new_business', periodCode: '2026-Q2', projectedAmount: '500.00' });
    assert.equal(growth.body.lineCategory, 'new_business');
    const moved = await api<{ lineCategory: string }>(adam, 'PATCH', `/v1/financials/line-items/${base.body.id}`, { lineCategory: 'new_business' });
    assert.equal(moved.body.lineCategory, 'new_business');
    assert.equal((await api(adam, 'POST', `/v1/financials/models/${model.body.id}/line-items`, { category: 'revenue', lineCategory: 'upsell', periodCode: '2026-Q1', projectedAmount: '1' })).status, 400);
  });
});

describe('exceptions with three responsible parties', () => {
  it('records client contact, account manager and executive, and checks the contact belongs to the client', async () => {
    const contact = await api<{ id: string }>(adam, 'POST', `/v1/clients/${clientId}/contacts`, { firstName: 'Eva', lastName: 'de Wit', email: `eva.${stamp}@example.com` });
    assert.equal(contact.status, 201, JSON.stringify(contact.body));
    const e = await api<{ id: string; clientContactId: string; clientContactName: string; ownerId: string; executiveId: string; executiveName: string }>(adam, 'POST', '/v1/exceptions', {
      title: `Shelf gap ${stamp}`, clientId, clientContactId: contact.body.id, ownerId: adamId, executiveId: hannahId,
    });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    assert.equal(e.body.clientContactId, contact.body.id);
    assert.equal(e.body.clientContactName, 'Eva de Wit');
    assert.equal(e.body.ownerId, adamId);
    assert.equal(e.body.executiveId, hannahId);
    const other = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Other ${stamp}` });
    assert.equal((await api(adam, 'POST', '/v1/exceptions', { title: 'Wrong contact', clientId: other.body.id, clientContactId: contact.body.id })).status, 400);
    const cleared = await api<{ executiveId: string | null }>(adam, 'PATCH', `/v1/exceptions/${e.body.id}`, { executiveId: null });
    assert.equal(cleared.body.executiveId, null);
  });
});

describe('scan-to-vault client notification', () => {
  it('stores the scan and reports the notification outcome without blocking on SMTP', async () => {
    const room = await api<{ id: string }>(alice, 'POST', '/v1/dsrs', { clientId, roomName: `R45 room ${stamp}` });
    assert.equal(room.status, 201, JSON.stringify(room.body));
    const form = new FormData();
    form.append('clientId', clientId);
    form.append('clientRoomId', room.body.id);
    form.append('notifyClients', 'true');
    form.append('file', new Blob([new Uint8Array(Buffer.from('%PDF-1.4\n%round45\n'))], { type: 'application/pdf' }), 'signed-form.pdf');
    const res = await fetch(`${API_URL}/v1/documents/scan-ingest`, { method: 'POST', headers: { Authorization: `Bearer ${adam}` }, body: form });
    const body = (await res.json()) as { idmsStatus: string; notification?: { requested: boolean; smtp: string; recipients: number; sent: number; failed: number } };
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.equal(body.idmsStatus, 'DRAFT');
    assert.ok(body.notification?.requested);
    assert.ok(['connected', 'not_connected'].includes(body.notification!.smtp));
    assert.ok(body.notification!.recipients >= 1);
    if (body.notification!.smtp === 'not_connected') assert.equal(body.notification!.sent, 0);
  });
});
