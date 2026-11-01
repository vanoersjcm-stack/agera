/** N13: activity stream of a client room (GET /v1/nexus/dsr-activities), incl. client-user isolation. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

const C1 = 'c1e00000-0000-4000-8000-000000000001';

interface Activity {
  id: string;
  dsrId: string;
  stakeholderEmail: string;
  activityType: string;
  details: Record<string, unknown>;
}

let alice: string;
let carol: string;
let dave: string;
let roomId: string;

before(async () => {
  [alice, carol, dave] = await Promise.all([getToken('alice', 'alice'), getToken('carol', 'carol'), getToken('dave', 'dave')]);
  const room = await api<{ id: string }>(alice, 'POST', '/v1/dsrs', { clientId: C1, roomName: `Stream ${Date.now()}` });
  assert.equal(room.status, 201, JSON.stringify(room.body));
  roomId = room.body.id;
});

describe('GET /v1/nexus/dsr-activities', () => {
  it('returns comments and decisions of a room, newest first', async () => {
    const comment = await api<Activity>(carol, 'POST', '/v1/nexus/dsr-activities', {
      dsrId: roomId,
      stakeholderEmail: 'ignored@example.com',
      activityType: 'comment',
      details: { text: 'Can we move to Q4?' },
    });
    assert.equal(comment.status, 201, JSON.stringify(comment.body));
    assert.equal(comment.body.stakeholderEmail, 'carol@retailer.example');
    const accepted = await api<Activity>(carol, 'POST', '/v1/nexus/dsr-activities', {
      dsrId: roomId,
      stakeholderEmail: 'carol@retailer.example',
      activityType: 'terms_accepted',
      details: { agreementId: null, reason: 'Looks good' },
    });
    assert.equal(accepted.status, 201);

    for (const token of [alice, carol]) {
      const list = await api<Activity[]>(token, 'GET', `/v1/nexus/dsr-activities?dsrId=${roomId}`);
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.map((a) => a.activityType), ['terms_accepted', 'comment']);
      assert.equal(list.body[1].details.text, 'Can we move to Q4?');
    }
  });

  it('shows client users nothing from rooms of another client', async () => {
    const list = await api<Activity[]>(dave, 'GET', `/v1/nexus/dsr-activities?dsrId=${roomId}`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, []);
  });

  it('validates dsrId and limit', async () => {
    assert.equal((await api(alice, 'GET', '/v1/nexus/dsr-activities')).status, 400);
    assert.equal((await api(alice, 'GET', `/v1/nexus/dsr-activities?dsrId=${roomId}&limit=0`)).status, 400);
    const one = await api<Activity[]>(alice, 'GET', `/v1/nexus/dsr-activities?dsrId=${roomId}&limit=1`);
    assert.equal(one.body.length, 1);
  });
});
