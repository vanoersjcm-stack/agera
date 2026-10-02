/**
 * Integration tests against the running stack (docker compose + `npm start`).
 * Tenant A: Agera Dev (dev.admin). Tenant B: Acme Test (alice via tenant_id claim, bob via email domain).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { api, getToken, nextMillisecond, waitFor } from './helpers.ts';

interface WorkOrder {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  status: string;
  assignedUserId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface WorkOrderPage {
  items: WorkOrder[];
  page: number;
  limit: number;
  total: number;
}

interface WorkOrderLog {
  previousStatus: string | null;
  newStatus: string;
  changedByUserId: string;
}

interface AuditLog {
  tenantId: string;
  userId: string | null;
  action: string;
  details: Record<string, unknown> | null;
}

interface UserProfile {
  id: string;
  tenantId: string;
}

const AGERA_DEV = 'a9e1a000-0000-4000-8000-000000000001';
const ACME_TEST = 'a9e1a000-0000-4000-8000-000000000002';
const run = randomUUID().slice(0, 8);

let tenantAToken: string;
let aliceToken: string;
let bobToken: string;
let alice: UserProfile;
let bob: UserProfile;

async function createWorkOrder(token: string, title: string, extra: Record<string, unknown> = {}): Promise<WorkOrder> {
  const { status, body } = await api<WorkOrder>(token, 'POST', '/work-orders', { title, ...extra });
  assert.equal(status, 201);
  return body;
}

async function listAll(token: string, query = ''): Promise<WorkOrder[]> {
  const items: WorkOrder[] = [];
  for (let page = 1; ; page++) {
    const separator = query ? '&' : '';
    const { status, body } = await api<WorkOrderPage>(token, 'GET', `/work-orders?${query}${separator}limit=100&page=${page}`);
    assert.equal(status, 200);
    items.push(...body.items);
    if (page * body.limit >= body.total) {
      return items;
    }
  }
}

before(async () => {
  [tenantAToken, aliceToken, bobToken] = await Promise.all([
    getToken('dev.admin', 'devadmin'),
    getToken('alice', 'alice'),
    getToken('bob', 'bob'),
  ]);
  alice = (await api<UserProfile>(aliceToken, 'GET', '/users/me')).body;
  bob = (await api<UserProfile>(bobToken, 'GET', '/users/me')).body;
  await api(tenantAToken, 'GET', '/users/me');
  assert.equal(alice.tenantId, ACME_TEST);
  assert.equal(bob.tenantId, ACME_TEST);
});

describe('authentication', () => {
  it('rejects unauthenticated requests with 401', async () => {
    assert.equal((await api(null, 'GET', '/work-orders')).status, 401);
    assert.equal((await api(null, 'POST', '/work-orders', { title: 'x' })).status, 401);
    assert.equal((await api(null, 'PATCH', `/work-orders/${randomUUID()}/status`, { status: 'COMPLETED' })).status, 401);
  });
});

describe('create', () => {
  it('creates a PENDING work order in the caller tenant and logs it', async () => {
    const workOrder = await createWorkOrder(aliceToken, `create ${run}`, {
      description: 'Replace filter',
      assignedUserId: bob.id,
    });
    assert.equal(workOrder.tenantId, ACME_TEST);
    assert.equal(workOrder.status, 'PENDING');
    assert.equal(workOrder.assignedUserId, bob.id);
    assert.equal(workOrder.completedAt, null);

    const logs = await api<WorkOrderLog[]>(aliceToken, 'GET', `/work-orders/${workOrder.id}/logs`);
    assert.deepEqual(
      logs.body.map((l) => [l.previousStatus, l.newStatus, l.changedByUserId]),
      [[null, 'PENDING', alice.id]],
    );

    await waitFor(async () => {
      const audit = await api<{ items: AuditLog[] }>(aliceToken, 'GET', '/audit-logs?limit=100');
      return audit.body.items.find((a) => a.action === 'work_order.created' && a.details?.workOrderId === workOrder.id);
    });
  });

  it('rejects invalid input and assignees from another tenant', async () => {
    assert.equal((await api(aliceToken, 'POST', '/work-orders', { title: '' })).status, 400);
    assert.equal((await api(aliceToken, 'POST', '/work-orders', { title: 'x', assignedUserId: 'nope' })).status, 400);
    const tenantAUser = (await api<UserProfile>(tenantAToken, 'GET', '/users/me')).body;
    assert.equal((await api(aliceToken, 'POST', '/work-orders', { title: 'x', assignedUserId: tenantAUser.id })).status, 400);
  });
});

describe('tenant isolation', () => {
  it('hides tenant B work orders from tenant A and vice versa', async () => {
    const tenantB = await createWorkOrder(aliceToken, `iso-b ${run}`);
    const tenantA = await createWorkOrder(tenantAToken, `iso-a ${run}`);
    assert.equal(tenantA.tenantId, AGERA_DEV);

    const seenByA = await listAll(tenantAToken);
    assert.ok(seenByA.every((w) => w.tenantId === AGERA_DEV));
    assert.ok(seenByA.some((w) => w.id === tenantA.id));
    assert.ok(!seenByA.some((w) => w.id === tenantB.id));

    const seenByB = await listAll(bobToken);
    assert.ok(seenByB.every((w) => w.tenantId === ACME_TEST));
    assert.ok(seenByB.some((w) => w.id === tenantB.id));
    assert.ok(!seenByB.some((w) => w.id === tenantA.id));

    assert.equal((await api(tenantAToken, 'GET', `/work-orders/${tenantB.id}`)).status, 404);
    assert.equal((await api(tenantAToken, 'GET', `/work-orders/${tenantB.id}/logs`)).status, 404);
  });

  it('prevents tenant A from updating a tenant B work order', async () => {
    const tenantB = await createWorkOrder(aliceToken, `iso-update ${run}`);
    const attempt = await api(tenantAToken, 'PATCH', `/work-orders/${tenantB.id}/status`, { status: 'CANCELLED' });
    assert.equal(attempt.status, 404);

    const unchanged = await api<WorkOrder>(aliceToken, 'GET', `/work-orders/${tenantB.id}`);
    assert.equal(unchanged.body.status, 'PENDING');
    const logs = await api<WorkOrderLog[]>(aliceToken, 'GET', `/work-orders/${tenantB.id}/logs`);
    assert.equal(logs.body.length, 1);
  });

  it('lets users of the same tenant read and update each other’s work orders', async () => {
    const workOrder = await createWorkOrder(aliceToken, `same-tenant ${run}`);
    const update = await api<WorkOrder>(bobToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'IN_PROGRESS' });
    assert.equal(update.status, 200);
    assert.equal(update.body.status, 'IN_PROGRESS');
  });
});

describe('status transitions', () => {
  it('logs every transition, sets completed_at on COMPLETED and writes audit entries', async () => {
    const workOrder = await createWorkOrder(aliceToken, `transitions ${run}`);
    await nextMillisecond();

    const inProgress = await api<WorkOrder>(bobToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'IN_PROGRESS' });
    assert.equal(inProgress.status, 200);
    assert.equal(inProgress.body.completedAt, null);
    assert.ok(inProgress.body.updatedAt > workOrder.updatedAt);

    const completed = await api<WorkOrder>(aliceToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'COMPLETED' });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.status, 'COMPLETED');
    assert.ok(completed.body.completedAt);
    assert.equal(completed.body.completedAt, completed.body.updatedAt);

    const logs = await api<WorkOrderLog[]>(aliceToken, 'GET', `/work-orders/${workOrder.id}/logs`);
    assert.deepEqual(
      logs.body.map((l) => [l.previousStatus, l.newStatus, l.changedByUserId]),
      [
        [null, 'PENDING', alice.id],
        ['PENDING', 'IN_PROGRESS', bob.id],
        ['IN_PROGRESS', 'COMPLETED', alice.id],
      ],
    );

    const auditEntries = await waitFor(async () => {
      const audit = await api<{ items: AuditLog[] }>(aliceToken, 'GET', '/audit-logs?limit=100');
      const entries = audit.body.items.filter(
        (a) => a.action === 'work_order.status_changed' && a.details?.workOrderId === workOrder.id,
      );
      return entries.length === 2 ? entries : undefined;
    });
    assert.ok(auditEntries.every((a) => a.tenantId === ACME_TEST));
    assert.deepEqual(new Set(auditEntries.map((a) => a.details?.newStatus)), new Set(['IN_PROGRESS', 'COMPLETED']));
  });

  it('serializes concurrent transitions so only one wins', async () => {
    const workOrder = await createWorkOrder(aliceToken, `race ${run}`);
    const results = await Promise.all([
      api(aliceToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'COMPLETED' }),
      api(bobToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'COMPLETED' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const logs = await api<WorkOrderLog[]>(aliceToken, 'GET', `/work-orders/${workOrder.id}/logs`);
    assert.equal(logs.body.length, 2);
  });

  it('rejects transitions out of terminal states and unknown statuses', async () => {
    const workOrder = await createWorkOrder(aliceToken, `terminal ${run}`);
    assert.equal((await api(aliceToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'DONE' })).status, 400);
    assert.equal((await api(aliceToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'PENDING' })).status, 409);
    assert.equal((await api(aliceToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'CANCELLED' })).status, 200);
    assert.equal((await api(aliceToken, 'PATCH', `/work-orders/${workOrder.id}/status`, { status: 'IN_PROGRESS' })).status, 409);
    assert.equal((await api(aliceToken, 'PATCH', `/work-orders/${randomUUID()}/status`, { status: 'COMPLETED' })).status, 404);
    assert.equal((await api(aliceToken, 'PATCH', '/work-orders/not-a-uuid/status', { status: 'COMPLETED' })).status, 400);
  });
});

describe('delta sync (updatedSince)', () => {
  it('returns only work orders modified after the given timestamp', async () => {
    const first = await createWorkOrder(aliceToken, `delta-1 ${run}`);
    await nextMillisecond();
    const second = await createWorkOrder(aliceToken, `delta-2 ${run}`);
    await nextMillisecond();

    const sinceFirst = await listAll(aliceToken, `updatedSince=${encodeURIComponent(first.updatedAt)}`);
    assert.ok(sinceFirst.every((w) => w.updatedAt > first.updatedAt));
    assert.ok(!sinceFirst.some((w) => w.id === first.id));
    assert.ok(sinceFirst.some((w) => w.id === second.id));

    const updated = await api<WorkOrder>(aliceToken, 'PATCH', `/work-orders/${first.id}/status`, { status: 'IN_PROGRESS' });
    const sinceSecond = await listAll(aliceToken, `updatedSince=${encodeURIComponent(second.updatedAt)}`);
    assert.ok(sinceSecond.some((w) => w.id === first.id && w.updatedAt === updated.body.updatedAt));
    assert.ok(!sinceSecond.some((w) => w.id === second.id));

    const sinceLatest = await listAll(aliceToken, `updatedSince=${encodeURIComponent(updated.body.updatedAt)}`);
    assert.ok(!sinceLatest.some((w) => w.id === first.id || w.id === second.id));
  });

  it('rejects malformed timestamps', async () => {
    assert.equal((await api(aliceToken, 'GET', '/work-orders?updatedSince=yesterday')).status, 400);
    assert.equal((await api(aliceToken, 'GET', '/work-orders?updatedSince=2026-01-01T00:00:00')).status, 400);
  });
});
