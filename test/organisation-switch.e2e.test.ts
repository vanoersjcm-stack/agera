/** B4: platform admins can view another organisation read-only via X-Agera-Organisation. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { ACME_TEST, AGERA_DEV, API_URL, getToken } from './helpers.ts';

let admin: string;
let alice: string;
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';

async function call(token: string, method: string, path: string, organisation?: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (organisation) headers['X-Agera-Organisation'] = organisation;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

before(async () => {
  [admin, alice] = await Promise.all([getToken('dev.admin', 'devadmin'), getToken('alice', 'alice')]);
});

describe('organisation switcher', () => {
  it('lists organisations for platform admins only', async () => {
    const list = await call(admin, 'GET', '/tenants');
    assert.equal(list.status, 200);
    const ids = (list.body as { id: string }[]).map((t) => t.id);
    assert.ok(ids.includes(AGERA_DEV) && ids.includes(ACME_TEST));
    assert.equal((await call(alice, 'GET', '/tenants')).status, 403);
  });

  it('lets a platform admin view another organisation read-only', async () => {
    const me = await call(admin, 'GET', '/tenants/me', ACME_TEST);
    assert.equal(me.status, 200);
    assert.equal(me.body.id, ACME_TEST);
    assert.equal(me.body.readOnly, true);
    assert.equal(me.body.resolvedBy, 'switch');
    assert.equal((await call(admin, 'GET', '/stores', ACME_TEST)).status, 200);
  });

  it('rejects every write while viewing another organisation', async () => {
    const created = await call(admin, 'POST', '/stores', ACME_TEST, { name: 'Should not exist', code: `RO-${Date.now()}` });
    assert.equal(created.status, 403);
    assert.match(created.body.message, /Read-only/);
  });

  it('treats the home organisation as a normal session', async () => {
    const me = await call(admin, 'GET', '/tenants/me', AGERA_DEV);
    assert.equal(me.status, 200);
    assert.equal(me.body.id, AGERA_DEV);
    assert.equal(me.body.readOnly, false);
  });

  it('rejects non-platform-admins, unknown and malformed organisations', async () => {
    assert.equal((await call(alice, 'GET', '/stores', UNKNOWN)).status, 403);
    assert.equal((await call(admin, 'GET', '/stores', UNKNOWN)).status, 403);
    assert.equal((await call(admin, 'GET', '/stores', 'not-a-uuid')).status, 400);
  });
});
