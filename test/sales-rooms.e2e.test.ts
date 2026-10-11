import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { ACME_TEST, AGERA_DEV, type ApiResponse, api, getToken, setupUsers, type TestUser } from './helpers.ts';

/**
 * V8: agreements and Digital Sales Rooms with external-client isolation (Keycloak role
 * External_Client + client_id claim), and the Nexus operational anomaly view.
 * Keycloak dev users: carol (client C1), dave (client C2), erin (no client_id), all in Acme Test.
 */

const C1 = 'c1e00000-0000-4000-8000-000000000001';
const C2 = 'c1e00000-0000-4000-8000-000000000002';

interface Agreement {
  id: string;
  tenantId: string;
  clientId: string;
  title: string;
  status: string;
  documentUrl: string;
}

interface Room {
  id: string;
  tenantId: string;
  clientId: string;
  agreementId: string | null;
  roomName: string;
  status: string;
}

interface Anomaly {
  anomalyType: string;
  sourceId: string;
  description: string;
  details: Record<string, unknown>;
}

interface Activity {
  id: string;
  dsrId: string;
  stakeholderEmail: string;
}

interface DsrStatus {
  dsrs: { dsrId: string }[];
}

const doc = (name: string) => `https://docs.agera.example/agreements/${name}.pdf`;

function expectStatus<T>(response: ApiResponse<T>, status: number): T {
  assert.equal(response.status, status, JSON.stringify(response.body));
  return response.body;
}

function dbClient(): pg.Client {
  return new pg.Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'symphony_user',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'agera_symphony',
  });
}

