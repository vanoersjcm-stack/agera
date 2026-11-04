/** Slice 2 (audit §13 G26/G31): Vanguard deal pipeline and mutual action plans in client rooms. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

const C1 = 'c1e00000-0000-4000-8000-000000000001';

interface Deal { id: string; clientId: string; clientName: string; stage: string; value: string; ownerName: string | null; clientRoomId: string | null; history: { fromStage: string | null; toStage: string }[] }
interface Milestone { id: string; title: string; ownerSide: string; completed: boolean; completedAt: string | null; completedByName: string | null }

let alice: string;
let carol: string;
let dave: string;
let devAdmin: string;
let clientId: string;
let dealId: string;
let roomId: string;
const stamp = Date.now();

before(async () => {
  [alice, carol, dave, devAdmin] = await Promise.all([getToken('alice', 'alice'), getToken('carol', 'carol'), getToken('dave', 'dave'), getToken('dev.admin', 'devadmin')]);
  const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Pipeline ${stamp}` });
  clientId = client.body.id;
});

describe('/v1/deals', () => {
  it('creates a deal in the first stage with a history entry', async () => {
    const created = await api<Deal>(alice, 'POST', '/v1/deals', { clientId, title: `Deal ${stamp}`, value: 42000, priority: 'high', dueDate: '2026-12-31' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.stage, 'lead_ingest');
    assert.equal(created.body.value, '42000.00');
    assert.equal(created.body.clientName, `Pipeline ${stamp}`);
    assert.deepEqual(created.body.history.map((h) => [h.fromStage, h.toStage]), [[null, 'lead_ingest']]);
    dealId = created.body.id;
  });

  it('moves a deal through the stages and records each transition', async () => {
    for (const stage of ['proposal_sent', 'contract_negotiation', 'ops_handoff']) {
      const moved = await api<Deal>(alice, 'PATCH', `/v1/deals/${dealId}/stage`, { stage });
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      assert.equal(moved.body.stage, stage);
    }
    const deal = await api<Deal>(alice, 'GET', `/v1/deals/${dealId}`);
    assert.equal(deal.body.history.length, 4);
    assert.equal(deal.body.history[0].toStage, 'ops_handoff');
    const filtered = await api<Deal[]>(alice, 'GET', '/v1/deals?stage=ops_handoff');
    assert.ok(filtered.body.some((d) => d.id === dealId));
    assert.ok(!(await api<Deal[]>(alice, 'GET', '/v1/deals?stage=lead_ingest')).body.some((d) => d.id === dealId));
  });

  it('validates stages, amounts, dates and references', async () => {
    assert.equal((await api(alice, 'PATCH', `/v1/deals/${dealId}/stage`, { stage: 'won' })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/v1/deals/${dealId}`, { stage: 'lead_ingest' })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/v1/deals/${dealId}`, { value: -5 })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/v1/deals/${dealId}`, { dueDate: '31-12-2026' })).status, 400);
    assert.equal((await api(alice, 'POST', '/v1/deals', { clientId: '00000000-0000-4000-8000-000000000000', title: 'x' })).status, 400);
    assert.equal((await api(alice, 'PATCH', `/v1/deals/${dealId}`, { ownerId: '00000000-0000-4000-8000-000000000000' })).status, 400);
  });

  it('is invisible to other organisations and to client contacts', async () => {
    assert.equal((await api(devAdmin, 'GET', `/v1/deals/${dealId}`)).status, 404);
    assert.equal((await api(carol, 'GET', '/v1/deals')).status, 403);
  });

  it('deletes a deal', async () => {
    const tmp = await api<Deal>(alice, 'POST', '/v1/deals', { clientId, title: 'Temporary' });
    assert.equal((await api(alice, 'DELETE', `/v1/deals/${tmp.body.id}`)).status, 204);
    assert.equal((await api(alice, 'GET', `/v1/deals/${tmp.body.id}`)).status, 404);
  });
});

describe('client room action plan', () => {
  let clientStep: string;
  let teamStep: string;

  before(async () => {
    const room = await api<{ id: string }>(alice, 'POST', '/v1/dsrs', { clientId: C1, roomName: `Plan ${stamp}` });
    assert.equal(room.status, 201, JSON.stringify(room.body));
    roomId = room.body.id;
  });

  it('lets internal users add steps for both sides', async () => {
    const a = await api<Milestone>(alice, 'POST', `/v1/nexus/client-rooms/${roomId}/milestones`, { title: 'Sign NDA', ownerSide: 'client', dueDate: '2026-11-30' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    clientStep = a.body.id;
    const b = await api<Milestone>(alice, 'POST', `/v1/nexus/client-rooms/${roomId}/milestones`, { title: 'Send proposal' });
    assert.equal(b.body.ownerSide, 'internal');
    teamStep = b.body.id;
    assert.equal((await api(carol, 'POST', `/v1/nexus/client-rooms/${roomId}/milestones`, { title: 'x' })).status, 403);
  });

  it('shows the plan to the room’s client and lets them tick off client steps only', async () => {
    const list = await api<Milestone[]>(carol, 'GET', `/v1/nexus/client-rooms/${roomId}/milestones`);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);
    const done = await api<Milestone>(carol, 'PATCH', `/v1/nexus/client-rooms/${roomId}/milestones/${clientStep}`, { completed: true });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.completed, true);
    assert.ok(done.body.completedAt);
    assert.ok(done.body.completedByName);
    assert.equal((await api(carol, 'PATCH', `/v1/nexus/client-rooms/${roomId}/milestones/${teamStep}`, { completed: true })).status, 403);
    assert.equal((await api(carol, 'PATCH', `/v1/nexus/client-rooms/${roomId}/milestones/${clientStep}`, { title: 'Renamed' })).status, 403);
  });

  it('hides the plan from other clients', async () => {
    assert.equal((await api(dave, 'GET', `/v1/nexus/client-rooms/${roomId}/milestones`)).status, 404);
    assert.equal((await api(dave, 'PATCH', `/v1/nexus/client-rooms/${roomId}/milestones/${clientStep}`, { completed: false })).status, 404);
  });

  it('lets internal users reopen and remove steps', async () => {
    const reopened = await api<Milestone>(alice, 'PATCH', `/v1/nexus/client-rooms/${roomId}/milestones/${clientStep}`, { completed: false });
    assert.equal(reopened.body.completed, false);
    assert.equal(reopened.body.completedAt, null);
    assert.equal((await api(alice, 'DELETE', `/v1/nexus/client-rooms/${roomId}/milestones/${teamStep}`)).status, 204);
    assert.equal((await api<Milestone[]>(alice, 'GET', `/v1/nexus/client-rooms/${roomId}/milestones`)).body.length, 1);
  });

  it('links a deal to a room of the same client only', async () => {
    const otherClient = await api(alice, 'PATCH', `/v1/deals/${dealId}`, { clientRoomId: roomId });
    assert.equal(otherClient.status, 400);
  });
});
