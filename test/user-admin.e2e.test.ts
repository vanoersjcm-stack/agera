/** B3: People & access — user administration through the Keycloak admin API. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Account {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
}

let admin: string;
let alice: string;
let carol: string;
const run = Date.now();

before(async () => {
  [admin, alice, carol] = await Promise.all([getToken('dev.admin', 'devadmin'), getToken('alice', 'alice'), getToken('carol', 'carol')]);
});

describe('/users administration', () => {
  let invited: Account;

  it('is limited to administrators', async () => {
    assert.equal((await api(alice, 'GET', '/users/accounts')).status, 403);
    assert.equal((await api(alice, 'POST', '/users', { email: `x${run}@agera.test`, firstName: 'X', lastName: 'Y', role: 'user' })).status, 403);
    assert.equal((await api(carol, 'GET', '/users/accounts')).status, 403);
  });

  it('invites a user with a temporary password', async () => {
    const email = `invite.${run}@agera.test`;
    const res = await api<{ user: Account; temporaryPassword: string }>(admin, 'POST', '/users', { email, firstName: 'Ivo', lastName: 'Invite', role: 'user' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.user.role, 'user');
    assert.ok(res.body.temporaryPassword.length >= 12);
    invited = res.body.user;
    const again = await api(admin, 'POST', '/users', { email, firstName: 'Ivo', lastName: 'Invite', role: 'user' });
    assert.equal(again.status, 409);
  });

  it('lists, searches and filters accounts', async () => {
    const page = await api<{ items: Account[]; total: number; managementAvailable: boolean }>(admin, 'GET', `/users/accounts?q=invite.${run}`);
    assert.equal(page.status, 200);
    assert.equal(page.body.managementAvailable, true);
    assert.deepEqual(page.body.items.map((u) => u.id), [invited.id]);
    const admins = await api<{ items: Account[] }>(admin, 'GET', '/users/accounts?role=platform-admin');
    assert.ok(admins.body.items.every((u) => u.role === 'platform-admin'));
    assert.equal((await api(admin, 'GET', '/users/accounts?role=boss')).status, 400);
  });

  it('changes the role and the status', async () => {
    const promoted = await api<Account>(admin, 'PATCH', `/users/${invited.id}/role`, { role: 'admin' });
    assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
    assert.equal(promoted.body.role, 'admin');
    assert.equal((await api(admin, 'PATCH', `/users/${invited.id}/role`, { role: 'External_Client' })).status, 400);
    const off = await api<Account>(admin, 'PATCH', `/users/${invited.id}/status`, { isActive: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.isActive, false);
    const inactive = await api<{ items: Account[] }>(admin, 'GET', `/users/accounts?status=inactive&q=invite.${run}`);
    assert.equal(inactive.body.items.length, 1);
    const on = await api<Account>(admin, 'PATCH', `/users/${invited.id}/status`, { isActive: true });
    assert.equal(on.body.isActive, true);
  });

  it('refuses self-changes and unknown clients', async () => {
    const me = await api<{ id: string }>(admin, 'GET', '/users/me');
    assert.equal((await api(admin, 'PATCH', `/users/${me.body.id}/status`, { isActive: false })).status, 400);
    const res = await api(admin, 'POST', '/users', {
      email: `client.${run}@agera.test`,
      firstName: 'C',
      lastName: 'Lient',
      role: 'External_Client',
      clientId: '00000000-0000-4000-8000-000000000000',
    });
    assert.equal(res.status, 400);
  });

  it('cannot reach users of another organisation', async () => {
    const res = await api(alice, 'PATCH', `/users/${invited.id}/status`, { isActive: false });
    assert.equal(res.status, 403);
  });
});
