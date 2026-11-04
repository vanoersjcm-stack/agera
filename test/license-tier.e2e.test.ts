/** Licence tiers: Vanguard (mid-market, seat-capped) vs Symphony (enterprise) on one backend. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Me { id: string; licenseTier: string; maxSeats: number | null; activeSeats: number }

let admin: string;
let alice: string;
let home: Me;

before(async () => {
  [admin, alice] = await Promise.all([getToken('dev.admin', 'devadmin'), getToken('alice', 'alice')]);
  home = (await api<Me>(admin, 'GET', '/tenants/me')).body;
});

after(async () => {
  await api(admin, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: 'symphony' });
});

describe('licence tier', () => {
  it('reports the tier, seat cap and seats in use', async () => {
    assert.equal(home.licenseTier, 'symphony');
    assert.equal(home.maxSeats, null);
    assert.ok(home.activeSeats >= 1);
  });

  it('switches an organisation to Vanguard with a default 50-seat cap and back without data changes', async () => {
    const vanguard = await api<Me>(admin, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: 'vanguard' });
    assert.equal(vanguard.status, 200, JSON.stringify(vanguard.body));
    assert.equal(vanguard.body.licenseTier, 'vanguard');
    assert.equal(vanguard.body.maxSeats, 50);
    assert.equal((await api<Me>(admin, 'GET', '/tenants/me')).body.licenseTier, 'vanguard');
    const back = await api<Me>(admin, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: 'symphony' });
    assert.equal(back.body.maxSeats, null);
  });

  it('blocks inviting colleagues with 402 once a Vanguard organisation is full', async () => {
    await api(admin, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: 'vanguard', maxSeats: home.activeSeats });
    const res = await api<{ statusCode: number; message: string }>(admin, 'POST', '/users', {
      email: `seat-${Date.now()}@agera.local`, firstName: 'Seat', lastName: 'Test', role: 'user',
    });
    assert.equal(res.status, 402, JSON.stringify(res.body));
    assert.match(res.body.message, /upgrade to Agera Symphony/);
  });

  it('validates input and is restricted to platform administrators', async () => {
    assert.equal((await api(admin, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: 'gold' })).status, 400);
    assert.equal((await api(admin, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: 'vanguard', maxSeats: 0 })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: 'vanguard' })).status, 403);
  });
});
