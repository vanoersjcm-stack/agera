/** Test 1a round 3: activity filter, read-only integrations, invite entity, automatic invoice numbers, invoice lines and approval. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Invoice { id: string; invoiceNumber: string; status: string; idmsStatus: string; amountExclVat: string; vatAmount: string; totalAmount: string }
interface Line { sourceType: string; sourceId: string | null; description: string; lineTotal: string }
interface Billable { agreements: { id: string }[]; visits: { id: string }[] }

const stamp = Date.now();
const year = new Date().getFullYear();
let alice: string;
let hannah: string;
let adam: string;
let aliceId: string;
let clientId: string;
let agreementId: string;
let visitId: string;

before(async () => {
  [alice, hannah, adam] = await Promise.all([getToken('alice', 'alice'), getToken('hannah', 'hannah'), getToken('adam', 'adam')]);
  aliceId = (await api<{ id: string }>(alice, 'GET', '/users/me')).body.id;
  clientId = (await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Round3 ${stamp}` })).body.id;
  agreementId = (await api<{ id: string }>(alice, 'POST', '/v1/agreements', { clientId, title: `Service ${stamp}`, documentUrl: 'https://docs.example.com/s.pdf' })).body.id;
  assert.equal((await api(alice, 'PATCH', `/v1/agreements/${agreementId}/status`, { status: 'active' })).status, 200);
  const store = (await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `R3-${stamp}`, name: `Round3 store ${stamp}`, clientId })).body;
  const order = (await api<{ id: string }>(alice, 'POST', '/work-orders', { title: `Round3 ${stamp}` })).body;
  visitId = (await api<{ id: string }>(alice, 'POST', '/visits', { storeId: store.id, workOrderId: order.id, visitDate: '2026-11-02T09:30:00Z' })).body.id;
  assert.equal((await api(alice, 'PATCH', `/visits/${visitId}/status`, { status: 'IN_PROGRESS' })).status, 200);
  assert.equal((await api(alice, 'PATCH', `/visits/${visitId}/status`, { status: 'COMPLETED' })).status, 200);
});

describe('activity log filter', () => {
  it('shows only the signed-in person with mine=true', async () => {
    const r = await api<{ items?: { userId: string | null }[]; data?: { userId: string | null }[] }>(alice, 'GET', '/audit-logs?page=1&limit=50&mine=true');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rows = r.body.items ?? r.body.data ?? [];
    assert.ok(rows.length > 0);
    assert.ok(rows.every((x) => x.userId === aliceId));
  });
});

describe('integrations', () => {
  it('lets account managers read keys with their party, but not create them', async () => {
    const list = await api<{ partyName: string | null }[]>(adam, 'GET', '/api-keys');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal((await api(adam, 'POST', '/api-keys', { name: 'x', partyName: 'Albert Heijn' })).status, 403);
  });
});

describe('invite a person', () => {
  it('is refused for account managers and checks the entity', async () => {
    const body = { email: `r3-${stamp}@example.com`, firstName: 'R', lastName: 'Three', role: 'ACCOUNT_MANAGER' };
    assert.equal((await api(adam, 'POST', '/users', body)).status, 403);
    assert.equal((await api(hannah, 'POST', '/users', { ...body, entityId: clientId })).status, 400);
  });
});

describe('invoices: numbers, lines and approval', () => {
  let invoice: Invoice;

  it('numbers manual invoices without a number automatically', async () => {
    const r = await api<Invoice>(alice, 'POST', '/v1/invoices', { clientId, issueDate: `${year}-03-01`, amountExclVat: 10 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.invoiceNumber, new RegExp(`^INV-${year}-\\d{4,}$`));
  });

  it('offers approved agreements and completed visits, and generates lines with totals', async () => {
    const billable = await api<Billable>(alice, 'GET', `/v1/clients/${clientId}/billable`);
    assert.deepEqual(billable.body.agreements.map((a) => a.id), [agreementId]);
    assert.deepEqual(billable.body.visits.map((v) => v.id), [visitId]);
    const r = await api<Invoice>(alice, 'POST', '/v1/invoices/generate', {
      clientId, issueDate: `${year}-03-02`, vatRate: '21',
      lines: [
        { sourceType: 'agreement', sourceId: agreementId, unitPrice: '1000.00' },
        { sourceType: 'store_visit', sourceId: visitId, unitPrice: '250.50' },
        { sourceType: 'manual', description: 'Extra shelf service', quantity: '2', unitPrice: '10' },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    invoice = r.body;
    assert.match(invoice.invoiceNumber, new RegExp(`^INV-${year}-\\d{4,}$`));
    assert.equal(invoice.amountExclVat, '1270.50');
    assert.equal(invoice.vatAmount, '266.81');
    assert.equal(invoice.totalAmount, '1537.31');
    assert.equal(invoice.idmsStatus, 'DRAFT');
    const lines = (await api<Line[]>(alice, 'GET', `/v1/invoices/${invoice.id}/lines`)).body;
    assert.deepEqual(lines.map((l) => [l.sourceType, l.sourceId]), [['agreement', agreementId], ['store_visit', visitId], ['manual', null]]);
    assert.equal((await api<Billable>(alice, 'GET', `/v1/clients/${clientId}/billable`)).body.visits.length, 0, 'a billed visit is not offered again');
    const again = await api(alice, 'POST', '/v1/invoices/generate', { clientId, issueDate: `${year}-03-02`, vatRate: '21', lines: [{ sourceType: 'store_visit', sourceId: visitId, unitPrice: '1' }] });
    assert.equal(again.status, 409);
  });

  it('goes DRAFT → IN_REVIEW → back to DRAFT on rejection → FINAL_LOCKED on approval', async () => {
    const req = await api<{ id: string }>(alice, 'POST', '/v1/approvals', { entityType: 'invoice', entityId: invoice.id, approverIds: [aliceId] });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    assert.equal((await api<Invoice>(alice, 'GET', `/v1/invoices/${invoice.id}`)).body.idmsStatus, 'IN_REVIEW');
    assert.equal((await api(alice, 'PATCH', `/v1/invoices/${invoice.id}/status`, { status: 'issued' })).status, 409, 'waits for the approval');
    assert.equal((await api(alice, 'POST', `/v1/approvals/${req.body.id}/decision`, { decision: 'rejected', comment: 'Wrong price' })).status < 300, true);
    assert.equal((await api<Invoice>(alice, 'GET', `/v1/invoices/${invoice.id}`)).body.idmsStatus, 'DRAFT');
    const req2 = await api<{ id: string }>(alice, 'POST', '/v1/approvals', { entityType: 'invoice', entityId: invoice.id, approverIds: [aliceId] });
    assert.equal((await api(alice, 'POST', `/v1/approvals/${req2.body.id}/decision`, { decision: 'approved' })).status < 300, true);
    const done = (await api<Invoice>(alice, 'GET', `/v1/invoices/${invoice.id}`)).body;
    assert.equal(done.status, 'issued');
    assert.equal(done.idmsStatus, 'FINAL_LOCKED');
    assert.equal((await api(alice, 'PATCH', `/v1/invoices/${invoice.id}`, { description: 'late' })).status, 403);
  });
});
