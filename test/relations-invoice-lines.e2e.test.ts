/** Third parties: e-mail, operational categories and role visibility; invoices with several product lines and their own VAT rate. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Relation { id: string; name: string; entityCategory: string; email: string | null }
interface Invoice { id: string; amountExclVat: string; vatAmount: string; vatRate: string | null; totalAmount: string }
interface Line { description: string; quantity: string; vatRate: string | null; productId: string | null; lineTotal: string }

const stamp = Date.now();
let hannah: string;
let alice: string;
let adam: string;
let lawyer: Relation;
let doctor: Relation;
let client: Relation;

before(async () => {
  [hannah, adam, alice] = await Promise.all([getToken('hannah', 'hannah'), getToken('adam', 'adam'), getToken('alice', 'alice')]);
  const create = async (name: string, entityCategory: string, email?: string) => {
    const r = await api<Relation>(hannah, 'POST', '/v1/clients', { name: `${name} ${stamp}`, entityCategory, email });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  lawyer = await create('Advocaat', 'lawyer', `Legal-${stamp}@Example.com`);
  doctor = await create('Huisarts', 'doctor');
  client = await create('Lines client', 'client');
});

describe('third parties', () => {
  it('stores the e-mail address in lower case and refuses an invalid one', async () => {
    assert.equal(lawyer.email, `legal-${stamp}@example.com`);
    assert.equal((await api(hannah, 'POST', '/v1/clients', { name: `Bad ${stamp}`, entityCategory: 'catering', email: 'not-an-address' })).status, 400);
  });

  it('shows general relations to HQ admins only; clients and operational ones to everyone internal', async () => {
    const hq = (await api<Relation[]>(hannah, 'GET', '/v1/clients')).body.map((c) => c.id);
    assert.ok([lawyer.id, doctor.id, client.id].every((id) => hq.includes(id)));
    const manager = (await api<Relation[]>(adam, 'GET', '/v1/clients')).body.map((c) => c.id);
    assert.ok(manager.includes(doctor.id) && manager.includes(client.id));
    assert.ok(!manager.includes(lawyer.id));
    assert.equal((await api(adam, 'GET', `/v1/clients/${lawyer.id}`)).status, 404);
    assert.equal((await api(adam, 'PATCH', `/v1/clients/${lawyer.id}`, { phone: '+31 20 000 0000' })).status, 404);
    assert.equal((await api(adam, 'POST', '/v1/clients', { name: `Notaris ${stamp}`, entityCategory: 'notary' })).status, 403);
    assert.equal((await api(adam, 'PATCH', `/v1/clients/${doctor.id}`, { entityCategory: 'bank' })).status, 403);
    const hits = (await api<{ id: string }[]>(adam, 'GET', `/search?q=${encodeURIComponent(String(stamp))}`)).body;
    assert.ok(Array.isArray(hits) && !hits.some((h) => h.id === lawyer.id), 'search hides the relation too');
  });
});

describe('invoice with several lines', () => {
  it('takes products, quantities and a VAT rate per line', async () => {
    const product = (await api<{ id: string; name: string }>(alice, 'POST', '/v1/field/products', { sku: `INV-${stamp}`, name: `Display unit ${stamp}`, unitPrice: '40.00' })).body;
    const r = await api<Invoice>(hannah, 'POST', '/v1/invoices/generate', {
      clientId: client.id, issueDate: '2026-11-17', vatRate: '21',
      lines: [
        { sourceType: 'manual', productId: product.id, quantity: '3', unitPrice: '40.00' },
        { sourceType: 'manual', description: 'Brochures', quantity: '2', unitPrice: '25.00', vatRate: '9' },
        { sourceType: 'manual', description: 'Export service', unitPrice: '100.00', vatRate: '0' },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.amountExclVat, '270.00');
    assert.equal(r.body.vatAmount, '29.70');
    assert.equal(r.body.totalAmount, '299.70');
    assert.equal(r.body.vatRate, null, 'mixed rates: no single invoice rate');
    const lines = (await api<Line[]>(hannah, 'GET', `/v1/invoices/${r.body.id}/lines`)).body;
    assert.deepEqual(lines.map((l) => [l.description, Number(l.quantity), Number(l.vatRate), l.productId]), [
      [product.name, 3, 21, product.id], ['Brochures', 2, 9, null], ['Export service', 1, 0, null],
    ]);
  });

  it('refuses a product of another kind of line or with a bad VAT rate', async () => {
    const bad = (line: Record<string, unknown>) => api(hannah, 'POST', '/v1/invoices/generate', { clientId: client.id, issueDate: '2026-11-17', vatRate: '21', lines: [line] });
    assert.equal((await bad({ sourceType: 'manual', description: 'x', unitPrice: '1', vatRate: '120' })).status, 400);
    assert.equal((await bad({ sourceType: 'manual', productId: '00000000-0000-4000-8000-000000000000', unitPrice: '1' })).status, 400);
  });
});
