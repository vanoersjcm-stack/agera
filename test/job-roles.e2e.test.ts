import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('job roles (sec-2)', () => {
  let field: string;
  let manager: string;
  let hq: string;
  let viewer: string;

  before(async () => {
    [field, manager, hq, viewer] = await Promise.all(['fiona', 'adam', 'hannah', 'victor'].map((u) => getToken(u, u)));
  });

  it('FIELD_REPRESENTATIVE works in RetailPower only', async () => {
    for (const path of ['/stores', '/v1/operations/crew', '/v1/operations/shifts/mine/open', '/v1/operations/rma', '/v1/clients', '/v1/notifications']) {
      assert.equal((await api(field, 'GET', path)).status, 200, path);
    }
    for (const path of ['/v1/invoices', '/v1/governance/credit-holds', '/audit-logs', '/audit-logs/verify', '/v1/automations', '/v1/reports/kpis', '/v1/deals', '/v1/agreements', '/v1/financials/models', '/v1/surveys', '/v1/approvals']) {
      assert.equal((await api(field, 'GET', path)).status, 403, path);
    }
    assert.equal((await api(field, 'POST', '/v1/clients', { name: 'Not allowed' })).status, 403);
  });

  it('FIELD_REPRESENTATIVE cannot do coordinator actions', async () => {
    assert.equal((await api(field, 'PATCH', `/v1/operations/shifts/${UNKNOWN}/validation`, { status: 'approved' })).status, 403);
    assert.equal((await api(field, 'GET', '/v1/operations/shifts/export.csv')).status, 403);
    assert.equal((await api(field, 'PATCH', `/v1/operations/rma/${UNKNOWN}/status`, { status: 'approved' })).status, 403);
  });

  it('ACCOUNT_MANAGER works in Nexus but not in Symphony admin', async () => {
    for (const path of ['/v1/clients', '/v1/deals', '/v1/agreements', '/v1/surveys', '/stores', '/v1/invoices']) {
      assert.equal((await api(manager, 'GET', path)).status, 200, path);
    }
    for (const path of ['/audit-logs', '/audit-logs/verify', '/v1/governance/credit-holds', '/users/accounts']) {
      assert.equal((await api(manager, 'GET', path)).status, 403, path);
    }
    assert.equal((await api(manager, 'POST', '/v1/governance/credit-holds', { scope: 'tenant', reason: 'x' })).status, 403);
    assert.equal((await api(manager, 'POST', '/v1/invoices', {})).status, 403);
    assert.equal((await api(manager, 'POST', '/v1/automations', {})).status, 403);
    assert.equal((await api(manager, 'POST', '/v1/operations/rma', {})).status, 403);
  });

  it('HQ_ADMIN runs Symphony, reads Nexus and signs off RetailPower operations', async () => {
    for (const path of ['/audit-logs', '/v1/governance/credit-holds', '/users/accounts', '/v1/deals', '/stores']) {
      assert.equal((await api(hq, 'GET', path)).status, 200, path);
    }
    assert.equal((await api(hq, 'POST', '/v1/clients', { name: 'Not allowed' })).status, 403);
    assert.notEqual((await api(hq, 'PATCH', `/v1/operations/shifts/${UNKNOWN}/validation`, { status: 'approved' })).status, 403);
    assert.equal((await api(hq, 'GET', '/tenants')).status, 403);
    assert.equal((await api(hq, 'GET', '/api-keys')).status, 200, 'integrations are readable');
    assert.equal((await api(hq, 'POST', '/api-keys', { name: 'x' })).status, 403);
  });

  it('CLIENT_VIEWER only reaches the client portal', async () => {
    for (const path of ['/v1/clients', '/v1/deals', '/stores', '/v1/invoices', '/audit-logs', '/v1/operations/crew', '/users/accounts']) {
      assert.equal((await api(viewer, 'GET', path)).status, 403, path);
    }
    assert.equal((await api(viewer, 'GET', '/v1/portal/surveys')).status, 200);
  });

  it('the audit chain verifies after the refusals were logged', async () => {
    const res = await api<{ intact: boolean }>(hq, 'GET', '/audit-logs/verify');
    assert.equal(res.status, 200);
    assert.equal(res.body.intact, true);
  });
});
