import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import {
  ACME_TEST,
  AGERA_DEV,
  api,
  apiWithKey,
  downloadWithKey,
  nextMillisecond,
  send,
  setupUsers,
  type TestUser,
  upload,
} from './helpers.ts';

interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  key?: string;
}

interface Synced {
  id: string;
  tenantId: string;
  updatedAt: string;
}

interface Overview {
  workOrders: (Synced & { title: string })[];
  visits: (Synced & { storeId: string })[];
  reports: (Synced & { visitId: string; summary: string | null })[];
  hasMore: boolean;
  nextUpdatedSince: string | null;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const run = randomUUID().slice(0, 8);
let admin: TestUser;
let alice: TestUser;
let bob: TestUser;
let acmeKey: string;
let acmeKeyId: string;
let ageraKey: string;

async function createKey(body: Record<string, unknown>): Promise<ApiKey & { key: string }> {
  const { status, body: created } = await api<ApiKey & { key: string }>(admin.token, 'POST', '/api-keys', body);
  assert.equal(status, 201, JSON.stringify(created));
  return created;
}

async function overview(apiKey: string, query = ''): Promise<Overview> {
  const { status, body } = await apiWithKey<Overview>(apiKey, 'GET', `/portal/sync/overview${query}`);
  assert.equal(status, 200, JSON.stringify(body));
  return body;
}

before(async () => {
  ({ tenantA: admin, alice, bob } = await setupUsers());
  const acme = await createKey({ name: `Acme portal ${run}`, tenantId: ACME_TEST });
  acmeKey = acme.key;
  acmeKeyId = acme.id;
  ageraKey = (await createKey({ name: `Agera portal ${run}` })).key;
});

describe('API key management', () => {
  it('lets platform admins create keys; the secret is returned once and never listed', async () => {
    const created = await createKey({ name: `Listed ${run}`, tenantId: ACME_TEST, expiresAt: '2099-01-01T00:00:00Z' });
    assert.equal(created.tenantId, ACME_TEST);
    assert.match(created.key, /^agk_[A-Za-z0-9_-]{43}$/);
    assert.equal(created.keyPrefix, created.key.slice(0, 12));
    assert.equal(created.expiresAt, '2099-01-01T00:00:00.000Z');

    const defaulted = await createKey({ name: `Own tenant ${run}` });
    assert.equal(defaulted.tenantId, AGERA_DEV);

    const list = await api<{ items: ApiKey[]; total: number }>(
      admin.token,
      'GET',
      `/api-keys?limit=100&tenantId=${ACME_TEST}`,
    );
    assert.equal(list.status, 200);
    const listed = list.body.items.find((k) => k.id === created.id);
    assert.ok(listed);
    assert.equal(listed.key, undefined);
    assert.ok(list.body.items.every((k) => k.tenantId === ACME_TEST));
    assert.ok(!JSON.stringify(list.body).includes(created.key));
  });

  it('rejects non-admins (403) and invalid input (400)', async () => {
    assert.equal((await api(alice.token, 'POST', '/api-keys', { name: 'x', tenantId: ACME_TEST })).status, 403);
    assert.equal((await api(alice.token, 'GET', '/api-keys')).status, 403);
    assert.equal((await send(alice.token, 'DELETE', `/api-keys/${acmeKeyId}`)).status, 403);
    for (const body of [
      {},
      { name: '' },
      { name: 'x'.repeat(101) },
      { name: 'x', tenantId: 'nope' },
      { name: 'x', tenantId: randomUUID() },
      { name: 'x', expiresAt: '2020-01-01T00:00:00Z' },
      { name: 'x', expiresAt: 'tomorrow' },
    ]) {
      assert.equal((await api(admin.token, 'POST', '/api-keys', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await send(admin.token, 'DELETE', `/api-keys/${randomUUID()}`)).status, 404);
  });

  it('stops accepting a key once revoked or expired', async () => {
    const revoked = await createKey({ name: `Revoked ${run}`, tenantId: ACME_TEST });
    assert.equal((await apiWithKey(revoked.key, 'GET', '/portal/sync/overview')).status, 200);
    assert.equal((await send(admin.token, 'DELETE', `/api-keys/${revoked.id}`)).status, 204);
    assert.equal((await apiWithKey(revoked.key, 'GET', '/portal/sync/overview')).status, 401);

    const expiring = await createKey({
      name: `Expiring ${run}`,
      tenantId: ACME_TEST,
      expiresAt: new Date(Date.now() + 1500).toISOString(),
    });
    assert.equal((await apiWithKey(expiring.key, 'GET', '/portal/sync/overview')).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    assert.equal((await apiWithKey(expiring.key, 'GET', '/portal/sync/overview')).status, 401);
  });
});

describe('X-API-Key authentication', () => {
  it('rejects missing, unknown and malformed keys with 401', async () => {
    assert.equal((await api(null, 'GET', '/portal/sync/overview')).status, 401);
    assert.equal((await apiWithKey(`agk_${'A'.repeat(43)}`, 'GET', '/portal/sync/overview')).status, 401);
    assert.equal((await apiWithKey('not-a-key', 'GET', '/portal/sync/overview')).status, 401);
    assert.equal((await apiWithKey(acmeKey.slice(0, -1), 'GET', '/portal/sync/overview')).status, 401);
  });

  it('resolves the tenant of the key', async () => {
    const acme = await apiWithKey<{ id: string; resolvedBy: string }>(acmeKey, 'GET', '/tenants/me');
    assert.equal(acme.status, 200);
    assert.deepEqual([acme.body.id, acme.body.resolvedBy], [ACME_TEST, 'apiKey']);
    assert.equal((await apiWithKey<{ id: string }>(ageraKey, 'GET', '/tenants/me')).body.id, AGERA_DEV);
  });

  it('is read-only: writes, profile and admin endpoints return 403', async () => {
    const forbidden: [string, string, unknown?][] = [
      ['POST', '/work-orders', { title: 'via key' }],
      ['POST', '/stores', { storeCode: 'K', name: 'K' }],
      ['POST', `/visits/${randomUUID()}/report`, { summary: 'x' }],
      ['DELETE', `/visits/${randomUUID()}/media/${randomUUID()}`],
      ['GET', '/users/me'],
      ['GET', '/audit-logs'],
      ['GET', '/api-keys'],
      ['POST', '/api-keys', { name: 'escalate' }],
    ];
    for (const [method, path, body] of forbidden) {
      assert.equal((await apiWithKey(acmeKey, method, path, body)).status, 403, `${method} ${path}`);
    }
  });

  it('reads work orders, visits, stores, summaries and photos of its own tenant only', async () => {
    const workOrder = await api<Synced>(alice.token, 'POST', '/work-orders', { title: `Key read ${run}` });
    const store = await api<{ id: string }>(alice.token, 'POST', '/stores', { storeCode: `K-${run}`, name: 'Key store' });
    const visit = await api<Synced>(alice.token, 'POST', '/visits', {
      storeId: store.body.id,
      visitDate: '2026-11-04T09:00:00Z',
    });
    const media = await upload<{ id: string; url: string }>(alice.token, `/visits/${visit.body.id}/media`, {
      data: PNG,
      type: 'image/png',
      filename: 'p.png',
    });

    assert.equal((await apiWithKey(acmeKey, 'GET', `/work-orders/${workOrder.body.id}`)).status, 200);
    assert.equal((await apiWithKey(acmeKey, 'GET', `/work-orders/${workOrder.body.id}/logs`)).status, 200);
    const stores = await apiWithKey<{ items: { id: string }[] }>(acmeKey, 'GET', '/stores?limit=100');
    assert.equal(stores.status, 200);
    const visits = await apiWithKey<{ items: Synced[] }>(acmeKey, 'GET', `/visits?storeId=${store.body.id}`);
    assert.deepEqual(visits.body.items.map((v) => v.id), [visit.body.id]);
    assert.equal((await apiWithKey(acmeKey, 'GET', `/visits/${visit.body.id}/summary`)).status, 200);
    const photo = await downloadWithKey(acmeKey, media.body.url);
    assert.equal(photo.status, 200);
    assert.ok(photo.data.equals(PNG));

    assert.equal((await apiWithKey(ageraKey, 'GET', `/work-orders/${workOrder.body.id}`)).status, 404);
    assert.equal((await apiWithKey(ageraKey, 'GET', `/visits/${visit.body.id}/summary`)).status, 404);
    assert.equal((await downloadWithKey(ageraKey, media.body.url)).status, 404);
    const ageraVisits = await apiWithKey<{ total: number }>(ageraKey, 'GET', `/visits?storeId=${store.body.id}`);
    assert.equal(ageraVisits.body.total, 0);
  });
});

describe('GET /portal/sync/overview', () => {
  it('returns work orders, visits and reports changed after updatedSince, scoped to the tenant', async () => {
    const baseline = (await overview(acmeKey, `?updatedSince=${encodeURIComponent(new Date(Date.now() - 1000).toISOString())}`))
      .nextUpdatedSince;
    assert.ok(baseline);
    await nextMillisecond();

    const workOrder = await api<Synced>(bob.token, 'POST', '/work-orders', { title: `Sync ${run}` });
    const store = await api<{ id: string }>(bob.token, 'POST', '/stores', { storeCode: `S-${run}`, name: 'Sync store' });
    const visit = await api<Synced>(bob.token, 'POST', '/visits', { storeId: store.body.id, visitDate: '2026-11-05T09:00:00Z' });
    const report = await api<Synced>(bob.token, 'POST', `/visits/${visit.body.id}/report`, { summary: 'Synced report' });
    const otherTenant = await api<Synced>(admin.token, 'POST', '/work-orders', { title: `Other tenant ${run}` });

    const delta = await overview(acmeKey, `?updatedSince=${encodeURIComponent(baseline)}`);
    assert.ok(delta.workOrders.some((w) => w.id === workOrder.body.id));
    assert.ok(delta.visits.some((v) => v.id === visit.body.id));
    assert.ok(delta.reports.some((r) => r.id === report.body.id && r.summary === 'Synced report'));
    assert.ok(!delta.workOrders.some((w) => w.id === otherTenant.body.id));
    for (const item of [...delta.workOrders, ...delta.visits, ...delta.reports]) {
      assert.equal(item.tenantId, ACME_TEST);
      assert.ok(item.updatedAt > baseline);
    }
    assert.equal(delta.hasMore, false);
    assert.ok(delta.nextUpdatedSince && delta.nextUpdatedSince >= report.body.updatedAt);

    const quiet = await overview(acmeKey, `?updatedSince=${encodeURIComponent(delta.nextUpdatedSince)}`);
    assert.deepEqual([quiet.workOrders, quiet.visits, quiet.reports], [[], [], []]);
    assert.equal(quiet.nextUpdatedSince, delta.nextUpdatedSince);

    const viaJwt = await api<Overview>(admin.token, 'GET', `/portal/sync/overview?updatedSince=${encodeURIComponent(baseline)}`);
    assert.equal(viaJwt.status, 200);
    assert.ok(viaJwt.body.workOrders.some((w) => w.id === otherTenant.body.id));
    assert.ok(viaJwt.body.workOrders.every((w) => w.tenantId === AGERA_DEV));
  });

  it('pages with limit and nextUpdatedSince without losing changes', async () => {
    const since = new Date(Date.now() - 1).toISOString();
    const created = new Set<string>();
    for (let i = 0; i < 5; i++) {
      created.add((await api<Synced>(alice.token, 'POST', '/work-orders', { title: `Page ${run} ${i}` })).body.id);
      await nextMillisecond();
    }

    const seen = new Set<string>();
    let cursor = since;
    let pages = 0;
    for (;;) {
      const page = await overview(acmeKey, `?limit=2&updatedSince=${encodeURIComponent(cursor)}`);
      pages++;
      assert.ok(page.workOrders.length <= 2);
      page.workOrders.forEach((w) => seen.add(w.id));
      assert.ok(page.nextUpdatedSince);
      cursor = page.nextUpdatedSince;
      if (!page.hasMore) {
        break;
      }
      assert.ok(pages < 20, 'pagination does not terminate');
    }
    assert.ok(pages >= 3);
    for (const id of created) {
      assert.ok(seen.has(id), `work order ${id} missing from the paged feed`);
    }
  });

  it('validates updatedSince and limit', async () => {
    assert.equal((await apiWithKey(acmeKey, 'GET', '/portal/sync/overview?updatedSince=yesterday')).status, 400);
    assert.equal((await apiWithKey(acmeKey, 'GET', '/portal/sync/overview?limit=0')).status, 400);
    assert.equal((await apiWithKey(acmeKey, 'GET', '/portal/sync/overview?limit=501')).status, 400);
    const full = await overview(acmeKey, '?limit=500');
    assert.ok(full.workOrders.length > 0);
  });
});
