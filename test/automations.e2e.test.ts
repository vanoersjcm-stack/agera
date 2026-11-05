/** Wave 5 (audit G41): automation engine, with the Vanguard limits (5 active, linear only) returning 402. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { api, getToken, tierLock } from './helpers.ts';

interface Automation { id: string; active: boolean; runCount: number; runs?: { status: string; detail: string }[] }
interface Listing { tier: string; maxActive: number | null; activeCount: number; items: Automation[] }

let admin: string;
let alice: string;
let carol: string;
let tenantId: string;
let aliceId: string;
const stamp = Date.now();
const linear = (title: string) => [{ condition: { field: 'sku', op: 'contains', value: `AUTO${stamp}` }, action: 'notify_user', config: { userId: aliceId, title }, delayMinutes: 0 }];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  [admin, alice, carol] = await Promise.all([getToken('dev.admin', 'devadmin'), getToken('alice', 'alice'), getToken('carol', 'carol')]);
  tenantId = (await api<{ id: string }>(alice, 'GET', '/tenants/me')).body.id;
  aliceId = (await api<{ id: string }>(alice, 'GET', '/users/me')).body.id;
});

after(async () => {
  const release = await tierLock(tenantId);
  try {
    await api(admin, 'PATCH', `/tenants/${tenantId}/license`, { licenseTier: 'symphony' });
  } finally {
    release();
  }
});

describe('/v1/automations', () => {
  it('runs a linear automation when its trigger fires and the condition holds', async () => {
    const created = await api<Automation>(alice, 'POST', '/v1/automations', { name: `New AUTO product ${stamp}`, trigger: 'product.created', steps: linear(`Product {{sku}} added`) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    await api(alice, 'POST', '/v1/field/products', { sku: `AUTO${stamp}-1`, name: 'Automated', unitPrice: 1 });
    await api(alice, 'POST', '/v1/field/products', { sku: `OTHER${stamp}`, name: 'Not matching', unitPrice: 1 });
    await sleep(800);
    const inbox = await api<{ items: { title: string }[] }>(alice, 'GET', '/v1/notifications');
    assert.ok(inbox.body.items.some((n) => n.title === `Product AUTO${stamp}-1 added`), JSON.stringify(inbox.body.items.slice(0, 3)));
    const detail = await api<Automation>(alice, 'GET', `/v1/automations/${created.body.id}`);
    assert.ok(detail.body.runCount >= 2, String(detail.body.runCount));
    const statuses = detail.body.runs!.map((r) => r.status);
    assert.ok(statuses.includes('done') && statuses.includes('skipped'), statuses.join(','));
    assert.equal((await api(alice, 'POST', '/v1/automations', { name: 'x', trigger: 'nope', steps: linear('t') })).status, 400);
    assert.equal((await api(carol, 'GET', '/v1/automations')).status, 403);
    assert.equal((await api(alice, 'DELETE', `/v1/automations/${created.body.id}`)).status, 204);
  });

  it('limits Vanguard to 5 active linear automations (402) and Symphony allows branching and delays', async () => {
    const branching = [...linear('a'), { condition: null, action: 'create_exception', config: { title: 'b', severity: 'low' }, delayMinutes: 60 }];
    const sym = await api<Automation>(alice, 'POST', '/v1/automations', { name: `Branching ${stamp}`, trigger: 'store.created', steps: branching, active: false });
    assert.equal(sym.status, 201, JSON.stringify(sym.body));
    const before = (await api<Listing>(alice, 'GET', '/v1/automations')).body;
    const paused: string[] = [];
    for (const a of before.items.filter((x) => x.active)) (await api(alice, 'PATCH', `/v1/automations/${a.id}`, { active: false }), paused.push(a.id));
    const made: string[] = [];
    const release = await tierLock(tenantId);
    try {
      await api(admin, 'PATCH', `/tenants/${tenantId}/license`, { licenseTier: 'vanguard' });
      for (let i = 0; i < 5; i++) {
        const r = await api<Automation>(alice, 'POST', '/v1/automations', { name: `Linear ${i} ${stamp}`, trigger: 'client.created', steps: linear('t') });
        assert.equal(r.status, 201, JSON.stringify(r.body));
        made.push(r.body.id);
      }
      const sixth = await api<{ message: string }>(alice, 'POST', '/v1/automations', { name: `Sixth ${stamp}`, trigger: 'client.created', steps: linear('t') });
      assert.equal(sixth.status, 402);
      assert.match(sixth.body.message, /Enterprise tier required/);
      assert.equal((await api(alice, 'POST', '/v1/automations', { name: 'Paused branching', trigger: 'client.created', steps: branching, active: false })).status, 402);
      assert.equal((await api(alice, 'PATCH', `/v1/automations/${sym.body.id}`, { active: true })).status, 402);
      const listing = (await api<Listing>(alice, 'GET', '/v1/automations')).body;
      assert.equal(listing.tier, 'vanguard');
      assert.equal(listing.maxActive, 5);
    } finally {
      await api(admin, 'PATCH', `/tenants/${tenantId}/license`, { licenseTier: 'symphony' });
      release();
      for (const id of [...made, sym.body.id]) await api(alice, 'DELETE', `/v1/automations/${id}`);
      for (const id of paused) await api(alice, 'PATCH', `/v1/automations/${id}`, { active: true });
    }
  });
});
