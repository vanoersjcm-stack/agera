/**
 * B10/B11: global search across stores, work orders, agreements and client rooms, and the
 * internal user list for pickers. Tenant A: Agera Dev (dev.admin). Tenant B: Acme Test (alice, bob, carol).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { type ApiResponse, api, getToken, setupUsers, type TestUser } from './helpers.ts';

interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface SearchHit {
  entityType: string;
  id: string;
  title: string;
  subtitle: string;
  route: string;
}

function expectStatus<T>(response: ApiResponse<T>, status: number): T {
  assert.equal(response.status, status, JSON.stringify(response.body));
  return response.body;
}

let tenantA: TestUser;
let alice: TestUser;
let carolToken: string;

before(async () => {
  ({ tenantA, alice } = await setupUsers());
  carolToken = await getToken('carol', 'carol');
  // Provision carol (External_Client) in Acme Test so the user list has an external user to exclude.
  await api(carolToken, 'GET', '/users/me');
});

describe('GET /users', () => {
  it('lists active internal users of the active tenant with name, email and role', async () => {
    const users = expectStatus(await api<UserSummary[]>(tenantA.token, 'GET', '/users'), 200);
    const me = users.find((u) => u.id === tenantA.profile.id);
    assert.ok(me, 'dev.admin is listed');
    assert.equal(me.email, 'dev.admin@agera.local');
    assert.ok(me.name.length > 0);
    assert.ok(['platform-admin', 'admin', 'user'].includes(me.role));
    assert.deepEqual(Object.keys(me).sort(), ['email', 'id', 'name', 'role']);
  });

  it('is tenant-isolated and excludes client users', async () => {
    const users = expectStatus(await api<UserSummary[]>(alice.token, 'GET', '/users'), 200);
    assert.ok(users.some((u) => u.id === alice.profile.id));
    assert.ok(!users.some((u) => u.id === tenantA.profile.id), 'no users from another tenant');
    assert.ok(!users.some((u) => u.email === 'carol@retailer.example'), 'External_Client users are not listed');
  });

  it('is not available to client users', async () => {
    expectStatus(await api(carolToken, 'GET', '/users'), 403);
  });
});

describe('GET /search', () => {
  const tag = randomUUID().slice(0, 8);
  let storeId: string;
  let workOrderId: string;

  before(async () => {
    storeId = expectStatus(
      await api<{ id: string }>(tenantA.token, 'POST', '/stores', { storeCode: `S-${tag}`, name: `Searchable ${tag} Store`, city: 'Utrecht' }),
      201,
    ).id;
    workOrderId = expectStatus(await api<{ id: string }>(tenantA.token, 'POST', '/work-orders', { title: `Shelf reset ${tag}` }), 201).id;
  });

  it('finds stores and work orders by name, code and title with a route to open them', async () => {
    const hits = expectStatus(await api<SearchHit[]>(tenantA.token, 'GET', `/search?q=${tag.toUpperCase()}`), 200);
    const store = hits.find((h) => h.id === storeId);
    const workOrder = hits.find((h) => h.id === workOrderId);
    assert.deepEqual(store, {
      entityType: 'store',
      id: storeId,
      title: `Searchable ${tag} Store`,
      subtitle: `Store · S-${tag} · Utrecht`,
      route: `/retailpower/stores/${storeId}`,
    });
    assert.equal(workOrder?.entityType, 'work_order');
    assert.equal(workOrder?.route, `/retailpower/work-orders/${workOrderId}`);
    assert.equal(workOrder?.subtitle, 'Work order · Pending');
  });

  it('finds agreements and client rooms', async () => {
    const clientId = randomUUID();
    const agreement = expectStatus(
      await api<{ id: string }>(tenantA.token, 'POST', '/v1/agreements', {
        clientId,
        title: `Framework ${tag}`,
        documentUrl: `https://docs.agera.example/${tag}.pdf`,
      }),
      201,
    );
    const room = expectStatus(
      await api<{ id: string }>(tenantA.token, 'POST', '/v1/dsrs', { clientId, roomName: `Launch ${tag}`, agreementId: agreement.id }),
      201,
    );
    const hits = expectStatus(await api<SearchHit[]>(tenantA.token, 'GET', `/search?q=${tag}`), 200);
    assert.equal(hits.find((h) => h.id === agreement.id)?.route, `/nexus/agreements/${agreement.id}`);
    assert.equal(hits.find((h) => h.id === room.id)?.route, `/nexus/client-rooms/${room.id}`);
  });

  it('never returns records of another tenant', async () => {
    const hits = expectStatus(await api<SearchHit[]>(alice.token, 'GET', `/search?q=${tag}`), 200);
    assert.deepEqual(hits, []);
  });

  it('treats LIKE wildcards literally', async () => {
    const hits = expectStatus(await api<SearchHit[]>(tenantA.token, 'GET', `/search?q=${encodeURIComponent('%_')}`), 200);
    assert.deepEqual(hits, []);
  });

  it('validates the query and limit', async () => {
    expectStatus(await api(tenantA.token, 'GET', '/search?q=a'), 400);
    expectStatus(await api(tenantA.token, 'GET', '/search'), 400);
    expectStatus(await api(tenantA.token, 'GET', `/search?q=${tag}&limit=0`), 400);
    const limited = expectStatus(await api<SearchHit[]>(tenantA.token, 'GET', `/search?q=${tag}&limit=1`), 200);
    assert.ok(limited.filter((h) => h.entityType === 'store').length <= 1);
  });

  it('is not available to client users', async () => {
    expectStatus(await api(carolToken, 'GET', `/search?q=${tag}`), 403);
  });
});
