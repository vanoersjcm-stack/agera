import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';
import {
  ACME_TEST,
  api,
  download,
  nextMillisecond,
  setupUsers,
  type TestUser,
  upload,
  waitFor,
} from './helpers.ts';

interface Visit {
  id: string;
  status: string;
  updatedAt: string;
}

interface Report {
  id: string;
  tenantId: string;
  visitId: string;
  summary: string | null;
  auditData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Media {
  id: string;
  visitId: string;
  mimeType: string;
  fileSizeBytes: number;
  url: string;
  createdAt: string;
}

interface Summary {
  visit: Visit & { storeId: string; tenantId: string };
  report: Report | null;
  media: Media[];
}

const MAX_BYTES = 10 * 1024 * 1024;
// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 1), Buffer.from([0xff, 0xd9])]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(16)]);

const png = (filename = 'shelf.png') => ({ data: PNG, type: 'image/png', filename });

const run = randomUUID().slice(0, 8);
let tenantA: TestUser;
let alice: TestUser;
let bob: TestUser;
let storeCounter = 0;

async function createVisit(user: TestUser): Promise<Visit> {
  const store = await api<{ id: string }>(user.token, 'POST', '/stores', {
    storeCode: `R-${run}-${++storeCounter}`,
    name: 'Report store',
  });
  assert.equal(store.status, 201);
  const visit = await api<Visit>(user.token, 'POST', '/visits', {
    storeId: store.body.id,
    visitDate: '2026-11-03T10:00:00Z',
  });
  assert.equal(visit.status, 201);
  return visit.body;
}

async function getSummary(user: TestUser, visitId: string): Promise<Summary> {
  const { status, body } = await api<Summary>(user.token, 'GET', `/visits/${visitId}/summary`);
  assert.equal(status, 200);
  return body;
}

before(async () => {
  ({ tenantA, alice, bob } = await setupUsers());
});

describe('authentication', () => {
  it('rejects unauthenticated report, media and summary requests with 401', async () => {
    const id = randomUUID();
    assert.equal((await api(null, 'POST', `/visits/${id}/report`, { summary: 'x' })).status, 401);
    assert.equal((await upload(null, `/visits/${id}/media`, png())).status, 401);
    assert.equal((await download(null, `/visits/${id}/media/${randomUUID()}`)).status, 401);
    assert.equal((await api(null, 'GET', `/visits/${id}/summary`)).status, 401);
  });
});

describe('POST /visits/:id/report', () => {
  it('creates the report (201), then replaces it (200) and bumps the visit for delta sync', async () => {
    const visit = await createVisit(alice);
    await nextMillisecond();

    const created = await api<Report>(alice.token, 'POST', `/visits/${visit.id}/report`, {
      summary: 'Shelf restocked',
      auditData: { facings: 12, priceTagsOk: true, outOfStock: ['SKU-1'] },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.tenantId, ACME_TEST);
    assert.equal(created.body.visitId, visit.id);
    assert.deepEqual(created.body.auditData, { facings: 12, priceTagsOk: true, outOfStock: ['SKU-1'] });

    const delta = await api<{ items: Visit[] }>(
      alice.token,
      'GET',
      `/visits?limit=100&updatedSince=${encodeURIComponent(visit.updatedAt)}`,
    );
    assert.ok(delta.body.items.some((v) => v.id === visit.id));

    await nextMillisecond();
    const replaced = await api<Report>(bob.token, 'POST', `/visits/${visit.id}/report`, { auditData: { facings: 9 } });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.body.id, created.body.id);
    assert.equal(replaced.body.summary, null);
    assert.deepEqual(replaced.body.auditData, { facings: 9 });
    assert.equal(replaced.body.createdAt, created.body.createdAt);
    assert.ok(replaced.body.updatedAt > created.body.updatedAt);

    const entry = await waitFor(async () => {
      const audit = await api<{ items: { action: string; details: Record<string, unknown> }[] }>(
        alice.token,
        'GET',
        '/audit-logs?limit=100',
      );
      return audit.body.items.find(
        (a) => a.action === 'visit.report_saved' && a.details.visitId === visit.id && a.details.created === false,
      );
    });
    assert.equal(entry.details.reportId, created.body.id);
  });

  it('defaults auditData to {} and validates input', async () => {
    const visit = await createVisit(alice);
    const empty = await api<Report>(alice.token, 'POST', `/visits/${visit.id}/report`, {});
    assert.equal(empty.status, 201);
    assert.deepEqual(empty.body.auditData, {});

    for (const body of [{ auditData: [1, 2] }, { auditData: null }, { auditData: 'x' }, { summary: 42 }]) {
      assert.equal((await api(alice.token, 'POST', `/visits/${visit.id}/report`, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await api(alice.token, 'POST', `/visits/${randomUUID()}/report`, {})).status, 404);
    assert.equal((await api(alice.token, 'POST', '/visits/nope/report', {})).status, 400);
  });
});

describe('POST /visits/:id/media and GET /visits/:id/media/:mediaId', () => {
  it('stores JPEG, PNG and WebP photos and serves them back unchanged', async () => {
    const visit = await createVisit(alice);
    for (const [data, type, name] of [
      [PNG, 'image/png', 'a.png'],
      [JPEG, 'image/jpeg', 'b.jpg'],
      [WEBP, 'image/webp', 'c.webp'],
    ] as const) {
      const uploaded = await upload<Media>(alice.token, `/visits/${visit.id}/media`, { data, type, filename: name });
      assert.equal(uploaded.status, 201, name);
      assert.equal(uploaded.body.mimeType, type);
      assert.equal(uploaded.body.fileSizeBytes, data.length);
      assert.equal(uploaded.body.url, `/visits/${visit.id}/media/${uploaded.body.id}`);

      const file = await download(bob.token, uploaded.body.url);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get('content-type'), type);
      assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(file.data.equals(data));
    }
  });

  it('rejects non-images, spoofed content types, missing files and files over 10 MB with 400', async () => {
    const visit = await createVisit(alice);
    const path = `/visits/${visit.id}/media`;
    const text = Buffer.from('just some text');
    assert.equal((await upload(alice.token, path, { data: text, type: 'text/plain', filename: 'a.txt' })).status, 400);
    assert.equal((await upload(alice.token, path, { data: text, type: 'image/png', filename: 'fake.png' })).status, 400);
    assert.equal((await upload(alice.token, path, { data: PNG, type: 'application/pdf', filename: 'a.pdf' })).status, 400);
    assert.equal((await upload(alice.token, path, { data: Buffer.alloc(0), type: 'image/png', filename: 'e.png' })).status, 400);
    assert.equal((await upload(alice.token, path)).status, 400);

    const tooBig = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(MAX_BYTES - 3)]);
    const oversized = await upload<{ message: string }>(alice.token, path, { data: tooBig, type: 'image/jpeg', filename: 'big.jpg' });
    assert.equal(oversized.status, 400);
    assert.match(oversized.body.message, /10 MB/);

    assert.deepEqual((await getSummary(alice, visit.id)).media, []);

    const maxSize = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(MAX_BYTES - 4)]);
    const accepted = await upload<Media>(alice.token, path, { data: maxSize, type: 'image/jpeg', filename: 'max.jpg' });
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.fileSizeBytes, MAX_BYTES);
  });

  it('returns 404 for unknown media and for media requested under another visit', async () => {
    const first = await createVisit(alice);
    const second = await createVisit(alice);
    const { body: media } = await upload<Media>(alice.token, `/visits/${first.id}/media`, png());
    assert.equal((await download(alice.token, `/visits/${second.id}/media/${media.id}`)).status, 404);
    assert.equal((await download(alice.token, `/visits/${first.id}/media/${randomUUID()}`)).status, 404);
    assert.equal((await upload(alice.token, `/visits/${randomUUID()}/media`, png())).status, 404);
  });
});

