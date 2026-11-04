/** Slice 3 (audit §13 G19/G23/G24): invoices, agreement run-rate fields and the financial waterfall. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Invoice { id: string; clientId: string; clientName: string; invoiceNumber: string; status: string; totalAmount: string; paidAt: string | null; overdue: boolean }
interface Waterfall { fiscalYear: number; baseline: string; expansion: string; churn: string; prognosis: string; actuals: string; openPipeline: string }
interface Agreement { id: string; annualValue: string; churnRisk: string | null; endDate: string | null }

const C1 = 'c1e00000-0000-4000-8000-000000000001';
const year = new Date().getFullYear();
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let alice: string;
let carol: string;
let devAdmin: string;
let clientId: string;
let invoiceId: string;
const stamp = Date.now();

before(async () => {
  [alice, carol, devAdmin] = await Promise.all([getToken('alice', 'alice'), getToken('carol', 'carol'), getToken('dev.admin', 'devadmin')]);
  clientId = (await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Invoiced ${stamp}` })).body.id;
});

describe('/v1/invoices', () => {
  it('records a draft invoice with totals', async () => {
    const created = await api<Invoice>(alice, 'POST', '/v1/invoices', {
      clientId, invoiceNumber: `INV-${stamp}`, issueDate: `${year}-01-15`, dueDate: `${year}-02-14`, amountExclVat: 1000, vatAmount: '210',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, 'draft');
    assert.equal(created.body.totalAmount, '1210.00');
    assert.equal(created.body.clientName, `Invoiced ${stamp}`);
    invoiceId = created.body.id;
  });

  it('rejects duplicate numbers, bad dates and bad amounts', async () => {
    const base = { clientId, issueDate: `${year}-01-15`, amountExclVat: 10 };
    assert.equal((await api(alice, 'POST', '/v1/invoices', { ...base, invoiceNumber: `INV-${stamp}` })).status, 409);
    assert.equal((await api(alice, 'POST', '/v1/invoices', { ...base, invoiceNumber: `X-${stamp}`, dueDate: `${year - 1}-01-01` })).status, 400);
    assert.equal((await api(alice, 'POST', '/v1/invoices', { ...base, invoiceNumber: `Y-${stamp}`, amountExclVat: -1 })).status, 400);
    assert.equal((await api(alice, 'POST', '/v1/invoices', { ...base, invoiceNumber: `Z-${stamp}`, clientId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  });

  it('follows draft → issued → paid and locks edits after drafting', async () => {
    assert.equal((await api(alice, 'PATCH', `/v1/invoices/${invoiceId}/status`, { status: 'paid' })).status, 409);
    assert.equal((await api<Invoice>(alice, 'PATCH', `/v1/invoices/${invoiceId}/status`, { status: 'issued' })).body.status, 'issued');
    assert.equal((await api(alice, 'PATCH', `/v1/invoices/${invoiceId}`, { description: 'late edit' })).status, 409);
    const paid = await api<Invoice>(alice, 'PATCH', `/v1/invoices/${invoiceId}/status`, { status: 'paid' });
    assert.equal(paid.body.status, 'paid');
    assert.ok(paid.body.paidAt);
    assert.equal((await api(alice, 'PATCH', `/v1/invoices/${invoiceId}/status`, { status: 'cancelled' })).status, 409);
  });

  it('lists invoices per client and hides them from clients and other organisations', async () => {
    const list = await api<Invoice[]>(alice, 'GET', `/v1/clients/${clientId}/invoices`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map((i) => i.id), [invoiceId]);
    assert.equal((await api(carol, 'GET', '/v1/invoices')).status, 403);
    assert.equal((await api(devAdmin, 'GET', `/v1/invoices/${invoiceId}`)).status, 404);
  });
});

describe('agreement run-rate fields', () => {
  it('stores annual value, churn risk and end date, and hides churn risk from client contacts', async () => {
    const created = await api<Agreement>(alice, 'POST', '/v1/agreements', {
      clientId: C1, title: `Run-rate ${stamp}`, documentUrl: 'https://docs.example/a.pdf', annualValue: 5000, churnRisk: 1500, endDate: inDays(30),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.annualValue, '5000.00');
    assert.equal(created.body.churnRisk, '1500.00');
    assert.equal(created.body.endDate, inDays(30));
    const seen = await api<Agreement>(carol, 'GET', `/v1/agreements/${created.body.id}`);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.churnRisk, null);
    assert.equal((await api(alice, 'PATCH', `/v1/agreements/${created.body.id}`, { churnRisk: 9000 })).status, 400);
    assert.equal((await api(alice, 'POST', '/v1/agreements', { clientId: C1, title: 'x', documentUrl: 'https://d.example', annualValue: 1, churnRisk: 2 })).status, 400);
  });
});

describe('/v1/financials/waterfall', () => {
  it('adds signed expansion, subtracts near-term churn and reports paid invoices', async () => {
    const before = (await api<Waterfall>(alice, 'GET', `/v1/financials/waterfall?fiscalYear=${year}`)).body;
    const agreement = await api<Agreement & { id: string }>(alice, 'POST', '/v1/agreements', {
      clientId: C1, title: `Waterfall ${stamp}`, documentUrl: 'https://docs.example/w.pdf', annualValue: 10000, churnRisk: 4000, endDate: inDays(45),
    });
    await api(alice, 'PATCH', `/v1/agreements/${agreement.body.id}/status`, { status: 'active' });
    const later = await api<Agreement & { id: string }>(alice, 'POST', '/v1/agreements', {
      clientId: C1, title: `Far ${stamp}`, documentUrl: 'https://docs.example/f.pdf', annualValue: 2000, churnRisk: 2000, endDate: inDays(200),
    });
    await api(alice, 'PATCH', `/v1/agreements/${later.body.id}/status`, { status: 'active' });
    const inv = await api<Invoice>(alice, 'POST', '/v1/invoices', { clientId, invoiceNumber: `W-${stamp}`, issueDate: inDays(0), amountExclVat: 750, status: 'issued' });
    await api(alice, 'PATCH', `/v1/invoices/${inv.body.id}/status`, { status: 'paid' });

    const after = await api<Waterfall>(alice, 'GET', `/v1/financials/waterfall?fiscalYear=${year}`);
    assert.equal(after.status, 200, JSON.stringify(after.body));
    const d = (k: keyof Waterfall) => Math.round((Number(after.body[k]) - Number(before[k])) * 100) / 100;
    assert.equal(d('expansion'), 12000);
    assert.equal(d('churn'), 4000);
    assert.equal(d('actuals'), 750);
    assert.equal(d('prognosis'), 8000);
    assert.equal(Number(after.body.prognosis), Math.round((Number(after.body.baseline) + Number(after.body.expansion) - Number(after.body.churn)) * 100) / 100);
    assert.equal((await api(alice, 'GET', '/v1/financials/waterfall?fiscalYear=abc')).status, 400);
    assert.equal((await api(carol, 'GET', '/v1/financials/waterfall')).status, 403);
  });
});
