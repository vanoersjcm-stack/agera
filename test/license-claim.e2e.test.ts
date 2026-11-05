/** The organisation's edition travels in the access token as `tenant_license_tier` and follows edition changes. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, getToken, tierLock } from './helpers.ts';

interface Me { id: string; licenseTier: string }

const claim = (token: string): unknown =>
  (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>).tenant_license_tier;

async function claimAfterSync(expected: string): Promise<unknown> {
  let value: unknown;
  for (let i = 0; i < 40; i++) {
    value = claim(await getToken('dev.admin', 'devadmin'));
    if (value === expected) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return value;
}

describe('tenant_license_tier token claim', () => {
  it('carries the edition and follows an upgrade/downgrade, while the old token falls back to the database', async () => {
    const admin = await getToken('dev.admin', 'devadmin');
    const release = await tierLock((await api<Me>(admin, 'GET', '/tenants/me')).body.id);
    const home = (await api<Me>(admin, 'GET', '/tenants/me')).body;
    try {
      assert.equal(await claimAfterSync(home.licenseTier), home.licenseTier);
      const stale = await getToken('dev.admin', 'devadmin');

      assert.equal((await api(admin, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: 'vanguard' })).status, 200);
      assert.equal(await claimAfterSync('vanguard'), 'vanguard');
      // A token issued before the change still says symphony; the backend must not trust it.
      assert.equal(claim(stale), home.licenseTier);
      assert.equal((await api<Me>(stale, 'GET', '/tenants/me')).body.licenseTier, 'vanguard');
      const step = { condition: null, action: 'create_exception', config: { title: 'claim check', severity: 'low' }, delayMinutes: 60 };
      const multi = await api(stale, 'POST', '/v1/automations', { name: 'Claim check', trigger: 'store.created', steps: [step, step], active: false });
      assert.equal(multi.status, 402, 'a stale symphony claim must not unlock Enterprise features');
    } finally {
      await api(admin, 'PATCH', `/tenants/${home.id}/license`, { licenseTier: home.licenseTier });
      release();
    }
    assert.equal(await claimAfterSync(home.licenseTier), home.licenseTier);
  });
});
