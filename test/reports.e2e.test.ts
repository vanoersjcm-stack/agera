/** Wave 5 (audit G42/G43): KPI dashboard and CSV for every edition; custom report builder for Enterprise only. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { API_URL, api, getToken, tierLock } from './helpers.ts';

let admin: string;
let alice: string;
let carol: string;
let tenantId: string;
const BASE = API_URL;

before(async () => {
  [admin, alice, carol] = await Promise.all([getToken('dev.admin', 'devadmin'), getToken('alice', 'alice'), getToken('carol', 'carol')]);
  tenantId = (await api<{ id: string }>(alice, 'GET', '/tenants/me')).body.id;
});

after(async () => {
  const release = await tierLock(tenantId);
  try {
    await api(admin, 'PATCH', `/tenants/${tenantId}/license`, { licenseTier: 'symphony' });
  } finally {
    release();
  }
});

describe('/v1/reports', () => {
  it('serves KPIs, datasets and CSV exports, and the edition in /users/me', async () => {
    const kpis = await api<{ activeClients: number; tier: string; dealsByStage: unknown[] }>(alice, 'GET', '/v1/reports/kpis');
    assert.equal(kpis.status, 200);
    assert.equal(typeof kpis.body.activeClients, 'number');
    const ds = await api<{ key: string; columns: { key: string }[] }[]>(alice, 'GET', '/v1/reports/datasets');
    assert.ok(ds.body.some((d) => d.key === 'invoices'));
    const res = await fetch(`${BASE}/v1/reports/datasets/clients/export`, { headers: { Authorization: `Bearer ${alice}` } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/csv/);
    assert.match((await res.text()).split('\r\n')[0], /^Client,City,Sector/);
    assert.equal((await api(alice, 'GET', '/v1/reports/datasets/nope/export')).status, 404);
    const release = await tierLock(tenantId);
    try {
      assert.equal((await api<{ licenseTier: string }>(alice, 'GET', '/users/me')).body.licenseTier, 'symphony');
    } finally {
      release();
    }
    assert.equal((await api(carol, 'GET', '/v1/reports/kpis')).status, 403);
  });

  it('runs, groups, saves and pins custom reports on Symphony, and returns 402 on Vanguard', async () => {
    const def = { dataset: 'clients', columns: ['name', 'status'], filters: [{ column: 'status', op: 'equals', value: 'active' }], sort: { column: 'name', direction: 'asc' }, limit: 50 };
    const run = await api<{ columns: { key: string }[]; rows: { status: string }[] }>(alice, 'POST', '/v1/reports/run', def);
    assert.equal(run.status, 200, JSON.stringify(run.body));
    assert.deepEqual(run.body.columns.map((c) => c.key), ['name', 'status']);
    assert.ok(run.body.rows.every((r) => r.status === 'active'));
    const grouped = await api<{ rows: { status: string; value: string }[] }>(alice, 'POST', '/v1/reports/run', { dataset: 'clients', groupBy: 'status', aggregate: { fn: 'count' } });
    assert.equal(grouped.status, 200, JSON.stringify(grouped.body));
    assert.ok(grouped.body.rows.length >= 1);
    assert.equal((await api(alice, 'POST', '/v1/reports/run', { dataset: 'clients', columns: ['password'] })).status, 400);
    assert.equal((await api(alice, 'POST', '/v1/reports/run', { dataset: 'users', columns: ['email'] })).status, 400);
    const saved = await api<{ id: string; pinned: boolean }>(alice, 'POST', '/v1/reports/saved', { name: `Active clients ${Date.now()}`, definition: def, pinned: true });
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    assert.equal((await api<{ pinned: boolean }>(alice, 'PATCH', `/v1/reports/saved/${saved.body.id}`, { pinned: false })).body.pinned, false);
    const release = await tierLock(tenantId);
    try {
      await api(admin, 'PATCH', `/tenants/${tenantId}/license`, { licenseTier: 'vanguard' });
      const locked = await api<{ message: string }>(alice, 'POST', '/v1/reports/run', def);
      assert.equal(locked.status, 402);
      assert.match(locked.body.message, /Enterprise tier required/);
      assert.equal((await api(alice, 'GET', '/v1/reports/saved')).status, 402);
      assert.equal((await api(alice, 'GET', '/v1/reports/kpis')).status, 200);
      assert.equal((await fetch(`${BASE}/v1/reports/datasets/invoices/export`, { headers: { Authorization: `Bearer ${alice}` } })).status, 200);
      assert.equal((await api<{ licenseTier: string }>(alice, 'GET', '/users/me')).body.licenseTier, 'vanguard');
    } finally {
      await api(admin, 'PATCH', `/tenants/${tenantId}/license`, { licenseTier: 'symphony' });
      release();
    }
    assert.equal((await api(alice, 'DELETE', `/v1/reports/saved/${saved.body.id}`)).status, 204);
  });
});
