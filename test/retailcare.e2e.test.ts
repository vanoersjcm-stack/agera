import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { ACME_TEST, AGERA_DEV, api, nextMillisecond, setupUsers, type TestUser } from './helpers.ts';

interface Store {
  id: string;
  tenantId: string;
  storeCode: string;
  name: string;
  country: string | null;
}

interface Visit {
  id: string;
  tenantId: string;
  storeId: string;
  fieldRepId: string;
  workOrderId: string | null;
  visitDate: string;
  status: string;
  updatedAt: string;
}

interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}

const run = randomUUID().slice(0, 8);
const visitDate = '2026-11-02T09:30:00.000Z';
let tenantA: TestUser;
let alice: TestUser;
let bob: TestUser;

async function createStore(user: TestUser, storeCode: string, extra: Record<string, unknown> = {}): Promise<Store> {
  const { status, body } = await api<Store>(user.token, 'POST', '/stores', { storeCode, name: `Store ${storeCode}`, ...extra });
  assert.equal(status, 201);
  return body;
}

async function createVisit(user: TestUser, body: Record<string, unknown>): Promise<Visit> {
  const result = await api<Visit>(user.token, 'POST', '/visits', { visitDate, ...body });
  assert.equal(result.status, 201);
  return result.body;
}

async function listAll<T>(user: TestUser, path: string, query = ''): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const { status, body } = await api<Page<T>>(user.token, 'GET', `${path}?limit=100&page=${page}${query ? `&${query}` : ''}`);
    assert.equal(status, 200);
    items.push(...body.items);
    if (page * body.limit >= body.total) {
      return items;
    }
  }
}

before(async () => {
  ({ tenantA, alice, bob } = await setupUsers());
});

describe('authentication', () => {
  it('rejects unauthenticated requests with 401', async () => {
    assert.equal((await api(null, 'GET', '/stores')).status, 401);
    assert.equal((await api(null, 'POST', '/stores', { storeCode: 'x', name: 'x' })).status, 401);
    assert.equal((await api(null, 'GET', '/visits')).status, 401);
    assert.equal((await api(null, 'POST', '/visits', {})).status, 401);
  });
});

describe('stores', () => {
  it('creates stores in the caller tenant with country defaulting to ES', async () => {
    const store = await createStore(alice, `S-${run}`, { address: 'Calle Mayor 1', city: 'Madrid', postalCode: '28013' });
    assert.equal(store.tenantId, ACME_TEST);
    assert.equal(store.country, 'ES');
    const pt = await createStore(alice, `PT-${run}`, { country: 'PT' });
    assert.equal(pt.country, 'PT');
  });

  it('keeps store codes unique per tenant only', async () => {
    const code = `DUP-${run}`;
    await createStore(alice, code);
    assert.equal((await api(bob.token, 'POST', '/stores', { storeCode: code, name: 'again' })).status, 409);
    const tenantAStore = await createStore(tenantA, code);
    assert.equal(tenantAStore.tenantId, AGERA_DEV);
  });

  it('hides stores of other tenants', async () => {
    const tenantBStore = await createStore(alice, `ISO-B-${run}`);
    const tenantAStore = await createStore(tenantA, `ISO-A-${run}`);

    const seenByA = await listAll<Store>(tenantA, '/stores');
    assert.ok(seenByA.every((s) => s.tenantId === AGERA_DEV));
    assert.ok(seenByA.some((s) => s.id === tenantAStore.id));
    assert.ok(!seenByA.some((s) => s.id === tenantBStore.id));

    const seenByB = await listAll<Store>(bob, '/stores');
    assert.ok(seenByB.every((s) => s.tenantId === ACME_TEST));
    assert.ok(seenByB.some((s) => s.id === tenantBStore.id));
    assert.ok(!seenByB.some((s) => s.id === tenantAStore.id));
  });

  it('validates input', async () => {
    assert.equal((await api(alice.token, 'POST', '/stores', { name: 'no code' })).status, 400);
    assert.equal((await api(alice.token, 'POST', '/stores', { storeCode: 'x'.repeat(51), name: 'x' })).status, 400);
    assert.equal((await api(alice.token, 'POST', '/stores', { storeCode: 'x', name: 'x', postalCode: 123 })).status, 400);
  });
});