describe('V8: agreements, Digital Sales Rooms and external clients', () => {
  let tenantA: TestUser;
  let alice: TestUser;
  let carol: string;
  let dave: string;
  let erin: string;

  let c1Agreement: Agreement;
  let c2Agreement: Agreement;
  let otherTenantC1Agreement: Agreement;
  let c1Room: Room;
  let c1ArchivedRoom: Room;
  let c2Room: Room;
  let otherTenantC1Room: Room;

  const createAgreement = async (user: TestUser, clientId: string, extra: Record<string, unknown> = {}) =>
    expectStatus(
      await api<Agreement>(user.token, 'POST', '/v1/agreements', {
        clientId,
        title: `Agreement ${randomUUID().slice(0, 8)}`,
        documentUrl: doc(randomUUID().slice(0, 8)),
        ...extra,
      }),
      201,
    );

  const createRoom = async (user: TestUser, clientId: string, agreementId: string | null = null) =>
    expectStatus(
      await api<Room>(user.token, 'POST', '/v1/dsrs', { clientId, roomName: `Room ${randomUUID().slice(0, 8)}`, agreementId }),
      201,
    );

  before(async () => {
    ({ tenantA, alice } = await setupUsers());
    [carol, dave, erin] = await Promise.all([getToken('carol', 'carol'), getToken('dave', 'dave'), getToken('erin', 'erin')]);

    c1Agreement = await createAgreement(alice, C1, { status: 'active' });
    c2Agreement = await createAgreement(alice, C2);
    otherTenantC1Agreement = await createAgreement(tenantA, C1);
    c1Room = await createRoom(alice, C1, c1Agreement.id);
    c1ArchivedRoom = await createRoom(alice, C1);
    expectStatus(await api(alice.token, 'PATCH', `/v1/dsrs/${c1ArchivedRoom.id}/status`, { status: 'archived' }), 200);
    c2Room = await createRoom(alice, C2, c2Agreement.id);
    otherTenantC1Room = await createRoom(tenantA, C1);
  });

  describe('internal users', () => {
    it('creates agreements with defaults and validates input', async () => {
      assert.equal(c2Agreement.status, 'pending_approval');
      assert.equal(c2Agreement.tenantId, ACME_TEST);
      assert.equal(c2Agreement.clientId, C2);
      for (const body of [
        { title: 'x', documentUrl: doc('x') },
        { clientId: 'nope', title: 'x', documentUrl: doc('x') },
        { clientId: C1, title: ' ', documentUrl: doc('x') },
        { clientId: C1, title: 'x', documentUrl: 'ftp://files.example/x.pdf' },
        { clientId: C1, title: 'x', documentUrl: 'not a url' },
        { clientId: C1, title: 'x', documentUrl: doc('x'), status: 'signed' },
      ]) {
        expectStatus(await api(alice.token, 'POST', '/v1/agreements', body), 400);
      }
    });

    it('enforces agreement status transitions', async () => {
      const agreement = await createAgreement(alice, C1);
      const activate = await api<Agreement>(alice.token, 'PATCH', `/v1/agreements/${agreement.id}/status`, { status: 'active' });
      assert.equal(expectStatus(activate, 200).status, 'active');
      expectStatus(await api(alice.token, 'PATCH', `/v1/agreements/${agreement.id}/status`, { status: 'pending_approval' }), 409);
      expectStatus(await api(alice.token, 'PATCH', `/v1/agreements/${agreement.id}/status`, { status: 'expired' }), 200);
      expectStatus(await api(alice.token, 'PATCH', `/v1/agreements/${agreement.id}/status`, { status: 'active' }), 409);
      expectStatus(await api(alice.token, 'PATCH', `/v1/agreements/${agreement.id}/status`, { status: 'bogus' }), 400);
    });

    it('only links a room to an agreement of the same client and tenant', async () => {
      assert.equal(c1Room.agreementId, c1Agreement.id);
      expectStatus(await api(alice.token, 'POST', '/v1/dsrs', { clientId: C1, roomName: 'x', agreementId: c2Agreement.id }), 400);
      expectStatus(
        await api(alice.token, 'POST', '/v1/dsrs', { clientId: C1, roomName: 'x', agreementId: otherTenantC1Agreement.id }),
        400,
      );
      expectStatus(await api(alice.token, 'POST', '/v1/dsrs', { clientId: C1, roomName: '' }), 400);
    });

    it('archives and reactivates rooms', async () => {
      const room = await createRoom(alice, C2);
      assert.equal(expectStatus(await api<Room>(alice.token, 'PATCH', `/v1/dsrs/${room.id}/status`, { status: 'archived' }), 200).status, 'archived');
      assert.equal(expectStatus(await api<Room>(alice.token, 'PATCH', `/v1/dsrs/${room.id}/status`, { status: 'active' }), 200).status, 'active');
    });

    it('sees all clients of its own tenant, filterable by client, and nothing of other tenants', async () => {
      const all = expectStatus(await api<Agreement[]>(alice.token, 'GET', '/v1/agreements'), 200);
      assert.ok(all.some((a) => a.id === c1Agreement.id) && all.some((a) => a.id === c2Agreement.id));
      assert.ok(all.every((a) => a.tenantId === ACME_TEST));
      const c2Only = expectStatus(await api<Room[]>(alice.token, 'GET', `/v1/dsrs?clientId=${C2}`), 200);
      assert.ok(c2Only.length > 0 && c2Only.every((r) => r.clientId === C2));
      const archived = expectStatus(await api<Room[]>(alice.token, 'GET', '/v1/dsrs?status=archived'), 200);
      assert.ok(archived.some((r) => r.id === c1ArchivedRoom.id));
      expectStatus(await api(tenantA.token, 'GET', `/v1/agreements/${c1Agreement.id}`), 404);
      expectStatus(await api(tenantA.token, 'GET', `/v1/dsrs/${c1Room.id}`), 404);
      expectStatus(await api(tenantA.token, 'PATCH', `/v1/dsrs/${c1Room.id}/status`, { status: 'archived' }), 404);
    });
  });

  describe('external users (External_Client)', () => {
    it('only sees its own agreements within its tenant', async () => {
      const rows = expectStatus(await api<Agreement[]>(carol, 'GET', '/v1/agreements'), 200);
      assert.ok(rows.some((a) => a.id === c1Agreement.id));
      assert.ok(rows.every((a) => a.clientId === C1 && a.tenantId === ACME_TEST), JSON.stringify(rows));
      assert.ok(!rows.some((a) => a.id === otherTenantC1Agreement.id));
      const filtered = expectStatus(await api<Agreement[]>(carol, 'GET', `/v1/agreements?clientId=${C2}`), 200);
      assert.equal(filtered.length, 0);
      expectStatus(await api(carol, 'GET', `/v1/agreements/${c2Agreement.id}`), 404);
      expectStatus(await api(carol, 'GET', `/v1/agreements/${otherTenantC1Agreement.id}`), 404);
      expectStatus(await api(dave, 'GET', `/v1/agreements/${c1Agreement.id}`), 404);
    });

    it('only sees its own active rooms', async () => {
      const rows = expectStatus(await api<Room[]>(carol, 'GET', '/v1/dsrs'), 200);
      assert.ok(rows.some((r) => r.id === c1Room.id));
      assert.ok(rows.every((r) => r.clientId === C1 && r.tenantId === ACME_TEST && r.status === 'active'), JSON.stringify(rows));
      for (const id of [c1ArchivedRoom.id, c2Room.id, otherTenantC1Room.id]) {
        expectStatus(await api(carol, 'GET', `/v1/dsrs/${id}`), 404);
      }
      const daveRooms = expectStatus(await api<Room[]>(dave, 'GET', '/v1/dsrs'), 200);
      assert.ok(daveRooms.some((r) => r.id === c2Room.id) && daveRooms.every((r) => r.clientId === C2));
    });

    it('records activities only in its own active rooms, as itself', async () => {
      const activity = expectStatus(
        await api<Activity>(carol, 'POST', '/v1/nexus/dsr-activities', {
          dsrId: c1Room.id,
          stakeholderEmail: 'someone.else@retailer.example',
          activityType: 'opened',
        }),
        201,
      );
      assert.equal(activity.stakeholderEmail, 'carol@retailer.example');
      for (const dsrId of [c2Room.id, c1ArchivedRoom.id, otherTenantC1Room.id, randomUUID()]) {
        expectStatus(
          await api(carol, 'POST', '/v1/nexus/dsr-activities', { dsrId, stakeholderEmail: 'carol@retailer.example', activityType: 'opened' }),
          404,
        );
      }
    });

    it('only sees activity of its own rooms in dsr-status', async () => {
      expectStatus(
        await api(alice.token, 'POST', '/v1/nexus/dsr-activities', { dsrId: c2Room.id, stakeholderEmail: 'buyer@c2.example', activityType: 'view' }),
        201,
      );
      const carolStatus = expectStatus(await api<DsrStatus>(carol, 'GET', '/v1/nexus/dsr-status'), 200);
      assert.ok(carolStatus.dsrs.some((d) => d.dsrId === c1Room.id));
      assert.ok(!carolStatus.dsrs.some((d) => d.dsrId === c2Room.id));
      const aliceStatus = expectStatus(await api<DsrStatus>(alice.token, 'GET', '/v1/nexus/dsr-status'), 200);
      assert.ok(aliceStatus.dsrs.some((d) => d.dsrId === c2Room.id) && aliceStatus.dsrs.some((d) => d.dsrId === c1Room.id));
    });

    it('is denied every endpoint not opened to external users', async () => {
      const denied: [string, string, unknown?][] = [
        ['POST', '/v1/agreements', { clientId: C1, title: 'x', documentUrl: doc('x') }],
        ['PATCH', `/v1/agreements/${c1Agreement.id}/status`, { status: 'expired' }],
        ['POST', '/v1/dsrs', { clientId: C1, roomName: 'x' }],
        ['PATCH', `/v1/dsrs/${c1Room.id}/status`, { status: 'archived' }],
        ['GET', '/v1/nexus/anomalies'],
        ['GET', '/v1/financials/pnl'],
        ['GET', '/v1/financials/models'],
        ['POST', '/v1/nexus/command', { command: 'open dsr', contextRoute: '/' }],
        ['GET', '/work-orders'],
        ['GET', '/stores'],
        ['GET', '/users/me'],
        ['GET', '/audit-logs'],
      ];
      for (const [method, path, body] of denied) {
        assert.equal((await api(carol, method, path, body)).status, 403, `${method} ${path}`);
      }
      expectStatus(await api(carol, 'GET', '/tenants/me'), 200);
      const room = expectStatus(await api<Room>(alice.token, 'GET', `/v1/dsrs/${c1Room.id}`), 200);
      assert.equal(room.status, 'active');
    });

    it('gets nothing without a client_id claim', async () => {
      for (const path of ['/v1/dsrs', '/v1/agreements', '/v1/nexus/dsr-status', '/tenants/me']) {
        assert.equal((await api(erin, 'GET', path)).status, 403, path);
      }
    });
  });

  describe('operational anomalies', () => {
    const db = dbClient();
    const stagnant: Record<string, string> = {};

    async function asInternal<T>(tenantId: string, work: () => Promise<T>, commit = false): Promise<T> {
      await db.query('BEGIN');
      try {
        await db.query(
          `SELECT set_config('app.current_tenant', $1, true), set_config('app.access_scope', 'internal', true)`,
          [tenantId],
        );
        const result = await work();
        await db.query(commit ? 'COMMIT' : 'ROLLBACK');
        return result;
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }

    const insertRoom = async (name: string, ageDays: number, status = 'active'): Promise<string> => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO digital_sales_rooms (tenant_id, client_id, room_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW() - make_interval(days => $5), NOW()) RETURNING id`,
        [ACME_TEST, C1, `${name} ${randomUUID().slice(0, 8)}`, status, ageDays],
      );
      return rows[0].id;
    };

    const insertActivity = (dsrId: string, type: string, ageHours: number) =>
      db.query(
        `INSERT INTO dsr_activities (tenant_id, dsr_id, stakeholder_email, activity_type, created_at)
         VALUES ($1, $2, 'buyer@c1.example', $3, NOW() - make_interval(hours => $4))`,
        [ACME_TEST, dsrId, type, ageHours],
      );

    before(async () => {
      await db.connect();
      await asInternal(
        ACME_TEST,
        async () => {
          stagnant.neverOpened = await insertRoom('never opened', 8);
          stagnant.onlyPassiveRecently = await insertRoom('passive only', 12);
          await insertActivity(stagnant.onlyPassiveRecently, 'briefing_played', 8 * 24 + 1);
          await insertActivity(stagnant.onlyPassiveRecently, 'view', 1);
          stagnant.recentlyViewed = await insertRoom('recent zone view', 10);
          await insertActivity(stagnant.recentlyViewed, 'zone_viewed', 48);
          stagnant.fresh = await insertRoom('fresh', 0);
          stagnant.archivedOld = await insertRoom('archived', 30, 'archived');
        },
        true,
      );
    });

    after(async () => {
      await db.end();
    });

    const anomalies = async (token: string, query = '') =>
      expectStatus(await api<{ anomalies: Anomaly[] }>(token, 'GET', `/v1/nexus/anomalies${query}`), 200).anomalies;

    it('flags unfavourable variances over 10% on approved models only', async () => {
      const model = expectStatus(
        await api<{ id: string }>(alice.token, 'POST', '/v1/financials/models', { modelName: 'Anomalies', fiscalYear: 2031, status: 'approved' }),
        201,
      );
      const draft = expectStatus(
        await api<{ id: string }>(alice.token, 'POST', '/v1/financials/models', { modelName: 'Anomalies draft', fiscalYear: 2031 }),
        201,
      );
      const line = async (modelId: string, category: string, actualAmount: number | null) =>
        expectStatus(
          await api<{ id: string }>(alice.token, 'POST', `/v1/financials/models/${modelId}/line-items`, {
            category,
            periodCode: '2031-01',
            projectedAmount: '1000.00',
            actualAmount,
            currency: 'EUR',
          }),
          201,
        ).id;
      const flagged = { revenueShort: await line(model.id, 'revenue', 850), opexOver: await line(model.id, 'opex', 1200), licenseShort: await line(model.id, 'license_fee', 100) };
      const quiet = {
        revenueSlightlyShort: await line(model.id, 'revenue', 950),
        revenueExactlyTen: await line(model.id, 'revenue', 900),
        revenueAbove: await line(model.id, 'revenue', 1300),
        cogsBelow: await line(model.id, 'cogs', 500),
        noActuals: await line(model.id, 'revenue', null),
        draftModel: await line(draft.id, 'revenue', 500),
      };

      const found = await anomalies(alice.token, '?type=financial_variance');
      const ids = new Set(found.map((a) => a.sourceId));
      for (const [name, id] of Object.entries(flagged)) assert.ok(ids.has(id), name);
      for (const [name, id] of Object.entries(quiet)) assert.ok(!ids.has(id), name);
      const revenue = found.find((a) => a.sourceId === flagged.revenueShort)!;
      assert.equal(revenue.anomalyType, 'financial_variance');
      assert.match(revenue.description, /^P&L variance exceeded 10%: revenue 2031-01 -150\.00 EUR \(-15\.0%\)$/);
      assert.equal(revenue.details.modelId, model.id);
      assert.equal(revenue.details.variance, '-150.00');

      expectStatus(await api(alice.token, 'PATCH', `/v1/financials/models/${draft.id}/status`, { status: 'approved' }), 200);
      assert.ok((await anomalies(alice.token)).some((a) => a.sourceId === quiet.draftModel));

      const otherTenant = new Set((await anomalies(tenantA.token)).map((a) => a.sourceId));
      for (const id of Object.values(flagged)) assert.ok(!otherTenant.has(id));
    });

    it('flags active rooms without stakeholder interaction for more than 7 days', async () => {
      const found = await anomalies(alice.token, '?type=dsr_stagnation');
      const ids = new Set(found.map((a) => a.sourceId));
      assert.ok(ids.has(stagnant.neverOpened), 'never opened');
      assert.ok(ids.has(stagnant.onlyPassiveRecently), 'only non-stakeholder activity recently');
      assert.ok(!ids.has(stagnant.recentlyViewed), 'zone viewed 2 days ago');
      assert.ok(!ids.has(stagnant.fresh), 'new room');
      assert.ok(!ids.has(stagnant.archivedOld), 'archived room');
      assert.ok(!ids.has(c1Room.id), 'opened just now');
      const entry = found.find((a) => a.sourceId === stagnant.neverOpened)!;
      assert.match(entry.description, /^DSR inactive for > 7 days: never opened /);
      assert.equal(entry.details.daysInactive, 8);
      assert.equal(entry.details.lastInteractionAt, null);
      assert.ok(found.every((a) => a.anomalyType === 'dsr_stagnation'));

      const otherTenant = new Set((await anomalies(tenantA.token)).map((a) => a.sourceId));
      assert.ok(!otherTenant.has(stagnant.neverOpened));
      expectStatus(await api(alice.token, 'GET', '/v1/nexus/anomalies?type=other'), 400);
    });

    it('applies row-level security inside the view', async () => {
      const visible = await asInternal(AGERA_DEV, async () =>
        (await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM nexus_operational_anomalies WHERE source_id = $1`, [stagnant.neverOpened])).rows[0].n,
      );
      assert.equal(visible, 0);
      const unscoped = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM nexus_operational_anomalies');
      assert.equal(unscoped.rows[0].n, 0);
    });
  });

  describe('PostgreSQL row-level security for external scope', () => {
    const db = dbClient();

    before(async () => {
      await db.connect();
    });

    after(async () => {
      await db.end();
    });

    async function scoped<T>(settings: Record<string, string>, work: () => Promise<T>): Promise<T> {
      await db.query('BEGIN');
      try {
        for (const [name, value] of Object.entries(settings)) {
          await db.query('SELECT set_config($1, $2, true)', [name, value]);
        }
        return await work();
      } finally {
        await db.query('ROLLBACK');
      }
    }

    const count = async (sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(sql, params)).rows[0].n;
    const external = { 'app.current_tenant': ACME_TEST, 'app.access_scope': 'external', 'app.current_client': C1 };

    it('limits an external client to its own agreements and active rooms', async () => {
      await scoped(external, async () => {
        assert.equal(await count(`SELECT COUNT(*)::int AS n FROM agreements WHERE client_id <> $1`, [C1]), 0);
        assert.ok((await count(`SELECT COUNT(*)::int AS n FROM agreements`)) > 0);
        assert.equal(await count(`SELECT COUNT(*)::int AS n FROM digital_sales_rooms WHERE status <> 'active' OR client_id <> $1`, [C1]), 0);
        assert.equal(await count(`SELECT COUNT(*)::int AS n FROM dsr_activities WHERE dsr_id = $1`, [c2Room.id]), 0);
        assert.equal(await count(`SELECT COUNT(*)::int AS n FROM financial_models`), 0);
        assert.equal(await count(`SELECT COUNT(*)::int AS n FROM nexus_voice_events`), 0);
      });
    });

    it('does not let an external client write agreements or rooms', async () => {
      await scoped(external, async () => {
        await db.query('SAVEPOINT attempt');
        await assert.rejects(
          db.query(`INSERT INTO agreements (tenant_id, client_id, title, document_url) VALUES ($1, $2, 'x', 'https://x')`, [ACME_TEST, C1]),
          (error: { code?: string }) => error.code === '42501',
        );
        await db.query('ROLLBACK TO SAVEPOINT attempt');
        const updated = await db.query(`UPDATE agreements SET status = 'expired' WHERE id = $1`, [c1Agreement.id]);
        assert.equal(updated.rowCount, 0);
        const deleted = await db.query(`DELETE FROM digital_sales_rooms WHERE id = $1`, [c1Room.id]);
        assert.equal(deleted.rowCount, 0);
      });
    });

    it('returns nothing without a valid scope', async () => {
      const cases: Record<string, string>[] = [
        { 'app.current_tenant': ACME_TEST },
        { 'app.current_tenant': ACME_TEST, 'app.access_scope': 'external' },
        { 'app.current_tenant': ACME_TEST, 'app.access_scope': 'apiKey' },
        { 'app.current_tenant': AGERA_DEV, 'app.access_scope': 'external', 'app.current_client': C1 },
      ];
      for (const settings of cases) {
        await scoped(settings, async () => {
          assert.equal(await count(`SELECT COUNT(*)::int AS n FROM agreements WHERE tenant_id = $1`, [ACME_TEST]), 0, JSON.stringify(settings));
          assert.equal(await count(`SELECT COUNT(*)::int AS n FROM digital_sales_rooms WHERE tenant_id = $1`, [ACME_TEST]), 0);
        });
      }
    });
  });
});
