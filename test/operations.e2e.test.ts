/** Wave B (rp-1..rp-5): RetailPower back-office operations — crew, validated hours, fleet, apparel, RMA, stock claims. */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import pg from 'pg';
import { ACME_TEST, api, download, getToken, upload } from './helpers.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const stamp = Date.now();
const base = '/v1/operations';

let alice: string;
let bob: string;
let carol: string;
let aliceId: string;
let bobId: string;
let storeId: string;

/** Application-role connection (the same role the backend uses), so RLS applies. */
async function appDb(): Promise<pg.Client> {
  const c = new pg.Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'symphony_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'agera_symphony',
  });
  await c.connect();
  return c;
}

before(async () => {
  [alice, bob, carol] = await Promise.all([getToken('alice', 'alice'), getToken('bob', 'bob'), getToken('carol', 'carol')]);
  aliceId = (await api<{ id: string }>(alice, 'GET', '/users/me')).body.id;
  bobId = (await api<{ id: string }>(bob, 'GET', '/users/me')).body.id;
  const store = await api<{ id: string }>(alice, 'POST', '/stores', { storeCode: `OP${stamp}`.slice(0, 20), name: `Ops store ${stamp}` });
  assert.equal(store.status, 201, JSON.stringify(store.body));
  storeId = store.body.id;
});

