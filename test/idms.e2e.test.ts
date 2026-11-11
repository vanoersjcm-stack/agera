/** Phase 2: IDMS lifecycle (DRAFT → IN_REVIEW → FINAL_LOCKED → ARCHIVED_WORM → EXPIRED_PURGE) and the retention/erasure job. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { api, getToken, waitFor } from './helpers.ts';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const stamp = Date.now();
let alice: string;
let adam: string;
let hannah: string;
let fiona: string;
let victor: string;
let clientId: string;
let owner: pg.Client;

interface Transition { idmsStatus: string }
interface Doc { id: string; idmsStatus: string; editable: boolean }
interface Invoice { id: string; idmsStatus: string; status: string; description: string | null }
interface Session { editorUrl: string; accessToken: string }

const move = (token: string, kind: string, id: string, to: string) => api<Transition>(token, 'POST', `/v1/idms/${kind}/${id}/transition`, { to });

async function createInvoice(description: string): Promise<Invoice> {
  const r = await api<Invoice>(hannah, 'POST', '/v1/invoices', { clientId, invoiceNumber: `IDMS-${stamp}-${Math.random().toString(36).slice(2, 8)}`, description, issueDate: '2026-01-15', amountExclVat: '1000.00' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.idmsStatus, 'DRAFT');
  return r.body;
}

async function archive(token: string, kind: string, id: string): Promise<void> {
  for (const to of ['IN_REVIEW', 'FINAL_LOCKED', 'ARCHIVED_WORM']) {
    const r = await move(token, kind, id, to);
    assert.equal(r.status, 201, `${to}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.idmsStatus, to);
  }
}

before(async () => {
  [alice, adam, hannah, fiona, victor] = await Promise.all(['alice', 'adam', 'hannah', 'fiona', 'victor'].map((u) => getToken(u, u)));
  const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `IDMS ${stamp}` });
  assert.equal(client.status, 201, JSON.stringify(client.body));
  clientId = client.body.id;
  owner = new pg.Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'agera',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.DB_NAME ?? 'agera_symphony',
  });
  await owner.connect();
});

after(async () => {
  await owner.end();
});

describe('IDMS lifecycle (Phase 2)', () => {
  it('moves one step forward only and rejects skipped, backward and manual expiry transitions', async () => {
    const inv = await createInvoice('Step test');
    assert.equal((await move(hannah, 'invoices', inv.id, 'FINAL_LOCKED')).status, 409, 'skip');
    assert.equal((await move(hannah, 'invoices', inv.id, 'IN_REVIEW')).status, 201);
    assert.equal((await move(hannah, 'invoices', inv.id, 'DRAFT')).status, 409, 'backward');
    assert.equal((await move(hannah, 'invoices', inv.id, 'IN_REVIEW')).status, 409, 'same');
    assert.equal((await move(hannah, 'invoices', inv.id, 'BOGUS')).status, 400);
    assert.equal((await move(hannah, 'unknown', inv.id, 'FINAL_LOCKED')).status, 400);
    await move(hannah, 'invoices', inv.id, 'FINAL_LOCKED');
    await move(hannah, 'invoices', inv.id, 'ARCHIVED_WORM');
    assert.equal((await move(hannah, 'invoices', inv.id, 'EXPIRED_PURGE')).status, 409, 'only the retention job expires');
    assert.equal((await move(hannah, 'invoices', '00000000-0000-4000-8000-000000000000', 'IN_REVIEW')).status, 404);
  });

  it('also refuses invalid transitions in the database itself', async () => {
    const inv = await createInvoice('Trigger test');
    await assert.rejects(owner.query(`UPDATE invoices SET idms_status = 'ARCHIVED_WORM' WHERE id = $1`, [inv.id]), /cannot move from DRAFT to ARCHIVED_WORM/);
    await archive(hannah, 'invoices', inv.id);
    await assert.rejects(owner.query(`UPDATE invoices SET idms_status = 'EXPIRED_PURGE' WHERE id = $1`, [inv.id]), /only the retention job/);
    await assert.rejects(owner.query(`UPDATE invoices SET amount_excl_vat = 1 WHERE id = $1`, [inv.id]), /ARCHIVED_WORM and cannot be changed/);
    await assert.rejects(owner.query(`DELETE FROM invoices WHERE id = $1`, [inv.id]), /cannot be deleted/);
  });

  it('limits lifecycle actions to account managers (documents, agreements) and HQ admins', async () => {
    const inv = await createInvoice('Role test');
    assert.equal((await move(adam, 'invoices', inv.id, 'IN_REVIEW')).status, 403);
    assert.equal((await move(fiona, 'invoices', inv.id, 'IN_REVIEW')).status, 403);
    assert.equal((await move(victor, 'invoices', inv.id, 'IN_REVIEW')).status, 403);
    const doc = await api<Doc>(adam, 'POST', '/v1/documents', { clientId, title: `Role doc ${stamp}`, format: 'docx' });
    assert.equal(doc.status, 201, JSON.stringify(doc.body));
    assert.equal((await move(adam, 'documents', doc.body.id, 'IN_REVIEW')).status, 201);
    assert.equal((await move(fiona, 'documents', doc.body.id, 'FINAL_LOCKED')).status, 403);
  });

  it('keeps business status changes on FINAL_LOCKED records but freezes their content (403)', async () => {
    const inv = await createInvoice('Lock test');
    await move(hannah, 'invoices', inv.id, 'IN_REVIEW');
    await move(hannah, 'invoices', inv.id, 'FINAL_LOCKED');
    const edit = await api(hannah, 'PATCH', `/v1/invoices/${inv.id}`, { description: 'changed' });
    assert.equal(edit.status, 403, JSON.stringify(edit.body));
    assert.equal((await api(hannah, 'PATCH', `/v1/invoices/${inv.id}/status`, { status: 'issued' })).status, 200);
    await move(hannah, 'invoices', inv.id, 'ARCHIVED_WORM');
    assert.equal((await api(hannah, 'PATCH', `/v1/invoices/${inv.id}/status`, { status: 'paid' })).status, 403);

    const agreement = await api<{ id: string; idmsStatus: string }>(alice, 'POST', '/v1/agreements', { clientId, title: `IDMS agreement ${stamp}`, documentUrl: 'https://example.com/a.pdf' });
    assert.equal(agreement.status, 201, JSON.stringify(agreement.body));
    assert.equal(agreement.body.idmsStatus, 'DRAFT');
    await move(adam, 'agreements', agreement.body.id, 'IN_REVIEW');
    await move(adam, 'agreements', agreement.body.id, 'FINAL_LOCKED');
    assert.equal((await api(alice, 'PATCH', `/v1/agreements/${agreement.body.id}`, { title: 'changed' })).status, 403);
  });

  it('shows only DRAFT documents under drafts and opens FINAL_LOCKED / ARCHIVED_WORM documents read-only (WOPI 403, logged)', async () => {
    const created = await api<Doc>(alice, 'POST', '/v1/documents', { clientId, title: `Locked ${stamp}`, format: 'docx' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    const drafts = async () => (await api<Doc[]>(alice, 'GET', '/v1/documents?drafts=true')).body;
    assert.ok((await drafts()).some((d) => d.id === id));
    assert.ok((await drafts()).every((d) => d.idmsStatus === 'DRAFT'));
    await move(alice, 'documents', id, 'IN_REVIEW');
    assert.ok(!(await drafts()).some((d) => d.id === id), 'no longer a draft');

    for (const to of ['FINAL_LOCKED', 'ARCHIVED_WORM']) {
      await move(alice, 'documents', id, to);
      const view = await api<Doc>(alice, 'GET', `/v1/documents/${id}`);
      assert.equal(view.body.editable, false);
      const session = await api<Session>(alice, 'POST', `/v1/documents/${id}/session`);
      assert.equal(session.status, 200, JSON.stringify(session.body));
      const src = new URL(new URL(session.body.editorUrl, 'http://x').searchParams.get('WOPISrc')!);
      const url = `${BASE}${src.pathname.replace(/^\/api/, '')}`;
      const token = encodeURIComponent(session.body.accessToken);
      const info = await fetch(`${url}?access_token=${token}`).then((r) => r.json());
      assert.equal(info.UserCanWrite, false, to);
      assert.equal(info.ReadOnly, true, to);
      const put = await fetch(`${url}/contents?access_token=${token}`, { method: 'POST', body: Buffer.from('PK changed') });
      assert.equal(put.status, 403, to);
      const lock = await fetch(`${url}?access_token=${token}`, { method: 'POST', headers: { 'X-WOPI-Override': 'LOCK', 'X-WOPI-Lock': 'L1' } });
      assert.equal(lock.status, 403, to);
      for (const op of ['RENAME_FILE', 'DELETE']) {
        const r = await fetch(`${url}?access_token=${token}`, { method: 'POST', headers: { 'X-WOPI-Override': op, 'X-WOPI-RequestedName': 'renamed' } });
        assert.equal(r.status, 403, `${to} ${op}`);
      }
      // The audit write is fire-and-forget; wait until it lands.
      await waitFor(async () => {
        const { rows } = await owner.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'access.denied' AND details->>'documentId' = $1`, [id]);
        return rows[0].n >= (to === 'FINAL_LOCKED' ? 4 : 8) ? true : undefined;
      });
    }
    await assert.rejects(owner.query('DELETE FROM room_documents WHERE id = $1', [id]), /cannot be deleted/);
  });

  it('expires archived records past retention, pseudonymises them and logs each purge in an intact hash chain', async () => {
    const policies = await api<{ documentClass: string; wormRetentionYears: number; erasureMode: string }[]>(hannah, 'GET', '/v1/idms/retention-policies');
    assert.equal(policies.status, 200);
    assert.deepEqual(policies.body.map((p) => p.documentClass), ['invoice', 'agreement', 'financial_plan', 'office_doc', 'visit_report', 'survey_response']);
    const invoicePolicy = policies.body.find((p) => p.documentClass === 'invoice')!;
    assert.equal(invoicePolicy.erasureMode, 'pseudonymize');
    assert.equal((await api(adam, 'PUT', '/v1/idms/retention-policies/invoice', { wormRetentionYears: 7, erasureMode: 'pseudonymize' })).status, 403);
    assert.equal((await api(hannah, 'PUT', '/v1/idms/retention-policies/invoice', { wormRetentionYears: 0, erasureMode: 'pseudonymize' })).status, 400);
    assert.equal((await api(hannah, 'PUT', '/v1/idms/retention-policies/invoice', { wormRetentionYears: 7, erasureMode: 'pseudonymize' })).status, 200);

    const inv = await createInvoice('Contact: Jan Jansen, jan@example.com');
    await archive(hannah, 'invoices', inv.id);
    // Pretend the record was archived eight years ago (bypassing the WORM trigger as the database owner).
    await owner.query('BEGIN');
    await owner.query('SET LOCAL session_replication_role = replica');
    await owner.query(`UPDATE invoices SET idms_archived_at = NOW() - interval '8 years' WHERE id = $1`, [inv.id]);
    await owner.query('COMMIT');

    const run = await api<{ expired: number; pseudonymized: number }>(hannah, 'POST', '/v1/idms/retention/run');
    assert.equal(run.status, 201, JSON.stringify(run.body));
    assert.ok(run.body.expired >= 1 && run.body.pseudonymized >= 1, JSON.stringify(run.body));
    const after = await api<Invoice>(hannah, 'GET', `/v1/invoices/${inv.id}`);
    assert.equal(after.body.idmsStatus, 'EXPIRED_PURGE');
    assert.equal(after.body.description, null, 'personal data removed');
    assert.equal(after.body.status, 'draft', 'financial record kept');

    const rows = await waitFor(async () => {
      const r = await owner.query(`SELECT details FROM audit_logs WHERE action = 'idms.purged' AND details->>'recordId' = $1`, [inv.id]);
      return r.rows.length ? r.rows : undefined;
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].details.mode, 'pseudonymize');
    const chain = await api<{ intact: boolean }>(hannah, 'GET', '/audit-logs/verify');
    assert.equal(chain.status, 200);
    assert.equal(chain.body.intact, true, JSON.stringify(chain.body));
  });
});
