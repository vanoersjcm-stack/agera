/** Test 1a round 2: entity categories, private third parties, personal (client-less) documents, Agera Memo, standard templates. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, API_URL, getToken } from './helpers.ts';

const stamp = Date.now();

interface ClientRow { id: string; name: string; entityCategory: string; organizationType: string | null; companySize: string | null; phone: string | null; createdBy: string | null }
interface Doc { id: string; title: string; clientId: string | null }

describe('Third parties, private records, personal documents and templates', () => {
  let alice: string;
  let bob: string;

  before(async () => {
    [alice, bob] = await Promise.all([getToken('alice', 'alice'), getToken('bob', 'bob')]); // both in Acme Test
  });

  it('stores category, organisation type, size and phone, and validates them', async () => {
    const r = await api<ClientRow>(alice, 'POST', '/v1/clients', {
      name: `Notaris ${stamp}`, entityCategory: 'notary', organizationType: 'commercial_enterprise', companySize: 'SME', phone: '+31 20 123 4567',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.entityCategory, r.body.organizationType, r.body.companySize, r.body.phone], ['notary', 'commercial_enterprise', 'SME', '+31 20 123 4567']);
    assert.ok(r.body.createdBy);
    const seen = await api<ClientRow[]>(bob, 'GET', '/v1/clients');
    assert.ok(seen.body.some((c) => c.id === r.body.id), 'non-private third parties are shared inside the tenant');
    const badSize = await api(alice, 'POST', '/v1/clients', { name: `Gemeente ${stamp}`, organizationType: 'government', companySize: 'Large' });
    assert.equal(badSize.status, 400);
    const badCategory = await api(alice, 'POST', '/v1/clients', { name: `X ${stamp}`, entityCategory: 'friend' });
    assert.equal(badCategory.status, 400);
  });

  it('shows a private entity only to its creator (RLS), administrators included', async () => {
    const r = await api<ClientRow>(bob, 'POST', '/v1/clients', { name: `Privé ${stamp}`, entityCategory: 'private' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const own = await api<ClientRow[]>(bob, 'GET', '/v1/clients');
    assert.ok(own.body.some((c) => c.id === r.body.id));
    const other = await api<ClientRow[]>(alice, 'GET', '/v1/clients');
    assert.ok(!other.body.some((c) => c.id === r.body.id), 'hidden from another user');
    assert.equal((await api(alice, 'GET', `/v1/clients/${r.body.id}`)).status, 404);
    assert.equal((await api(alice, 'PATCH', `/v1/clients/${r.body.id}`, { name: 'taken over' })).status, 404);
    const mine = await api<ClientRow>(bob, 'PATCH', `/v1/clients/${r.body.id}`, { phone: '0612345678' });
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
  });

  it('creates a blank document without a client that only its creator can open, also through Agera Office', async () => {
    const r = await api<Doc>(alice, 'POST', '/v1/documents', { title: `Kladblok ${stamp}`, format: 'docx' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.clientId, null);
    assert.equal((await api(alice, 'GET', `/v1/documents/${r.body.id}`)).status, 200);
    const aliceList = await api<Doc[]>(alice, 'GET', '/v1/documents?drafts=true');
    assert.ok(aliceList.body.some((d) => d.id === r.body.id), 'listed under Draft documents for the creator');
    assert.equal((await api(bob, 'GET', `/v1/documents/${r.body.id}`)).status, 404);
    const bobList = await api<Doc[]>(bob, 'GET', '/v1/documents?drafts=true');
    assert.ok(!bobList.body.some((d) => d.id === r.body.id));
    const session = await api<Record<string, unknown>>(alice, 'POST', `/v1/documents/${r.body.id}/session`);
    if (session.status === 503) return; // Agera Office not connected in this environment
    assert.ok([200, 201].includes(session.status), JSON.stringify(session.body));
    const token = String(session.body.accessToken ?? new URL(String(session.body.editorUrl ?? session.body.url)).searchParams.get('access_token'));
    const info = await fetch(`${API_URL}/v1/wopi/files/${r.body.id}?access_token=${encodeURIComponent(token)}`);
    assert.equal(info.status, 200, 'the WOPI host sees the personal document of the token owner');
    const room = await api(alice, 'POST', '/v1/documents', { title: 'x', format: 'docx', clientRoomId: '00000000-0000-4000-8000-000000000000' });
    assert.equal(room.status, 400, 'a client room needs a client');
  });

  it('creates an A5 Agera Memo (docx) when Agera Office is connected', async (t) => {
    const r = await api<Doc>(alice, 'POST', '/v1/documents', {
      title: `Memo – Test ${stamp}`, format: 'docx', memo: { to: 'Team', subject: 'Test', date: '13-11-2026', body: 'Regel 1\nRegel 2', language: 'nl' },
    });
    if (r.status === 503) return t.skip('Agera Office not connected');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.clientId, null);
    const bad = await api(alice, 'POST', '/v1/documents', { title: 'm', format: 'docx', memo: { to: 'x', subject: 's', date: 'd', body: 'b', language: 'fr' } });
    assert.equal(bad.status, 400);
  });

  it('seeds the 7 standard templates in English and Dutch', async () => {
    const r = await api<{ items: { name: string }[] }>(alice, 'GET', '/v1/document-templates');
    assert.equal(r.status, 200);
    const names = new Set(r.body.items.map((x) => x.name));
    for (const n of ['Proposal Cover Letter (EN)', 'Begeleidende brief bij voorstel (NL)', 'Order Confirmation (EN)', 'Orderbevestiging (NL)', 'QBR Invitation (EN)',
      'Uitnodiging kwartaalreview (NL)', 'Price Adjustment Notice (EN)', 'Aankondiging prijsaanpassing (NL)', 'Contract Renewal (EN)', 'Contractverlenging (NL)',
      'Store Audit Summary (EN)', 'Samenvatting winkelaudit (NL)', 'RMA Confirmation (EN)', 'RMA-bevestiging (NL)']) {
      assert.ok(names.has(n), `missing template ${n}`);
    }
  });
});
