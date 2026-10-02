import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { ACME_TEST, AGERA_DEV, api, nextMillisecond, setupUsers, type TestUser, waitFor } from './helpers.ts';

interface WorkOrder {
  id: string;
  status: string;
  assignedUserId: string | null;
  updatedAt: string;
}

interface AuditLog {
  tenantId: string;
  userId: string | null;
  action: string;
  details: Record<string, unknown> | null;
}

const run = randomUUID().slice(0, 8);
let tenantA: TestUser;
let alice: TestUser;
let bob: TestUser;

async function createWorkOrder(user: TestUser, title: string): Promise<WorkOrder> {
  const { status, body } = await api<WorkOrder>(user.token, 'POST', '/work-orders', { title });
  assert.equal(status, 201);
  return body;
}

function assign(user: TestUser, id: string, body: unknown) {
  return api<WorkOrder>(user.token, 'PATCH', `/work-orders/${id}/assign`, body);
}

before(async () => {
  ({ tenantA, alice, bob } = await setupUsers());
  assert.equal(tenantA.profile.tenantId, AGERA_DEV);
  assert.equal(alice.profile.tenantId, ACME_TEST);
});

describe('PATCH /work-orders/:id/assign', () => {
  it('requires authentication', async () => {
    assert.equal((await api(null, 'PATCH', `/work-orders/${randomUUID()}/assign`, { assigned_user_id: null })).status, 401);
  });

  it('assigns a same-tenant user, bumps updated_at and writes work_order.assigned asynchronously', async () => {
    const workOrder = await createWorkOrder(alice, `assign ${run}`);
    await nextMillisecond();

    const result = await assign(alice, workOrder.id, { assigned_user_id: bob.profile.id });
    assert.equal(result.status, 200);
    assert.equal(result.body.assignedUserId, bob.profile.id);
    assert.ok(result.body.updatedAt > workOrder.updatedAt);

    const delta = await api<{ items: WorkOrder[] }>(
      alice.token,
      'GET',
      `/work-orders?limit=100&updated_since=${encodeURIComponent(workOrder.updatedAt)}`,
    );
    assert.ok(delta.body.items.some((w) => w.id === workOrder.id && w.assignedUserId === bob.profile.id));

    const entry = await waitFor(async () => {
      const audit = await api<{ items: AuditLog[] }>(alice.token, 'GET', '/audit-logs?limit=100');
      return audit.body.items.find((a) => a.action === 'work_order.assigned' && a.details?.workOrderId === workOrder.id);
    });
    assert.equal(entry.tenantId, ACME_TEST);
    assert.equal(entry.userId, alice.profile.id);
    assert.deepEqual(entry.details, { workOrderId: workOrder.id, previousAssignedUserId: null, assignedUserId: bob.profile.id });

    const unassigned = await assign(bob, workOrder.id, { assigned_user_id: null });
    assert.equal(unassigned.status, 200);
    assert.equal(unassigned.body.assignedUserId, null);
  });

  it('rejects an assignee from another tenant with 400 and leaves the work order unchanged', async () => {
    const workOrder = await createWorkOrder(alice, `cross-assign ${run}`);
    const result = await assign(alice, workOrder.id, { assigned_user_id: tenantA.profile.id });
    assert.equal(result.status, 400);

    const current = await api<WorkOrder>(alice.token, 'GET', `/work-orders/${workOrder.id}`);
    assert.equal(current.body.assignedUserId, null);
    assert.equal(current.body.updatedAt, workOrder.updatedAt);
  });

  it('returns 404 when another tenant tries to assign the work order', async () => {
    const workOrder = await createWorkOrder(alice, `foreign-assign ${run}`);
    assert.equal((await assign(tenantA, workOrder.id, { assigned_user_id: tenantA.profile.id })).status, 404);
    assert.equal((await assign(tenantA, workOrder.id, { assigned_user_id: bob.profile.id })).status, 404);
    const current = await api<WorkOrder>(alice.token, 'GET', `/work-orders/${workOrder.id}`);
    assert.equal(current.body.assignedUserId, null);
  });

  it('validates the payload and rejects reassigning closed work orders', async () => {
    const workOrder = await createWorkOrder(alice, `assign-validation ${run}`);
    assert.equal((await assign(alice, workOrder.id, {})).status, 400);
    assert.equal((await assign(alice, workOrder.id, { assigned_user_id: 'nope' })).status, 400);
    assert.equal((await assign(alice, workOrder.id, { assigned_user_id: randomUUID() })).status, 400);
    assert.equal((await assign(alice, randomUUID(), { assigned_user_id: bob.profile.id })).status, 404);

    await api(alice.token, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'COMPLETED' });
    assert.equal((await assign(alice, workOrder.id, { assigned_user_id: bob.profile.id })).status, 409);
  });
});