describe('visits', () => {
  it('plans a visit defaulting the field rep to the caller', async () => {
    const store = await createStore(alice, `V-${run}`);
    const { body: workOrder } = await api<{ id: string }>(alice.token, 'POST', '/work-orders', { title: `visit wo ${run}` });

    const visit = await createVisit(alice, { storeId: store.id, workOrderId: workOrder.id, notes: 'Planogram check' });
    assert.equal(visit.tenantId, ACME_TEST);
    assert.equal(visit.status, 'PLANNED');
    assert.equal(visit.fieldRepId, alice.profile.id);
    assert.equal(visit.workOrderId, workOrder.id);
    assert.equal(visit.visitDate, visitDate);

    const forBob = await createVisit(alice, { storeId: store.id, fieldRepId: bob.profile.id });
    assert.equal(forBob.fieldRepId, bob.profile.id);
  });

  it('rejects references to another tenant’s store, user or work order', async () => {
    const tenantBStore = await createStore(alice, `XREF-B-${run}`);
    const tenantAStore = await createStore(tenantA, `XREF-A-${run}`);
    const { body: tenantAWorkOrder } = await api<{ id: string }>(tenantA.token, 'POST', '/work-orders', { title: `xref ${run}` });

    assert.equal((await api(alice.token, 'POST', '/visits', { visitDate, storeId: tenantAStore.id })).status, 400);
    assert.equal((await api(tenantA.token, 'POST', '/visits', { visitDate, storeId: tenantBStore.id })).status, 400);
    assert.equal(
      (await api(alice.token, 'POST', '/visits', { visitDate, storeId: tenantBStore.id, fieldRepId: tenantA.profile.id })).status,
      400,
    );
    assert.equal(
      (await api(alice.token, 'POST', '/visits', { visitDate, storeId: tenantBStore.id, workOrderId: tenantAWorkOrder.id })).status,
      400,
    );
  });

  it('hides visits of other tenants, also when filtering by their store', async () => {
    const tenantBStore = await createStore(alice, `VISO-B-${run}`);
    const tenantBVisit = await createVisit(alice, { storeId: tenantBStore.id });
    const tenantAStore = await createStore(tenantA, `VISO-A-${run}`);
    const tenantAVisit = await createVisit(tenantA, { storeId: tenantAStore.id });

    const seenByA = await listAll<Visit>(tenantA, '/visits');
    assert.ok(seenByA.every((v) => v.tenantId === AGERA_DEV));
    assert.ok(seenByA.some((v) => v.id === tenantAVisit.id));
    assert.ok(!seenByA.some((v) => v.id === tenantBVisit.id));
    assert.deepEqual(await listAll<Visit>(tenantA, '/visits', `storeId=${tenantBStore.id}`), []);

    const seenByB = await listAll<Visit>(bob, '/visits');
    assert.ok(seenByB.every((v) => v.tenantId === ACME_TEST));
    assert.ok(seenByB.some((v) => v.id === tenantBVisit.id));
    assert.ok(!seenByB.some((v) => v.id === tenantAVisit.id));

    assert.equal((await api(tenantA.token, 'PATCH', `/visits/${tenantBVisit.id}/status`, { status: 'CANCELLED' })).status, 404);
  });

  it('filters by storeId', async () => {
    const first = await createStore(alice, `F1-${run}`);
    const second = await createStore(alice, `F2-${run}`);
    const a = await createVisit(alice, { storeId: first.id });
    const b = await createVisit(bob, { storeId: second.id });

    const forFirst = await listAll<Visit>(bob, '/visits', `storeId=${first.id}`);
    assert.deepEqual(forFirst.map((v) => v.id), [a.id]);
    const forSecond = await listAll<Visit>(alice, '/visits', `storeId=${second.id}`);
    assert.deepEqual(forSecond.map((v) => v.id), [b.id]);
  });

  it('returns delta updates with updatedSince', async () => {
    const store = await createStore(alice, `D-${run}`);
    const first = await createVisit(alice, { storeId: store.id });
    await nextMillisecond();
    const second = await createVisit(alice, { storeId: store.id });
    await nextMillisecond();

    const sinceFirst = await listAll<Visit>(alice, '/visits', `updatedSince=${encodeURIComponent(first.updatedAt)}`);
    assert.ok(sinceFirst.every((v) => v.updatedAt > first.updatedAt));
    assert.ok(sinceFirst.some((v) => v.id === second.id));
    assert.ok(!sinceFirst.some((v) => v.id === first.id));

    const started = await api<Visit>(bob.token, 'PATCH', `/visits/${first.id}/status`, { status: 'IN_PROGRESS' });
    assert.equal(started.status, 200);
    const sinceSecond = await listAll<Visit>(alice, '/visits', `storeId=${store.id}&updatedSince=${encodeURIComponent(second.updatedAt)}`);
    assert.deepEqual(
      sinceSecond.map((v) => [v.id, v.status]),
      [[first.id, 'IN_PROGRESS']],
    );

    const sinceLatest = await listAll<Visit>(alice, '/visits', `updatedSince=${encodeURIComponent(started.body.updatedAt)}`);
    assert.ok(!sinceLatest.some((v) => v.id === first.id || v.id === second.id));
  });

  it('enforces status transitions and validates input', async () => {
    const store = await createStore(alice, `T-${run}`);
    const visit = await createVisit(alice, { storeId: store.id });
    assert.equal((await api(alice.token, 'PATCH', `/visits/${visit.id}/status`, { status: 'DONE' })).status, 400);
    assert.equal((await api(alice.token, 'PATCH', `/visits/${visit.id}/status`, { status: 'COMPLETED' })).status, 200);
    assert.equal((await api(alice.token, 'PATCH', `/visits/${visit.id}/status`, { status: 'PLANNED' })).status, 409);

    assert.equal((await api(alice.token, 'POST', '/visits', { storeId: store.id })).status, 400);
    assert.equal((await api(alice.token, 'POST', '/visits', { storeId: 'nope', visitDate })).status, 400);
    assert.equal((await api(alice.token, 'POST', '/visits', { storeId: randomUUID(), visitDate })).status, 400);
    assert.equal((await api(alice.token, 'GET', '/visits?storeId=nope')).status, 400);
    assert.equal((await api(alice.token, 'GET', '/visits?updatedSince=yesterday')).status, 400);
  });
});
