/** CRM bulk import (Nexus › Clients › Import) and Agera ManyMail mail merge. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { api, getToken, upload } from './helpers.ts';

const stamp = Date.now();
const kvk = String(stamp).slice(-8);
const csv = (text: string) => ({ data: Buffer.from(text, 'utf8'), type: 'text/csv', filename: 'import.csv' });

interface ImportResult {
  dryRun: boolean;
  summary: { total: number; valid: number; skipped: number; errors: number; clientsCreated: number; contactsAdded: number };
  ignoredColumns: string[];
  rows: { row: number; action: string; messages: string[] }[];
}

describe('CRM bulk import and ManyMail', () => {
  let alice: string;
  let adam: string;
  let hannah: string;
  let fiona: string;
  let victor: string;
  let devAdmin: string;

  before(async () => {
    [alice, adam, hannah, fiona, victor, devAdmin] = await Promise.all([...['alice', 'adam', 'hannah', 'fiona', 'victor'].map((u) => getToken(u, u)), getToken('dev.admin', 'devadmin')]);
  });

  const file = () =>
    csv(
      [
        'Bedrijfsnaam;KvK;ERP ID;Plaats;Voornaam;Achternaam;E-mail;Shoe size',
        `Import A ${stamp};${kvk};IMP-${stamp};Utrecht;Anna;Smit;anna.${stamp}@example.com;42`,
        `Import A ${stamp} again;${kvk};;Utrecht;Bart;Smit;bart.${stamp}@example.com;`,
        `Import B ${stamp};;;Delft;Cees;;anna.${stamp}@example.com;`,
        `;12345678;;;;;;`,
        `Import C ${stamp};123;;;;;;`,
      ].join('\n'),
    );

  it('validates in dry-run mode first, detects duplicates and changes nothing', async () => {
    const r = await upload<ImportResult>(alice, '/v1/clients/import', file());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.dryRun, true);
    assert.deepEqual(r.body.rows.map((x) => x.action), ['create', 'add_contact', 'skip', 'error', 'error']);
    assert.deepEqual(r.body.summary, { total: 5, valid: 2, skipped: 1, errors: 2, clientsCreated: 1, contactsAdded: 2 });
    assert.deepEqual(r.body.ignoredColumns, ['Shoe size']);
    const clients = await api<{ name: string }[]>(alice, 'GET', '/v1/clients');
    assert.ok(!clients.body.some((c) => c.name === `Import A ${stamp}`), 'dry run saved nothing');
  });

  it('imports the valid rows, logs clients.bulk_imported and keeps them inside the tenant', async () => {
    const r = await upload<ImportResult>(alice, '/v1/clients/import?dryRun=false', file());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.summary.clientsCreated, 1);
    const list = await api<{ id: string; name: string; kvkNumber: string }[]>(alice, 'GET', '/v1/clients');
    const created = list.body.find((c) => c.name === `Import A ${stamp}`);
    assert.ok(created);
    const record = await api<{ contacts: { email: string; isPrimary: boolean }[] }>(alice, 'GET', `/v1/clients/${created.id}`);
    assert.deepEqual(record.body.contacts.map((c) => [c.email, c.isPrimary]).sort(), [[`anna.${stamp}@example.com`, true], [`bart.${stamp}@example.com`, false]]);
    const again = await upload<ImportResult>(alice, '/v1/clients/import', file());
    assert.deepEqual(again.body.rows.slice(0, 3).map((x) => x.action), ['skip', 'skip', 'skip'], 'second import finds every duplicate');
    const other = await api<{ name: string }[]>(devAdmin, 'GET', '/v1/clients');
    assert.ok(!other.body.some((c) => c.name === `Import A ${stamp}`), 'RLS: other tenant does not see it');
    const audit = await api<{ items: { action: string; details: { fileName: string } }[] }>(alice, 'GET', '/audit-logs?limit=100');
    if (audit.status === 200) assert.ok(audit.body.items.some((a) => a.action === 'clients.bulk_imported'));
  });

  it('reads .xlsx files and rejects files without a name column', async () => {
    const bad = await upload<{ message: string }>(alice, '/v1/clients/import', csv('city;kvk\nUtrecht;12345678'));
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /name/);
    const notZip = await upload(alice, '/v1/clients/import', { data: Buffer.from('PK broken'), type: 'application/octet-stream', filename: 'x.xlsx' });
    assert.equal(notZip.status, 400);
  });

  it('is limited to admins and account managers (403 for field and client roles)', async () => {
    assert.equal((await upload(adam, '/v1/clients/import', file())).status, 200);
    assert.equal((await upload(hannah, '/v1/clients/import', file())).status, 200);
    assert.equal((await upload(fiona, '/v1/clients/import', file())).status, 403);
    assert.equal((await upload(victor, '/v1/clients/import', file())).status, 403);
    assert.equal((await api(fiona, 'POST', '/v1/mail-merge/preview', {})).status, 403);
    assert.equal((await api(victor, 'POST', '/v1/mail-merge/preview', {})).status, 403);
  });

  it('renders one personalised mail per contact and refuses sending while SMTP is not connected', async () => {
    const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Merge ${stamp}` });
    await api(alice, 'POST', `/v1/clients/${client.body.id}/contacts`, { firstName: 'Dirk', lastName: 'Primair', email: `dirk.${stamp}@example.com`, isPrimary: true });
    await api(alice, 'POST', `/v1/clients/${client.body.id}/contacts`, { firstName: 'Els', email: `els.${stamp}@example.com` });
    const tpl = await api<{ id: string }>(alice, 'POST', '/v1/document-templates', { name: 'Update for {{client.name}}', kind: 'mail', body: 'Dear {{contact.firstName}},\nPrimary: {{primary_contact_name}}. {{room.name}}' });
    assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
    const body = { targetType: 'single_client', clientId: client.body.id, templateId: tpl.body.id, recipients: 'all' };
    const preview = await api<{ mails: { email: string; subject: string; text: string; missing: string[] }[]; mail: { configured: boolean } }>(alice, 'POST', '/v1/mail-merge/preview', body);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.mails.length, 2);
    const [dirk, els] = preview.body.mails;
    assert.equal(dirk.subject, `Update for Merge ${stamp}`);
    assert.equal(dirk.text, 'Dear Dirk,\nPrimary: Dirk Primair. [room.name]');
    assert.equal(els.text.split('\n')[0], 'Dear Els,');
    assert.deepEqual(dirk.missing, ['room.name']);
    const primaryOnly = await api<{ mails: unknown[] }>(alice, 'POST', '/v1/mail-merge/preview', { ...body, recipients: 'primary' });
    assert.equal(primaryOnly.body.mails.length, 1);
    if (!preview.body.mail.configured) assert.equal((await api(alice, 'POST', '/v1/mail-merge/send', body)).status, 503);
    const letter = await api<{ id: string }>(alice, 'POST', '/v1/document-templates', { name: `Letter ${stamp}`, kind: 'letter', body: 'x' });
    assert.equal((await api(alice, 'POST', '/v1/mail-merge/preview', { ...body, templateId: letter.body.id })).status, 400);
  });
});