describe('cancelled visits', () => {
  it('reject new reports and media with 409', async () => {
    const visit = await createVisit(alice);
    await api(alice.token, 'PATCH', `/visits/${visit.id}/status`, { status: 'CANCELLED' });
    assert.equal((await api(alice.token, 'POST', `/visits/${visit.id}/report`, { summary: 'late' })).status, 409);
    assert.equal((await upload(alice.token, `/visits/${visit.id}/media`, png())).status, 409);
  });
});

describe('tenant isolation', () => {
  it('hides tenant B reports, media and summaries from tenant A (404) and blocks writes', async () => {
    const tenantBVisit = await createVisit(alice);
    await api(alice.token, 'POST', `/visits/${tenantBVisit.id}/report`, { summary: 'B only' });
    const { body: tenantBMedia } = await upload<Media>(alice.token, `/visits/${tenantBVisit.id}/media`, png());
    const tenantAVisit = await createVisit(tenantA);

    assert.equal((await api(tenantA.token, 'GET', `/visits/${tenantBVisit.id}/summary`)).status, 404);
    assert.equal((await download(tenantA.token, tenantBMedia.url)).status, 404);
    assert.equal((await download(tenantA.token, `/visits/${tenantAVisit.id}/media/${tenantBMedia.id}`)).status, 404);
    assert.equal((await upload(tenantA.token, `/visits/${tenantBVisit.id}/media`, png())).status, 404);
    assert.equal((await api(tenantA.token, 'POST', `/visits/${tenantBVisit.id}/report`, { summary: 'overwrite' })).status, 404);

    const unchanged = await getSummary(bob, tenantBVisit.id);
    assert.equal(unchanged.report?.summary, 'B only');
    assert.deepEqual(unchanged.media.map((m) => m.id), [tenantBMedia.id]);
    assert.equal((await getSummary(tenantA, tenantAVisit.id)).media.length, 0);
  });
});

describe('GET /visits/:id/summary', () => {
  it('returns the visit with its report and media references, oldest media first', async () => {
    const visit = await createVisit(alice);
    const empty = await getSummary(alice, visit.id);
    assert.equal(empty.visit.id, visit.id);
    assert.equal(empty.report, null);
    assert.deepEqual(empty.media, []);

    const { body: report } = await api<Report>(alice.token, 'POST', `/visits/${visit.id}/report`, {
      summary: 'All good',
      auditData: { score: 5 },
    });
    const { body: first } = await upload<Media>(alice.token, `/visits/${visit.id}/media`, png('1.png'));
    await nextMillisecond();
    const { body: second } = await upload<Media>(bob.token, `/visits/${visit.id}/media`, png('2.png'));

    const summary = await getSummary(bob, visit.id);
    assert.equal(summary.visit.tenantId, ACME_TEST);
    assert.ok(summary.visit.updatedAt > visit.updatedAt);
    assert.deepEqual(summary.report, report);
    assert.deepEqual(summary.media, [first, second]);
    assert.equal((await api(alice.token, 'GET', `/visits/${randomUUID()}/summary`)).status, 404);
  });
});