describe('crew directory', () => {
  it('creates and edits a merchandiser profile; one profile per person', async () => {
    const existing = (await api<{ id: string; userId: string }[]>(alice, 'GET', `${base}/crew`)).body.find((c) => c.userId === bobId);
    let id = existing?.id;
    if (!id) {
      const created = await api<{ id: string }>(alice, 'POST', `${base}/crew`, {
        userId: bobId, contractType: 'flex', languages: ['nl', 'en'], brandCertifications: ['Heineken'], availableDays: [1, 3, 5],
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      id = created.body.id;
    }
    assert.equal((await api(alice, 'POST', `${base}/crew`, { userId: bobId })).status, 409);
    assert.equal((await api(alice, 'POST', `${base}/crew`, { userId: bobId, availableDays: [9] })).status, 400);
    assert.equal((await api(alice, 'PATCH', `${base}/crew/${id}`, { availability: 'on_leave', languages: ['nl', 'ar'] })).status, 200);
    const row = (await api<{ id: string; availability: string; languages: string[]; contractType: string }[]>(alice, 'GET', `${base}/crew`)).body.find((c) => c.id === id);
    assert.equal(row?.availability, 'on_leave');
    assert.deepEqual(row?.languages, ['nl', 'ar']);
    await api(alice, 'PATCH', `${base}/crew/${id}`, { availability: 'available' });
  });
});

describe('shifts and validated hours', () => {
  it('clocks in and out with a geofence distance, signs off by someone else and exports the hours', async () => {
    const db = await appDb();
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.current_tenant', $1, true), set_config('app.access_scope', 'internal', true)", [ACME_TEST]);
    const set = await db.query('UPDATE stores SET latitude = 52.370216, longitude = 4.895168 WHERE id = $1', [storeId]);
    await db.query('COMMIT');
    await db.end();
    assert.equal(set.rowCount, 1);
    await api(bob, 'POST', `${base}/shifts/clock-out`, {});
    const inn = await api<{ id: string; geofenceDistanceM: number; storeId: string }>(bob, 'POST', `${base}/shifts/clock-in`, { storeId, lat: 52.3712, lng: 4.8962 });
    assert.equal(inn.status, 201, JSON.stringify(inn.body));
    assert.ok(inn.body.geofenceDistanceM > 50 && inn.body.geofenceDistanceM < 250, String(inn.body.geofenceDistanceM));
    assert.equal((await api(bob, 'POST', `${base}/shifts/clock-in`, { storeId })).status, 409);
    assert.equal((await api<{ id: string }>(bob, 'GET', `${base}/shifts/mine/open`)).body.id, inn.body.id);
    assert.equal((await api(alice, 'PATCH', `${base}/shifts/${inn.body.id}/validation`, { decision: 'approved' })).status, 409, 'running shift');
    const out = await api<{ hours: number }>(bob, 'POST', `${base}/shifts/clock-out`, { lat: 52.3712, lng: 4.8962 });
    assert.equal(out.status, 201);
    assert.equal((await api(bob, 'PATCH', `${base}/shifts/${inn.body.id}/validation`, { decision: 'approved' })).status, 409, 'own hours');
    assert.equal((await api(alice, 'PATCH', `${base}/shifts/${inn.body.id}/validation`, { decision: 'rejected' })).status, 400, 'reason required');
    const ok = await api<{ validationStatus: string; validatedBy: string }>(alice, 'PATCH', `${base}/shifts/${inn.body.id}/validation`, { decision: 'approved' });
    assert.equal(ok.body.validationStatus, 'approved');
    assert.equal(ok.body.validatedBy, aliceId);
    assert.equal((await api(alice, 'PATCH', `${base}/shifts/${inn.body.id}/validation`, { decision: 'approved' })).status, 409, 'already signed off');

    const manual = await api<{ id: string; hours: number }>(alice, 'POST', `${base}/shifts`, {
      userId: bobId, storeId, clockInAt: '2026-01-05T08:00:00Z', clockOutAt: '2026-01-05T16:30:00Z', notes: '=SUM(A1)',
    });
    assert.equal(manual.status, 201, JSON.stringify(manual.body));
    assert.equal(manual.body.hours, 8.5);
    assert.equal((await api(alice, 'POST', `${base}/shifts`, { userId: bobId, clockInAt: '2026-01-05T10:00:00Z', clockOutAt: '2026-01-05T09:00:00Z' })).status, 400);
    assert.ok((await api<{ id: string }[]>(alice, 'GET', `${base}/shifts?status=pending`)).body.some((s) => s.id === manual.body.id));

    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const csv = await download(alice, `${base}/shifts/export.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    const text = csv.data.toString('utf8');
    assert.match(text, /^\uFEFFEmployee;E-mail;Contract;Date;Store/);
    assert.ok(text.includes(`OP${stamp}`.slice(0, 20)), 'approved shift is exported');
    assert.equal((await download(alice, `${base}/shifts/export.csv`)).status, 400);
  });
});

describe('fleet with the four-photo pre-trip check', () => {
  it('only activates a vehicle after four photos', async () => {
    const plate = `T-${stamp}`.slice(0, 20);
    const v = await api<{ id: string; status: string; vehicleId: string }>(alice, 'POST', `${base}/vehicles`, { userId: bobId, vehicleId: plate.toLowerCase(), description: 'VW Caddy' });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    assert.equal(v.body.status, 'pending_check');
    assert.equal(v.body.vehicleId, plate.toUpperCase());
    assert.equal((await api(alice, 'POST', `${base}/vehicles`, { userId: aliceId, vehicleId: plate })).status, 409, 'vehicle already allocated');
    for (const side of ['front', 'back', 'left']) {
      const r = await upload(bob, `${base}/vehicles/${v.body.id}/photos/${side}`, { data: PNG, type: 'image/png', filename: `${side}.png` });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    assert.equal((await upload(bob, `${base}/vehicles/${v.body.id}/photos/roof`, { data: PNG, type: 'image/png', filename: 'x.png' })).status, 400);
    assert.equal((await upload(bob, `${base}/vehicles/${v.body.id}/photos/right`, { data: Buffer.from('not an image'), type: 'image/png', filename: 'x.png' })).status, 400);
    assert.equal((await api(bob, 'POST', `${base}/vehicles/${v.body.id}/check`, {})).status, 400, 'three photos are not enough');
    assert.equal((await api(bob, 'POST', `${base}/vehicles/${v.body.id}/return`)).status, 409);
    await upload(bob, `${base}/vehicles/${v.body.id}/photos/right`, { data: PNG, type: 'image/png', filename: 'right.png' });
    const done = await api<{ status: string; odometerKm: number }>(bob, 'POST', `${base}/vehicles/${v.body.id}/check`, { odometerKm: 12345 });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.status, 'active');
    const photo = await download(alice, `${base}/vehicles/${v.body.id}/photos/front`);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.equal((await upload(bob, `${base}/vehicles/${v.body.id}/photos/front`, { data: PNG, type: 'image/png', filename: 'f.png' })).status, 409, 'check is locked');
    assert.equal((await api<{ status: string }>(alice, 'POST', `${base}/vehicles/${v.body.id}/return`)).body.status, 'returned');
  });
});

describe('apparel, RMA cases and stock-protection claims', () => {
  it('issues and returns apparel', async () => {
    const a = await api<{ id: string }>(alice, 'POST', `${base}/apparel`, { userId: bobId, item: 'polo', size: 'L', quantity: 2 });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((await api(alice, 'POST', `${base}/apparel`, { userId: bobId, item: 'tuxedo' })).status, 400);
    assert.equal((await api(alice, 'POST', `${base}/apparel/${a.body.id}/return`)).status, 201);
    assert.equal((await api(alice, 'POST', `${base}/apparel/${a.body.id}/return`)).status, 409);
  });

  it('numbers RMA cases and enforces the status flow', async () => {
    const r = await api<{ id: string; caseNumber: string; status: string }>(bob, 'POST', `${base}/rma`, { storeId, quantity: 3, reason: 'damaged' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.caseNumber, /^RMA-\d{4}-\d{4,}$/);
    assert.equal((await api(alice, 'PATCH', `${base}/rma/${r.body.id}/status`, { status: 'credited' })).status, 409);
    for (const status of ['approved', 'shipped', 'credited']) {
      assert.equal((await api<{ status: string }>(alice, 'PATCH', `${base}/rma/${r.body.id}/status`, { status })).body.status, status);
    }
    assert.equal((await api(alice, 'PATCH', `${base}/rma/${r.body.id}/status`, { status: 'rejected' })).status, 409);
  });

  it('needs a second person to decide on a stock claim', async () => {
    const c = await api<{ id: string; amount: string }>(bob, 'POST', `${base}/stock-claims`, { storeId, claimType: 'price_protection', quantity: 24, amount: 57.6 });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.amount, '57.60');
    assert.equal((await api(bob, 'PATCH', `${base}/stock-claims/${c.body.id}/status`, { status: 'approved' })).status, 409, 'own claim');
    assert.equal((await api<{ status: string }>(alice, 'PATCH', `${base}/stock-claims/${c.body.id}/status`, { status: 'approved' })).body.status, 'approved');
    assert.equal((await api<{ status: string }>(alice, 'PATCH', `${base}/stock-claims/${c.body.id}/status`, { status: 'paid' })).body.status, 'paid');
  });
});

describe('dashboard, isolation and access', () => {
  it('shows chains, KPIs and photos for the own organisation only', async () => {
    const d = await api<{ kpis: { stores: number; openRma: number }; chains: { stores: number }[]; photos: { url: string }[] }>(alice, 'GET', `${base}/dashboard`);
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.ok(d.body.kpis.stores >= 1);
    assert.ok(Array.isArray(d.body.chains) && Array.isArray(d.body.photos));
    const dev = await getToken('dev.admin', 'devadmin');
    const devRma = (await api<{ storeId: string }[]>(dev, 'GET', `${base}/rma`)).body;
    assert.ok(!devRma.some((r) => r.storeId === storeId), 'another organisation sees no Acme RMA cases');
    assert.equal((await api(dev, 'PATCH', `${base}/rma/${(await api<{ id: string }[]>(alice, 'GET', `${base}/rma`)).body[0].id}/status`, { status: 'approved' })).status, 404);
    assert.equal((await api(dev, 'POST', `${base}/shifts`, { userId: bobId, clockInAt: '2026-01-05T08:00:00Z', clockOutAt: '2026-01-05T09:00:00Z' })).status, 400, 'foreign user');
  });

  it('refuses client contacts (403)', async () => {
    for (const path of ['dashboard', 'crew', 'shifts', 'vehicles', 'apparel', 'rma', 'stock-claims']) {
      assert.equal((await api(carol, 'GET', `${base}/${path}`)).status, 403, path);
    }
  });

  it('keeps every new table behind row-level security', async () => {
    const db = await appDb();
    const empty = await db.query('SELECT count(*)::int AS n FROM shift_logs');
    assert.equal(empty.rows[0].n, 0, 'no rows without a tenant context');
    const { rows } = await db.query(
      `SELECT c.relname, c.relrowsecurity, count(p.polname)::int AS policies FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relname = ANY($1) GROUP BY 1, 2 ORDER BY 1`,
      [['apparel_assignments', 'merchandisers', 'rma_cases', 'shift_logs', 'stock_protection_claims', 'vehicle_allocations']],
    );
    await db.end();
    assert.equal(rows.length, 6);
    for (const r of rows) assert.ok(r.relrowsecurity && r.policies >= 1, r.relname);
  });
});
