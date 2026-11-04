/** Wave 1 (audit G15/G30/B6/G32): versioned client-room documents with download tracking, and simple electronic signatures. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { API_URL, api, getToken } from './helpers.ts';

const C1 = 'c1e00000-0000-4000-8000-000000000001';
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(300, 1)]).toString('base64');

interface Doc { id: string; title: string; currentVersion: number; fileName: string; downloads: number }
interface Signature { id: string; signerEmail: string; contentSha256: string; clientRoomId: string | null }

let alice: string;
let carol: string;
let roomId: string;
let agreementId: string;
let docId: string;
const stamp = Date.now();

async function upload(token: string, file: { name: string; body: string }, fields: Record<string, string> = {}): Promise<{ status: number; body: Doc }> {
  const form = new FormData();
  form.append('file', new Blob([file.body]), file.name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${API_URL}/v1/nexus/client-rooms/${roomId}/documents`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  return { status: res.status, body: (await res.json()) as Doc };
}

async function download(token: string, id: string, version?: number): Promise<{ status: number; text: string }> {
  const res = await fetch(`${API_URL}/v1/nexus/client-rooms/${roomId}/documents/${id}/download${version ? `?version=${version}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, text: await res.text() };
}

before(async () => {
  [alice, carol] = await Promise.all([getToken('alice', 'alice'), getToken('carol', 'carol')]);
  const agreement = await api<{ id: string }>(alice, 'POST', '/v1/agreements', { clientId: C1, title: `Sign ${stamp}`, documentUrl: 'https://docs.example.eu/contract.pdf' });
  assert.equal(agreement.status, 201, JSON.stringify(agreement.body));
  agreementId = agreement.body.id;
  const room = await api<{ id: string }>(alice, 'POST', '/v1/dsrs', { clientId: C1, roomName: `Docs ${stamp}`, agreementId });
  assert.equal(room.status, 201, JSON.stringify(room.body));
  roomId = room.body.id;
});

describe('client-room documents', () => {
  it('uploads a document and a new version', async () => {
    const first = await upload(alice, { name: 'proposal.pdf', body: '%PDF-1.4 v1' }, { title: 'Proposal' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.title, 'Proposal');
    assert.equal(first.body.currentVersion, 1);
    docId = first.body.id;
    const second = await upload(alice, { name: 'proposal-v2.pdf', body: '%PDF-1.4 v2' }, { documentId: docId });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.currentVersion, 2);
    assert.equal(second.body.fileName, 'proposal-v2.pdf');
    const versions = await api<{ version: number }[]>(alice, 'GET', `/v1/nexus/client-rooms/${roomId}/documents/${docId}/versions`);
    assert.deepEqual(versions.body.map((v) => v.version), [2, 1]);
  });

  it('rejects disallowed file types and missing files', async () => {
    assert.equal((await upload(alice, { name: 'run.exe', body: 'MZ' })).status, 400);
    assert.equal((await api(alice, 'POST', `/v1/nexus/client-rooms/${roomId}/documents`, {})).status, 400);
  });

  it('lets the room’s client list and download, and counts client downloads only', async () => {
    assert.equal((await download(alice, docId)).text, '%PDF-1.4 v2');
    const list = await api<Doc[]>(carol, 'GET', `/v1/nexus/client-rooms/${roomId}/documents`);
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].downloads, 0);
    const old = await download(carol, docId, 1);
    assert.equal(old.status, 200);
    assert.equal(old.text, '%PDF-1.4 v1');
    assert.equal((await api<Doc[]>(alice, 'GET', `/v1/nexus/client-rooms/${roomId}/documents`)).body[0].downloads, 1);
    const activity = await api<{ activityType: string }[]>(alice, 'GET', `/nexus/dsr-activities?dsrId=${roomId}`);
    if (activity.status === 200) assert.ok(activity.body.some((a) => a.activityType === 'download'));
  });

  it('keeps uploads, renames and deletes internal', async () => {
    assert.equal((await upload(carol, { name: 'x.pdf', body: 'x' })).status, 403);
    assert.equal((await api(carol, 'DELETE', `/v1/nexus/client-rooms/${roomId}/documents/${docId}`)).status, 403);
    const renamed = await api<Doc>(alice, 'PATCH', `/v1/nexus/client-rooms/${roomId}/documents/${docId}`, { title: 'Final proposal' });
    assert.equal(renamed.body.title, 'Final proposal');
  });

  it('deletes a document with its versions', async () => {
    const extra = await upload(alice, { name: 'notes.txt', body: 'hello' });
    assert.equal((await api(alice, 'DELETE', `/v1/nexus/client-rooms/${roomId}/documents/${extra.body.id}`)).status, 204);
    assert.equal((await download(alice, extra.body.id)).status, 404);
  });
});

describe('agreement signatures', () => {
  it('only lets client contacts sign, with a PNG signature', async () => {
    assert.equal((await api(alice, 'POST', `/v1/agreements/${agreementId}/signatures`, { signerName: 'Alice', signatureImage: PNG })).status, 403);
    assert.equal((await api(carol, 'POST', `/v1/agreements/${agreementId}/signatures`, { signerName: 'Carol', signatureImage: 'data:image/gif;base64,AAAA' })).status, 400);
    assert.equal((await api(carol, 'POST', `/v1/agreements/${agreementId}/signatures`, { signatureImage: PNG })).status, 400);
  });

  it('records the signature with a hash and accepts the terms in the room', async () => {
    const signed = await api<Signature>(carol, 'POST', `/v1/agreements/${agreementId}/signatures`, { signerName: 'Carol Client', signatureImage: PNG });
    assert.equal(signed.status, 201, JSON.stringify(signed.body));
    assert.match(signed.body.contentSha256, /^[0-9a-f]{64}$/);
    assert.equal(signed.body.clientRoomId, roomId);
    const list = await api<Signature[]>(alice, 'GET', `/v1/agreements/${agreementId}/signatures`);
    assert.equal(list.body.length, 1);
    const img = await fetch(`${API_URL}/v1/agreements/${agreementId}/signatures/${signed.body.id}/image`, { headers: { Authorization: `Bearer ${alice}` } });
    assert.equal(img.headers.get('content-type'), 'image/png');
  });

  it('refuses to sign an agreement that is no longer awaiting approval', async () => {
    assert.equal((await api(alice, 'PATCH', `/v1/agreements/${agreementId}/status`, { status: 'active' })).status, 200);
    assert.equal((await api(carol, 'POST', `/v1/agreements/${agreementId}/signatures`, { signerName: 'Carol', signatureImage: PNG })).status, 409);
  });
});
