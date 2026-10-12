import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, it, before } from 'node:test';
import { promisify } from 'node:util';
import pg from 'pg';
import { AGERA_DEV, api, getToken, setupUsers, type TestUser } from './helpers.ts';

/**
 * Agera source import (seed/agera/*.json -> tenant agera.local) and the V9 store_compliance anomaly.
 * Requires a backend build (dist/seed/agera-seed.js) and the dev realm users a.visser / rj.meijer.
 */

const run = promisify(execFile);

interface Anomaly {
  anomalyType: string;
  sourceId: string;
  details: Record<string, unknown>;
}

interface Room {
  id: string;
  clientId: string;
  roomName: string;
  status: string;
}

interface Model {
  id: string;
  modelName: string;
  status: string;
}

interface Pnl {
  totals: { category: string; projected: string }[];
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

async function seed(): Promise<string> {
  const { stdout } = await run('node', ['dist/seed/agera-seed.js', '--tenant-domain', 'agera.local'], { env: process.env });
  return stdout;
}

async function counts(): Promise<Record<string, number>> {
  const db = dbClient();
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      "SELECT set_config('app.current_tenant', $1, true), set_config('app.access_scope', 'internal', true)",
      [AGERA_DEV],
    );
    const { rows } = await db.query<Record<string, number>>(`
      SELECT (SELECT count(*)::int FROM users WHERE email LIKE '%@aerobrand.nl') AS users,
             (SELECT count(*)::int FROM stores WHERE tenant_id = $1 AND store_code IN ('MM-AMS-01','MM-RTM-02','BCC-UTR-01','CB-EIN-01')) AS stores,
             (SELECT count(*)::int FROM visit_reports WHERE tenant_id = $1 AND audit_data->>'source' = 'agera-seed') AS reports,
             (SELECT count(*)::int FROM financial_models WHERE metadata->>'source' = 'agera-seed') AS models,
             (SELECT count(*)::int FROM financial_line_items li JOIN financial_models m ON m.id = li.model_id
               WHERE m.metadata->>'source' = 'agera-seed') AS lines,
             (SELECT count(*)::int FROM digital_sales_rooms
               WHERE room_name IN ('Premium Audio Launch Q3/Q4', 'Planogram Compliance & Actieweken')) AS rooms`, [AGERA_DEV]);
    await db.query('COMMIT');
    return rows[0];
  } finally {
    await db.end();
  }
}

describe('Agera seed import and store compliance anomalies', () => {
  let tenantA: TestUser;
  let bob: TestUser;

  before(async () => {
    ({ tenantA, bob } = await setupUsers());
    await seed();
  });

  it('is idempotent: a second run updates in place without duplicating rows', async () => {
    const first = await counts();
    assert.match(await seed(), /4 users, 2 client contracts \+ rooms, 4 stores/);
    assert.deepEqual(await counts(), first);
    assert.deepEqual(first, { users: 4, stores: 4, reports: 4, models: 2, lines: 2, rooms: 2 });
  });

  it('books contract_value_eur as projected revenue of approved models', async () => {
    const models = await api<Model[]>(tenantA.token, 'GET', '/v1/financials/models');
    const technova = models.body.find((m) => m.modelName.startsWith('TechNova Electronics B.V.'));
    assert.ok(technova);
    assert.equal(technova.status, 'approved');
    const pnl = await api<Pnl>(tenantA.token, 'GET', `/v1/financials/pnl?modelId=${technova.id}`);
    assert.equal(pnl.status, 200);
    assert.equal(pnl.body.totals.find((t) => t.category === 'revenue')?.projected, '240000.00');
  });

  it('opens a room per active_project and limits each client contact to their own room', async () => {
    const rooms = await api<Room[]>(tenantA.token, 'GET', '/v1/dsrs');
    const names = rooms.body.map((r) => r.roomName);
    assert.ok(names.includes('Premium Audio Launch Q3/Q4'));
    assert.ok(names.includes('Planogram Compliance & Actieweken'));

    const anouk = await getToken('a.visser', 'a.visser');
    const own = await api<Room[]>(anouk, 'GET', '/v1/dsrs');
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.map((r) => r.roomName), ['Premium Audio Launch Q3/Q4']);
    assert.equal((await api(anouk, 'GET', '/v1/financials/pnl')).status, 403);
    assert.equal((await api(anouk, 'GET', '/v1/nexus/anomalies')).status, 403);

    const robertJan = await getToken('rj.meijer', 'rj.meijer');
    const other = await api<Room[]>(robertJan, 'GET', '/v1/dsrs');
    assert.deepEqual(other.body.map((r) => r.roomName), ['Planogram Compliance & Actieweken']);
  });

  it('reports non-compliant store statuses as store_compliance anomalies, only in their tenant', async () => {
    const res = await api<{ anomalies: Anomaly[] }>(tenantA.token, 'GET', '/v1/nexus/anomalies?type=store_compliance');
    assert.equal(res.status, 200);
    const byCode = new Map(res.body.anomalies.map((a) => [a.details.storeCode, a]));
    assert.equal(byCode.get('MM-AMS-01')?.details.complianceStatus, 'flagged_anomaly');
    assert.equal(byCode.get('MM-AMS-01')?.details.finding, 'Promotiedisplay niet opgebouwd');
    assert.equal(byCode.get('MM-RTM-02')?.details.complianceStatus, 'variance_pending');
    assert.ok(!byCode.has('BCC-UTR-01'));
    assert.ok(!byCode.has('CB-EIN-01'));
    assert.ok(res.body.anomalies.every((a) => a.anomalyType === 'store_compliance'));

    const acme = await api<{ anomalies: Anomaly[] }>(bob.token, 'GET', '/v1/nexus/anomalies?type=store_compliance');
    assert.ok(!acme.body.anomalies.some((a) => a.details.storeCode === 'MM-AMS-01'));
  });

  it('returns no store anomalies without a tenant or with external scope (direct PostgreSQL)', async () => {
    const db = dbClient();
    await db.connect();
    try {
      const none = await db.query("SELECT 1 FROM nexus_operational_anomalies WHERE anomaly_type = 'store_compliance'");
      assert.equal(none.rowCount, 0);
      await db.query('BEGIN');
      await db.query(
        "SELECT set_config('app.current_tenant', $1, true), set_config('app.access_scope', 'external', true), set_config('app.current_client', $2, true)",
        [AGERA_DEV, 'a5400862-a6eb-5d5c-92ed-a822d4b3a47e'],
      );
      const external = await db.query("SELECT 1 FROM nexus_operational_anomalies WHERE anomaly_type = 'store_compliance'");
      assert.equal(external.rowCount, 0);
      await db.query('ROLLBACK');
    } finally {
      await db.end();
    }
  });
});
