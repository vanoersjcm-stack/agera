/** Office documents bound to clients, edited in Collabora Online through the WOPI host (spec: Collabora Online integration). */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken } from './helpers.ts';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
let alice: string;
let carol: string;
let clientId: string;
let contactId: string;
const stamp = Date.now();

interface Doc { id: string; title: string; clientId: string; contactId: string | null; fileFormat: string; fileName: string; currentVersion: number; sha256: string; editable: boolean }
interface Session { editorUrl: string; accessToken: string; accessTokenTtl: number; documentTitle: string; clientName: string; contactName: string | null }

function wopiUrl(session: Session): string {
  const src = new URL(session.editorUrl, 'http://x').searchParams.get('WOPISrc');
  assert.ok(src, 'editor URL carries WOPISrc');
  return `${BASE}${new URL(src).pathname.replace(/^\/api/, '')}`;
}

before(async () => {
  [alice, carol] = await Promise.all([getToken('alice', 'alice'), getToken('carol', 'carol')]);
  const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Office ${stamp}` });
  assert.equal(client.status, 201, JSON.stringify(client.body));
  clientId = client.body.id;
  const contact = await api<{ id: string }>(alice, 'POST', `/v1/clients/${clientId}/contacts`, { firstName: 'Eva', lastName: 'de Vries', email: `eva${stamp}@example.com` });
  assert.equal(contact.status, 201, JSON.stringify(contact.body));
  contactId = contact.body.id;
});

describe('/v1/documents (office)', () => {
  it('reports the editor as connected', async () => {
    const r = await api<{ connected: boolean }>(alice, 'GET', '/v1/documents/editor-status');
    assert.equal(r.status, 200);
    assert.equal(r.body.connected, true);
  });

  it('lists documents not yet shared in a client room as drafts and requires clientId otherwise', async () => {
    const created = await api<Doc>(alice, 'POST', '/v1/documents', { clientId, title: `Concept ${stamp}`, format: 'xlsx' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const drafts = await api<(Doc & { clientRoomId: string | null })[]>(alice, 'GET', '/v1/documents?drafts=true');
    assert.equal(drafts.status, 200);
    assert.ok(drafts.body.some((d) => d.id === created.body.id));
    assert.ok(drafts.body.every((d) => d.clientRoomId === null));
    assert.equal((await api(alice, 'GET', '/v1/documents')).status, 400);
  });

  it('creates a .docx for a client and contact, edits it via WOPI with locks, and keeps versions', async () => {
    const created = await api<Doc>(alice, 'POST', '/v1/documents', { clientId, contactId, title: `Jaarovereenkomst ${stamp}`, format: 'docx' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.fileFormat, 'docx');
    assert.equal(created.body.contactId, contactId);
    assert.equal(created.body.editable, true);
    const id = created.body.id;

    const listed = await api<Doc[]>(alice, 'GET', `/v1/documents?clientId=${clientId}`);
    assert.ok(listed.body.some((d) => d.id === id));

    const session = await api<Session>(alice, 'POST', `/v1/documents/${id}/session`);
    assert.equal(session.status, 200, JSON.stringify(session.body));
    assert.equal(session.body.contactName, 'Eva de Vries');
    assert.ok(session.body.accessTokenTtl > Date.now());
    const url = wopiUrl(session.body);
    const token = encodeURIComponent(session.body.accessToken);

    const info = await fetch(`${url}?access_token=${token}`).then((r) => r.json());
    assert.equal(info.BaseFileName, created.body.fileName);
    assert.equal(info.UserCanWrite, true);
    assert.equal(info.SupportsLocks, true);
    assert.equal(info.OwnerId, clientId);

    const original = Buffer.from(await (await fetch(`${url}/contents?access_token=${token}`)).arrayBuffer());
    assert.equal(original.subarray(0, 2).toString(), 'PK', 'a real OOXML zip');

    const lock = (override: string, value: string) => fetch(`${url}?access_token=${token}`, { method: 'POST', headers: { 'X-WOPI-Override': override, 'X-WOPI-Lock': value } });
    assert.equal((await lock('LOCK', 'L1')).status, 200);
    const conflict = await lock('LOCK', 'L2');
    assert.equal(conflict.status, 409);
    assert.equal(conflict.headers.get('x-wopi-lock'), 'L1');

    const edited = Buffer.concat([original, Buffer.from('edit')]);
    const wrongLock = await fetch(`${url}/contents?access_token=${token}`, { method: 'POST', headers: { 'X-WOPI-Override': 'PUT', 'X-WOPI-Lock': 'L2' }, body: edited });
    assert.equal(wrongLock.status, 409);
    const put = await fetch(`${url}/contents?access_token=${token}`, { method: 'POST', headers: { 'X-WOPI-Override': 'PUT', 'X-WOPI-Lock': 'L1', 'Content-Type': 'application/octet-stream' }, body: edited });
    assert.equal(put.status, 200);
    assert.equal(put.headers.get('x-wopi-itemversion'), '2');
    assert.equal((await lock('UNLOCK', 'L1')).status, 200);

    const saved = Buffer.from(await (await fetch(`${url}/contents?access_token=${token}`)).arrayBuffer());
    assert.deepEqual(saved, edited);
    const versions = await api<{ version: number; sha256: string; uploadedByName: string }[]>(alice, 'GET', `/v1/documents/${id}/versions`);
    assert.deepEqual(versions.body.map((v) => v.version), [2, 1]);
    assert.notEqual(versions.body[0].sha256, versions.body[1].sha256);
  });

  it('rejects a missing, forged or other-document token', async () => {
    const a = await api<Doc>(alice, 'POST', '/v1/documents', { clientId, title: `Sheet ${stamp}`, format: 'xlsx' });
    const b = await api<Doc>(alice, 'POST', '/v1/documents', { clientId, title: `Deck ${stamp}`, format: 'pptx' });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const session = await api<Session>(alice, 'POST', `/v1/documents/${a.body.id}/session`);
    const url = wopiUrl(session.body);
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(`${url}?access_token=forged`)).status, 401);
    const other = url.replace(a.body.id, b.body.id);
    assert.equal((await fetch(`${other}?access_token=${encodeURIComponent(session.body.accessToken)}`)).status, 401);
  });

  it('fills a document template with client data and converts it to .docx', async () => {
    const tpl = await api<{ id: string }>(alice, 'POST', '/v1/document-templates', { name: `Letter ${stamp}`, kind: 'letter', body: 'Dear {{client.name}},\nThank you.' });
    assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
    const doc = await api<Doc>(alice, 'POST', '/v1/documents', { clientId, title: `Letter ${stamp}`, format: 'docx', templateId: tpl.body.id });
    assert.equal(doc.status, 201, JSON.stringify(doc.body));
    const csv = await api<Doc>(alice, 'POST', '/v1/documents', { clientId, title: `Tiers ${stamp}`, format: 'xlsx', starterCsv: 'Qty,Price\n1,10\n10,9' });
    assert.equal(csv.status, 201, JSON.stringify(csv.body));
  });

  it('is not available to client contacts (external users)', async () => {
    const created = await api<Doc>(alice, 'POST', '/v1/documents', { clientId, title: `Private ${stamp}`, format: 'docx' });
    assert.equal(created.status, 201);
    assert.equal((await api(carol, 'GET', `/v1/documents?clientId=${clientId}`)).status, 403);
    assert.equal((await api(carol, 'GET', `/v1/documents/${created.body.id}`)).status, 403);
    assert.equal((await api(carol, 'POST', `/v1/documents/${created.body.id}/session`)).status, 403);
  });
});
