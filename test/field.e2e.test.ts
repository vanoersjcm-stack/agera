/** Wave 2 (audit G35/G37/G40/B9): product catalogue, planograms with a compliance score, field orders and audit rounds. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Product { id: string; sku: string; unitPrice: string; active: boolean }
interface Order { id: string; status: string; total: string; lines: { productId: string; quantity: number; unitPrice: string }[] }
interface Round { id: string; status: string; visits: { id: string; storeId: string; status: string }[] }

let alice: string;
let carol: string;
let storeId: string;
let p1: Product;
let p2: Product;
let orderId: string;
const stamp = Date.now();

before(async () => {
  [alice, carol] = await Promise.all([getToken('alice', 'alice'), getToken('carol', 'carol')]);
  const store = await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `F${stamp}`.slice(0, 20), name: `Field store ${stamp}` });
  assert.equal(store.status, 201, JSON.stringify(store.body));
  storeId = store.body.id;
});

describe('/v1/field/products', () => {
  it('creates products with unique SKUs and edits them', async () => {
    const a = await api<Product>(alice, 'POST', '/v1/field/products', { sku: `COLA-${stamp}`, name: 'Cola Zero 1.5L', brand: 'Fizz', category: 'Soft drinks', unitPrice: 1.25 });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.unitPrice, '1.25');
    p1 = a.body;
    p2 = (await api<Product>(alice, 'POST', '/v1/field/products', { sku: `CHIPS-${stamp}`, name: 'Chips Paprika', unitPrice: '2.10' })).body;
    assert.equal((await api(alice, 'POST', '/v1/field/products', { sku: `cola-${stamp}`, name: 'Dup' })).status, 409);
    assert.equal((await api(alice, 'POST', '/v1/field/products', { sku: 'X', name: 'Neg', unitPrice: -1 })).status, 400);
    const edited = await api<Product>(alice, 'PATCH', `/v1/field/products/${p2.id}`, { unitPrice: 2.2 });
    assert.equal(edited.body.unitPrice, '2.20');
    assert.ok((await api<Product[]>(alice, 'GET', '/v1/field/products')).body.some((p) => p.id === p1.id));
    assert.equal((await api(carol, 'GET', '/v1/field/products')).status, 403);
  });
});

describe('planograms and the visit report score', () => {
  it('creates a store planogram and offers it in the visit context', async () => {
    const g = await api<{ id: string; items: unknown[] }>(alice, 'POST', '/v1/field/planograms', {
      name: `Drinks shelf ${stamp}`,
      storeId,
      items: [{ productId: p1.id, expectedFacings: 4, shelf: 'Eye level' }, { productId: p2.id, expectedFacings: 2 }],
    });
    assert.equal(g.status, 201, JSON.stringify(g.body));
    assert.equal(g.body.items.length, 2);
    const visit = await api<{ id: string }>(alice, 'POST', '/visits', { storeId, visitDate: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(visit.status, 201, JSON.stringify(visit.body));
    const ctx = await api<{ planograms: { id: string }[]; auditRound: unknown }>(alice, 'GET', `/v1/field/visits/${visit.body.id}/context`);
    assert.ok(ctx.body.planograms.some((p) => p.id === g.body.id));
    assert.equal(ctx.body.auditRound, null);
    assert.equal((await api(alice, 'PATCH', `/visits/${visit.body.id}/status`, { status: 'IN_PROGRESS' })).status, 200);
    const report = await api<{ auditData: { planogramScore: number } }>(alice, 'POST', `/visits/${visit.body.id}/report`, {
      summary: 'ok',
      auditData: { complianceStatus: 'compliant', planogramChecks: [{ productId: p1.id, expectedFacings: 4, actualFacings: 3 }, { productId: p2.id, expectedFacings: 2, actualFacings: 5 }] },
    });
    assert.ok(report.status === 200 || report.status === 201, JSON.stringify(report.body));
    assert.equal(report.body.auditData.planogramScore, 83);
    assert.equal((await api(alice, 'POST', `/visits/${visit.body.id}/report`, { auditData: { planogramChecks: [{ productId: p1.id, expectedFacings: 0, actualFacings: 1 }] } })).status, 400);
  });
});

describe('/v1/field/orders', () => {
  it('creates a draft order with catalogue prices and a total', async () => {
    const o = await api<Order>(alice, 'POST', '/v1/field/orders', { storeId, lines: [{ productId: p1.id, quantity: 10 }, { productId: p2.id, quantity: 3 }] });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    assert.equal(o.body.status, 'draft');
    assert.equal(o.body.total, '19.10');
    orderId = o.body.id;
    assert.equal((await api(alice, 'POST', '/v1/field/orders', { storeId, lines: [{ productId: p1.id, quantity: 1 }, { productId: p1.id, quantity: 2 }] })).status, 400);
  });

  it('follows the status flow and locks lines after submitting', async () => {
    const changed = await api<Order>(alice, 'PATCH', `/v1/field/orders/${orderId}`, { lines: [{ productId: p1.id, quantity: 4 }] });
    assert.equal(changed.body.total, '5.00');
    assert.equal((await api<Order>(alice, 'PATCH', `/v1/field/orders/${orderId}/status`, { status: 'submitted' })).body.status, 'submitted');
    assert.equal((await api(alice, 'PATCH', `/v1/field/orders/${orderId}`, { notes: 'late' })).status, 409);
    assert.equal((await api(alice, 'PATCH', `/v1/field/orders/${orderId}/status`, { status: 'delivered' })).status, 409);
    assert.equal((await api<Order>(alice, 'PATCH', `/v1/field/orders/${orderId}/status`, { status: 'confirmed' })).body.status, 'confirmed');
    const list = await api<Order[]>(alice, 'GET', '/v1/field/orders?status=confirmed');
    assert.ok(list.body.some((o) => o.id === orderId));
  });
});

describe('/v1/field/audit-rounds', () => {
  it('plans one visit per store and tracks progress', async () => {
    const r = await api<Round>(alice, 'POST', '/v1/field/audit-rounds', {
      name: `Q4 shelf audit ${stamp}`,
      checklist: ['Price tags correct', 'Promo display in place'],
      dueDate: '2026-12-15',
      visitDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      storeIds: [storeId],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.visits.length, 1);
    const ctx = await api<{ auditRound: { checklist: string[] } }>(alice, 'GET', `/v1/field/visits/${r.body.visits[0].id}/context`);
    assert.deepEqual(ctx.body.auditRound.checklist, ['Price tags correct', 'Promo display in place']);
    const list = await api<{ id: string; visitCount: number; completedCount: number }[]>(alice, 'GET', '/v1/field/audit-rounds');
    const mine = list.body.find((x) => x.id === r.body.id)!;
    assert.equal(mine.visitCount, 1);
    assert.equal(mine.completedCount, 0);
    assert.equal((await api<Round>(alice, 'PATCH', `/v1/field/audit-rounds/${r.body.id}/status`, { status: 'closed' })).body.status, 'closed');
    assert.equal((await api(alice, 'POST', '/v1/field/audit-rounds', { name: 'x', visitDate: new Date().toISOString(), storeIds: [] })).status, 400);
  });
});
