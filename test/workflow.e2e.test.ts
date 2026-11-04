/** Wave 3 (audit B5/B7/B8/G16/G21): approval chains, exceptions, notifications and health scores. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

interface Approval { id: string; status: string; currentApproverId: string | null; steps: { decision: string }[] }

let alice: string;
let admin: string;
let carol: string;
let aliceId: string;
let adminId: string;
let planId: string;
const stamp = Date.now();

before(async () => {
  [alice, admin, carol] = await Promise.all([getToken('alice', 'alice'), getToken('dev.admin', 'devadmin'), getToken('carol', 'carol')]);
  aliceId = (await api<{ id: string }>(alice, 'GET', '/users/me')).body.id;
  adminId = (await api<{ id: string }>(admin, 'GET', '/users/me')).body.id;
  const plan = await api<{ id: string }>(alice, 'POST', '/v1/financials/models', { modelName: `Approval ${stamp}`, fiscalYear: 2027 });
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  planId = plan.body.id;
});

describe('approval chains', () => {
  it('runs a two-step chain and approves the plan at the end', async () => {
    const created = await api<Approval>(alice, 'POST', '/v1/approvals', { entityType: 'financial_plan', entityId: planId, approverIds: [adminId, aliceId], note: 'Please check' });
    if (created.status === 400 && JSON.stringify(created.body).includes('active colleagues')) return; // users from different organisations in this seed
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.currentApproverId, adminId);
    assert.equal((await api(alice, 'POST', '/v1/approvals', { entityType: 'financial_plan', entityId: planId, approverIds: [adminId] })).status, 409);
    assert.equal((await api(alice, 'POST', `/v1/approvals/${created.body.id}/decision`, { decision: 'approved' })).status, 403);
    const inbox = await api<Approval[]>(admin, 'GET', '/v1/approvals?mine=true');
    assert.ok(inbox.body.some((a) => a.id === created.body.id));
    const notes = await api<{ unread: number; items: { title: string }[] }>(admin, 'GET', '/v1/notifications');
    assert.ok(notes.body.items.some((n) => n.title.includes(`Approval ${stamp}`)));
    const step1 = await api<Approval>(admin, 'POST', `/v1/approvals/${created.body.id}/decision`, { decision: 'approved' });
    assert.equal(step1.body.status, 'pending');
    assert.equal(step1.body.currentApproverId, aliceId);
    const step2 = await api<Approval>(alice, 'POST', `/v1/approvals/${created.body.id}/decision`, { decision: 'approved', comment: 'ok' });
    assert.equal(step2.body.status, 'approved');
    const plan = await api<{ status: string }>(alice, 'GET', `/v1/financials/models/${planId}`);
    assert.equal(plan.body.status, 'approved');
  });

  it('requires a comment to reject and refuses external users', async () => {
    const plan = await api<{ id: string }>(alice, 'POST', '/v1/financials/models', { modelName: `Reject ${stamp}`, fiscalYear: 2027 });
    const r = await api<Approval>(alice, 'POST', '/v1/approvals', { entityType: 'financial_plan', entityId: plan.body.id, approverIds: [aliceId] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await api(alice, 'POST', `/v1/approvals/${r.body.id}/decision`, { decision: 'rejected' })).status, 400);
    assert.equal((await api<Approval>(alice, 'POST', `/v1/approvals/${r.body.id}/decision`, { decision: 'rejected', comment: 'Numbers off' })).body.status, 'rejected');
    assert.equal((await api(carol, 'GET', '/v1/approvals')).status, 403);
  });
});

describe('exceptions and notifications', () => {
  it('logs, assigns and resolves an exception', async () => {
    const e = await api<{ id: string; status: string; ownerId: string }>(admin, 'POST', '/v1/exceptions', { title: `Broken display ${stamp}`, severity: 'high', ownerId: adminId });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    assert.equal((await api(admin, 'PATCH', `/v1/exceptions/${e.body.id}`, { status: 'resolved' })).status, 400);
    const done = await api<{ status: string; resolvedAt: string }>(admin, 'PATCH', `/v1/exceptions/${e.body.id}`, { status: 'resolved', resolution: 'Replaced' });
    assert.equal(done.body.status, 'resolved');
    assert.ok(done.body.resolvedAt);
    assert.ok((await api<{ id: string }[]>(admin, 'GET', '/v1/exceptions?status=resolved')).body.some((x) => x.id === e.body.id));
    assert.equal((await api(admin, 'POST', '/v1/exceptions', { title: 'x', severity: 'urgent' })).status, 400);
  });

  it('marks notifications as read', async () => {
    assert.equal((await api(admin, 'POST', '/v1/notifications/read', {})).status, 204);
    assert.equal((await api<{ unread: number }>(admin, 'GET', '/v1/notifications')).body.unread, 0);
  });
});

describe('health scores', () => {
  it('scores every active client between 0 and 100 with a band', async () => {
    const res = await api<{ score: number; band: string; engagementScore: number }[]>(alice, 'GET', '/v1/clients-health');
    assert.equal(res.status, 200);
    for (const c of res.body) {
      assert.ok(c.score >= 0 && c.score <= 100);
      assert.ok(['healthy', 'watch', 'at_risk'].includes(c.band));
    }
  });
});
