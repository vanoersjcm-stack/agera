/** Sovereign pull printing (print_jobs, release code, CUPS/IPP) and Scan-to-Vault. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { API_URL, api, getToken } from './helpers.ts';

const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% scan ${Date.now()}\n%%EOF\n`, 'latin1');
const ippUrl = process.env.CUPS_IPP_URL;

interface Doc { id: string; idmsStatus: string; sha256: string; clientRoomId: string | null; fileFormat: string }
interface Job { id: string; status: string; code: string | null; documentId: string; copies: number }

describe('Print & Scan-to-Vault', () => {
  let alice: string, adam: string, hannah: string, fiona: string, victor: string, devAdmin: string;
  let clientId: string, roomId: string;
  let doc: Doc;
  let job: Job;
  const received: { op: number; format: boolean; body: Buffer }[] = [];
  let stub: Server | null = null;

  before(async () => {
    [alice, adam, hannah, fiona, victor, devAdmin] = await Promise.all([...['alice', 'adam', 'hannah', 'fiona', 'victor'].map((u) => getToken(u, u)), getToken('dev.admin', 'devadmin')]);
    const client = await api<{ id: string }>(alice, 'POST', '/v1/clients', { name: `Scan ${Date.now()}` });
    assert.equal(client.status, 201, JSON.stringify(client.body));
    clientId = client.body.id;
    const room = await api<{ id: string }>(alice, 'POST', '/v1/dsrs', { clientId, roomName: `Scan room ${Date.now()}` });
    assert.equal(room.status, 201, JSON.stringify(room.body));
    roomId = room.body.id;
    if (ippUrl) {
      const port = Number(new URL(ippUrl).port || 631);
      stub = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          received.push({ op: body.readUInt16BE(2), format: body.includes(Buffer.from('application/pdf')), body });
          const reply = Buffer.from([1, 1, 0, 0, 0, 0, 0, 1, 0x03]);
          res.writeHead(200, { 'Content-Type': 'application/ipp' }).end(reply);
        });
      });
      await new Promise<void>((resolve) => stub!.listen(port, resolve));
    }
  });
  after(() => stub?.close());

  const scan = (token: string, file: { data: Buffer; filename: string; type: string }, fields: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.type }), file.filename);
    return fetch(`${API_URL}/v1/documents/scan-ingest`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }).then(async (r) => ({ status: r.status, body: (await r.json()) as Doc & { message?: string } }));
  };

  it('stores a scan as a DRAFT document of the client and room with its SHA-256, and logs it', async () => {
    const r = await scan(adam, { data: pdf, filename: 'delivery-note.pdf', type: 'application/pdf' }, { clientId, clientRoomId: roomId });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    doc = r.body;
    assert.equal(doc.idmsStatus, 'DRAFT');
    assert.equal(doc.clientRoomId, roomId);
    assert.equal(doc.fileFormat, 'pdf');
    assert.equal(doc.sha256, createHash('sha256').update(pdf).digest('hex'));
    const audit = await api<{ items: { action: string; details: { documentId?: string } }[] }>(alice, 'GET', '/audit-logs?limit=100');
    assert.equal(audit.status, 200);
    assert.ok(audit.body.items.some((a) => a.action === 'document.scanned_to_vault' && a.details.documentId === doc.id));
  });

  it('checks file type and content, and the client of another organisation (RLS)', async () => {
    assert.equal((await scan(adam, { data: Buffer.from('hello'), filename: 'note.txt', type: 'text/plain' }, { clientId })).status, 400);
    assert.equal((await scan(adam, { data: pdf, filename: 'photo.png', type: 'image/png' }, { clientId })).status, 400);
    assert.equal((await scan(devAdmin, { data: pdf, filename: 'x.pdf', type: 'application/pdf' }, { clientId })).status, 404);
  });

  it('lets field representatives scan; client contacts get 403', async () => {
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('camera')]);
    const f = await scan(fiona, { data: jpg, filename: 'store-form.jpg', type: 'image/jpeg' }, { clientId, title: 'Signed store form' });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    assert.equal(f.body.idmsStatus, 'DRAFT');
    assert.equal((await scan(victor, { data: pdf, filename: 'x.pdf', type: 'application/pdf' }, { clientId })).status, 403);
  });

  it('queues a pull-print job with a 6-digit code, visible only to its owner and organisation', async () => {
    const q = await api<Job>(adam, 'POST', '/v1/print/queue', { documentId: doc.id, copies: 2 });
    assert.equal(q.status, 201, JSON.stringify(q.body));
    job = q.body;
    assert.equal(job.status, 'queued');
    assert.match(job.code ?? '', /^[0-9]{6}$/);
    assert.ok((await api<Job[]>(adam, 'GET', '/v1/print/jobs')).body.some((j) => j.id === job.id));
    assert.ok(!(await api<Job[]>(hannah, 'GET', '/v1/print/jobs')).body.some((j) => j.id === job.id), 'other user');
    assert.equal((await api(devAdmin, 'POST', '/v1/print/queue', { documentId: doc.id })).status, 404, 'RLS');
    assert.equal((await api(adam, 'POST', '/v1/print/queue', { documentId: doc.id, copies: 50 })).status, 400);
  });

  it('refuses print to field representatives and client contacts (403)', async () => {
    for (const token of [fiona, victor]) {
      assert.equal((await api(token, 'POST', '/v1/print/queue', { documentId: doc.id })).status, 403);
      assert.equal((await api(token, 'POST', '/v1/print/release', { code: job.code })).status, 403);
      assert.equal((await api(token, 'GET', '/v1/print/jobs')).status, 403);
    }
  });

  it('releases only with the owner and the right code, then sends a PDF to the printer over IPP', async () => {
    assert.equal((await api(hannah, 'POST', '/v1/print/release', { code: job.code })).status, 404, 'not the owner');
    const wrong = job.code === '000000' ? '000001' : '000000';
    assert.equal((await api(adam, 'POST', '/v1/print/release', { code: wrong })).status, 404);
    assert.equal((await api(adam, 'POST', '/v1/print/release', { code: 'abc' })).status, 400);
    const status = await api<{ configured: boolean }>(adam, 'GET', '/v1/print/status');
    const r = await api<Job>(adam, 'POST', '/v1/print/release', { code: job.code });
    if (!status.body.configured) {
      assert.equal(r.status, 503);
      return;
    }
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.status, 'released');
    assert.equal(r.body.code, null);
    const printed = received.find((x) => x.op === 0x0002);
    assert.ok(printed, 'Print-Job sent');
    assert.ok(printed.format && printed.body.includes(pdf), 'PDF document attached');
    assert.equal((await api(adam, 'POST', '/v1/print/release', { code: job.code })).status, 404, 'a code works once');
  });
});
