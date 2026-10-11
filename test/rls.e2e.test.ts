import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { ACME_TEST, AGERA_DEV, API_URL, type ApiResponse, api, setupUsers, type TestUser } from './helpers.ts';

/**
 * Phase 10: strict tenant isolation for financial_models, financial_line_items, dsr_activities and
 * nexus_voice_events, checked through the API and directly against PostgreSQL row-level security
 * using the application's own database role.
 */

interface Model {
  id: string;
  tenantId: string;
  fiscalYear: number;
  status: string;
}

interface LineItem {
  id: string;
  tenantId: string;
  modelId: string;
  projectedAmount: string;
  actualAmount: string | null;
  variance: string | null;
}

interface PnlAggregate {
  periodCode: string | null;
  category: string;
  currency: string;
  lineCount: number;
  projected: string;
  actual: string | null;
  variance: string | null;
  variancePercent: number | null;
}

interface Pnl {
  rows: PnlAggregate[];
  totals: PnlAggregate[];
}

interface Activity {
  id: string;
  tenantId: string;
  dsrId: string;
}

interface DsrStatus {
  summary: { activeDsrs: number; stakeholders: number; accepted: number; rejected: number; pending: number };
  dsrs: {
    dsrId: string;
    activityCount: number;
    activityCounts: Record<string, number>;
    stakeholders: { email: string; status: string; activityCount: number; lastActivityType: string }[];
  }[];
}

interface VoiceEvent {
  id: string;
  tenantId: string;
  status: string;
  audioMimeType: string;
  audioSizeBytes: number;
  contextRoute: string;
}

interface CommandResult {
  intent: string;
  navigateTo: string | null;
  parameters: Record<string, string>;
  context: { tenantId: string; userId: string; contextRoute: string };
}

interface TenantRows {
  model: Model;
  lineItem: LineItem;
  activity: Activity;
  voiceEvent: VoiceEvent;
}

const RLS_TABLES = ['financial_models', 'financial_line_items', 'dsr_activities', 'nexus_voice_events'] as const;

/** Minimal 16-bit mono PCM WAV clip. */
function wavClip(samples = 800): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + samples * 2, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(samples * 2, 40);
  return Buffer.concat([header, Buffer.alloc(samples * 2)]);
}

async function uploadVoice<T>(
  token: string,
  file: { data: Buffer; type: string } | null,
  contextRoute: string | null,
): Promise<ApiResponse<T>> {
  const form = new FormData();
  if (contextRoute !== null) {
    form.append('contextRoute', contextRoute);
  }
  if (file) {
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.type }), 'clip');
  }
  const response = await fetch(`${API_URL}/v1/nexus/voice-event`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function createRows(user: TestUser, fiscalYear: number, currency: string, dsrId: string): Promise<TenantRows> {
  const model = await api<Model>(user.token, 'POST', '/v1/financials/models', {
    modelName: `RLS ${currency} ${randomUUID().slice(0, 8)}`,
    fiscalYear,
    status: 'approved',
  });
  assert.equal(model.status, 201);
  const lineItem = await api<LineItem>(user.token, 'POST', `/v1/financials/models/${model.body.id}/line-items`, {
    category: 'revenue',
    periodCode: `${fiscalYear}-Q1`,
    projectedAmount: '1000.00',
    actualAmount: 1100,
    currency,
  });
  assert.equal(lineItem.status, 201);
  const activity = await api<Activity>(user.token, 'POST', '/v1/nexus/dsr-activities', {
    dsrId,
    stakeholderEmail: `buyer@${currency.toLowerCase()}.example`,
    activityType: 'view',
  });
  assert.equal(activity.status, 201);
  const voiceEvent = await uploadVoice<VoiceEvent>(user.token, { data: wavClip(), type: 'audio/wav' }, '/dsr');
  assert.equal(voiceEvent.status, 201);
  return { model: model.body, lineItem: lineItem.body, activity: activity.body, voiceEvent: voiceEvent.body };
}

describe('Phase 10: financials, DSR activity and Nexus voice events (RLS)', () => {
  let tenantA: TestUser;
  let alice: TestUser;
  let a: TenantRows;
  let b: TenantRows;
  const fiscalYear = randomInt(2030, 2100);
  const dsrA = randomUUID();
  const dsrB = randomUUID();

  before(async () => {
    ({ tenantA, alice } = await setupUsers());
    a = await createRows(tenantA, fiscalYear, 'EUR', dsrA);
    b = await createRows(alice, fiscalYear, 'CHF', dsrB);
  });

  describe('API isolation', () => {
    it('stamps rows with the caller tenant', () => {
      for (const row of [a.model, a.lineItem, a.activity, a.voiceEvent]) {
        assert.equal(row.tenantId, AGERA_DEV);
      }
      for (const row of [b.model, b.lineItem, b.activity, b.voiceEvent]) {
        assert.equal(row.tenantId, ACME_TEST);
      }
    });

    it('hides another tenant\'s financial models and line items (404)', async () => {
      const id = b.model.id;
      assert.equal((await api(tenantA.token, 'GET', `/v1/financials/models/${id}`)).status, 404);
      assert.equal((await api(tenantA.token, 'GET', `/v1/financials/models/${id}/line-items`)).status, 404);
      assert.equal((await api(tenantA.token, 'GET', `/v1/financials/pnl?modelId=${id}`)).status, 404);
      const listed = await api<Model[]>(tenantA.token, 'GET', `/v1/financials/models?fiscalYear=${fiscalYear}`);
      assert.equal(listed.status, 200);
      assert.ok(listed.body.some((model) => model.id === a.model.id));
      assert.ok(!listed.body.some((model) => model.id === id));
    });

    it('refuses writes to another tenant\'s financial rows and leaves them unchanged', async () => {
      const patchModel = await api(tenantA.token, 'PATCH', `/v1/financials/models/${b.model.id}/status`, {
        status: 'archived',
      });
      assert.equal(patchModel.status, 404);
      const addLine = await api(tenantA.token, 'POST', `/v1/financials/models/${b.model.id}/line-items`, {
        category: 'opex',
        periodCode: `${fiscalYear}-01`,
        projectedAmount: 1,
      });
      assert.equal(addLine.status, 404);
      const patchLine = await api(tenantA.token, 'PATCH', `/v1/financials/line-items/${b.lineItem.id}`, {
        actualAmount: 0,
      });
      assert.equal(patchLine.status, 404);

      const model = await api<Model>(alice.token, 'GET', `/v1/financials/models/${b.model.id}`);
      assert.equal(model.body.status, 'approved');
      const lines = await api<LineItem[]>(alice.token, 'GET', `/v1/financials/models/${b.model.id}/line-items`);
      assert.deepEqual(
        lines.body.map((line) => [line.id, line.actualAmount]),
        [[b.lineItem.id, '1100.00']],
      );
    });

    it('aggregates the P&L only over the caller tenant', async () => {
      const pnlA = await api<Pnl>(tenantA.token, 'GET', `/v1/financials/pnl?fiscalYear=${fiscalYear}`);
      assert.equal(pnlA.status, 200);
      assert.ok(pnlA.body.rows.length > 0);
      assert.ok([...pnlA.body.rows, ...pnlA.body.totals].every((row) => row.currency === 'EUR'));
      const pnlB = await api<Pnl>(alice.token, 'GET', `/v1/financials/pnl?fiscalYear=${fiscalYear}`);
      assert.ok([...pnlB.body.rows, ...pnlB.body.totals].every((row) => row.currency === 'CHF'));
    });

    it('hides another tenant\'s DSR activity from dsr-status', async () => {
      const asA = await api<DsrStatus>(tenantA.token, 'GET', `/v1/nexus/dsr-status?dsrId=${dsrB}`);
      assert.equal(asA.status, 200);
      assert.equal(asA.body.dsrs.length, 0);
      const all = await api<DsrStatus>(tenantA.token, 'GET', '/v1/nexus/dsr-status');
      assert.ok(all.body.dsrs.some((dsr) => dsr.dsrId === dsrA));
      assert.ok(!all.body.dsrs.some((dsr) => dsr.dsrId === dsrB));
      const asB = await api<DsrStatus>(alice.token, 'GET', `/v1/nexus/dsr-status?dsrId=${dsrB}`);
      assert.equal(asB.body.dsrs.length, 1);
    });

    it('hides another tenant\'s voice events (404)', async () => {
      assert.equal((await api(tenantA.token, 'GET', `/v1/nexus/voice-events/${b.voiceEvent.id}`)).status, 404);
      const own = await api<VoiceEvent>(alice.token, 'GET', `/v1/nexus/voice-events/${b.voiceEvent.id}`);
      assert.equal(own.status, 200);
    });
  });

  describe('financial variance', () => {
    it('computes variance per line, and leaves it empty until actuals are recorded', async () => {
      assert.equal(a.lineItem.variance, '100.00');
      const created = await api<LineItem>(tenantA.token, 'POST', `/v1/financials/models/${a.model.id}/line-items`, {
        category: 'opex',
        subcategory: 'Field team',
        periodCode: `${fiscalYear}-02`,
        projectedAmount: 400.5,
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.actualAmount, null);
      assert.equal(created.body.variance, null);

      const updated = await api<LineItem>(tenantA.token, 'PATCH', `/v1/financials/line-items/${created.body.id}`, {
        actualAmount: '350.25',
      });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.variance, '-50.25');
    });

    it('aggregates per period and category, counting variance only over lines with actuals', async () => {
      const model = await api<Model>(tenantA.token, 'POST', '/v1/financials/models', {
        modelName: 'Variance check',
        fiscalYear,
      });
      const add = (periodCode: string, projectedAmount: string, actualAmount?: string): Promise<ApiResponse<LineItem>> =>
        api<LineItem>(tenantA.token, 'POST', `/v1/financials/models/${model.body.id}/line-items`, {
          category: 'revenue',
          periodCode,
          projectedAmount,
          actualAmount,
        });
      await add(`${fiscalYear}-01`, '100.00', '120.00');
      await add(`${fiscalYear}-02`, '200.00');
      await add(`${fiscalYear}-Q2`, '50.00', '40.00');

      const quarter = await api<Pnl>(tenantA.token, 'GET', `/v1/financials/pnl?modelId=${model.body.id}&period=${fiscalYear}-Q1`);
      assert.equal(quarter.status, 200);
      assert.deepEqual(
        quarter.body.rows.map((row) => [row.periodCode, row.projected, row.actual, row.variance]),
        [
          [`${fiscalYear}-01`, '100.00', '120.00', '20.00'],
          [`${fiscalYear}-02`, '200.00', null, null],
        ],
      );
      assert.equal(quarter.body.totals.length, 1);
      assert.deepEqual(
        { ...quarter.body.totals[0] },
        {
          periodCode: null,
          category: 'revenue',
          currency: 'EUR',
          lineCount: 2,
          projected: '300.00',
          actual: '120.00',
          variance: '20.00',
          variancePercent: 20,
        },
      );

      const year = await api<Pnl>(tenantA.token, 'GET', `/v1/financials/pnl?modelId=${model.body.id}&period=${fiscalYear}`);
      assert.equal(year.body.rows.length, 3);
      assert.equal(year.body.totals[0].variance, '10.00');

      const draftExcluded = await api<Pnl>(tenantA.token, 'GET', `/v1/financials/pnl?fiscalYear=${fiscalYear}`);
      assert.ok(!draftExcluded.body.totals.some((row) => row.projected === '350.00'));
    });

    it('rejects invalid input', async () => {
      const bad = [
        { category: 'tax', periodCode: `${fiscalYear}-01`, projectedAmount: 1 },
        { category: 'revenue', periodCode: `${fiscalYear}-13`, projectedAmount: 1 },
        { category: 'revenue', periodCode: `${fiscalYear}-01`, projectedAmount: '1.234' },
        { category: 'revenue', periodCode: `${fiscalYear}-01`, projectedAmount: 1, currency: 'eur' },
      ];
      for (const body of bad) {
        const response = await api(tenantA.token, 'POST', `/v1/financials/models/${a.model.id}/line-items`, body);
        assert.equal(response.status, 400, JSON.stringify(body));
      }
      assert.equal((await api(tenantA.token, 'GET', '/v1/financials/pnl?period=2026-Q5')).status, 400);
    });
  });

  describe('DSR status', () => {
    it('reports per-stakeholder status from the latest terms decision', async () => {
      const dsrId = randomUUID();
      const record = (email: string, activityType: string): Promise<ApiResponse<Activity>> =>
        api<Activity>(alice.token, 'POST', '/v1/nexus/dsr-activities', { dsrId, stakeholderEmail: email, activityType });
      await record('Buyer@Retailer.example', 'view');
      await record('buyer@retailer.example', 'terms_accepted');
      await record('cfo@retailer.example', 'download');
      await record('cfo@retailer.example', 'opened');
      await record('cfo@retailer.example', 'zone_viewed');
      await record('cfo@retailer.example', 'briefing_played');
      await record('legal@retailer.example', 'terms_accepted');
      await record('legal@retailer.example', 'terms_rejected');

      const status = await api<DsrStatus>(alice.token, 'GET', `/v1/nexus/dsr-status?dsrId=${dsrId}`);
      assert.equal(status.status, 200);
      assert.deepEqual(status.body.summary, { activeDsrs: 1, stakeholders: 3, accepted: 1, rejected: 1, pending: 1 });
      const [dsr] = status.body.dsrs;
      assert.equal(dsr.activityCount, 8);
      assert.deepEqual(dsr.activityCounts, {
        opened: 1,
        zone_viewed: 1,
        briefing_played: 1,
        view: 1,
        download: 1,
        comment: 0,
        terms_accepted: 2,
        terms_rejected: 1,
      });
      const byEmail = Object.fromEntries(dsr.stakeholders.map((s) => [s.email, s.status]));
      assert.deepEqual(byEmail, {
        'buyer@retailer.example': 'accepted',
        'cfo@retailer.example': 'engaged',
        'legal@retailer.example': 'rejected',
      });
    });

    it('validates activities', async () => {
      const response = await api(alice.token, 'POST', '/v1/nexus/dsr-activities', {
        dsrId: randomUUID(),
        stakeholderEmail: 'not-an-email',
        activityType: 'view',
      });
      assert.equal(response.status, 400);
      assert.equal((await api(alice.token, 'GET', '/v1/nexus/dsr-status?windowDays=0')).status, 400);
    });
  });

  describe('Nexus command and voice events', () => {
    it('routes commands and resolves context from the token', async () => {
      const result = await api<CommandResult>(tenantA.token, 'POST', '/v1/nexus/command', {
        command: 'Show P&L variance for 2026-q1',
        contextRoute: '/dsr',
      });
      assert.equal(result.status, 201);
      assert.equal(result.body.intent, 'open_financials');
      assert.equal(result.body.navigateTo, '/financials?period=2026-Q1');
      assert.equal(result.body.context.tenantId, AGERA_DEV);
      assert.equal(result.body.context.userId, tenantA.profile.id);
      assert.equal(result.body.context.contextRoute, '/dsr');

      const dsr = await api<CommandResult>(alice.token, 'POST', '/v1/nexus/command', {
        command: `open dsr ${dsrB}`,
        contextRoute: '/financials',
      });
      assert.equal(dsr.body.navigateTo, `/dsr?dsrId=${dsrB}`);
      assert.equal(dsr.body.context.tenantId, ACME_TEST);

      const unknown = await api<CommandResult>(alice.token, 'POST', '/v1/nexus/command', {
        command: 'make coffee',
        contextRoute: '/',
      });
      assert.equal(unknown.body.intent, 'unknown');
      assert.equal(unknown.body.navigateTo, null);
      assert.equal((await api(alice.token, 'POST', '/v1/nexus/command', { command: '', contextRoute: '/' })).status, 400);
    });

    it('queues voice clips as pending and rejects non-audio or oversized files', async () => {
      assert.equal(a.voiceEvent.status, 'pending');
      assert.equal(a.voiceEvent.audioMimeType, 'audio/wav');
      assert.equal(a.voiceEvent.audioSizeBytes, wavClip().length);
      assert.equal(a.voiceEvent.contextRoute, '/dsr');

      const text = await uploadVoice(tenantA.token, { data: Buffer.from('not audio at all'), type: 'audio/wav' }, '/dsr');
      assert.equal(text.status, 400);
      const big = await uploadVoice(tenantA.token, { data: wavClip(3 * 1024 * 1024), type: 'audio/wav' }, '/dsr');
      assert.equal(big.status, 400);
      const noRoute = await uploadVoice(tenantA.token, { data: wavClip(), type: 'audio/wav' }, null);
      assert.equal(noRoute.status, 400);
      const noFile = await uploadVoice(tenantA.token, null, '/dsr');
      assert.equal(noFile.status, 400);
    });

    it('is not available with an API key', async () => {
      const response = await fetch(`${API_URL}/v1/financials/pnl`, { headers: { 'X-API-Key': 'agk_invalid' } });
      assert.equal(response.status, 403);
    });
  });

  describe('PostgreSQL row-level security (application role)', () => {
    let client: pg.Client;

    before(async () => {
      client = new pg.Client({
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        user: process.env.DB_USER ?? 'symphony_user',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME ?? 'agera_symphony',
      });
      await client.connect();
    });

    after(async () => {
      await client.end();
    });

    const idsOf = (rows: TenantRows): Record<(typeof RLS_TABLES)[number], string> => ({
      financial_models: rows.model.id,
      financial_line_items: rows.lineItem.id,
      dsr_activities: rows.activity.id,
      nexus_voice_events: rows.voiceEvent.id,
    });

    async function asTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
      await client.query('BEGIN');
      try {
        await client.query(
          `SELECT set_config('app.current_tenant', $1, true), set_config('app.access_scope', 'internal', true)`,
          [tenantId],
        );
        return await work();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('enables RLS with a policy on all four tables', async () => {
      const { rows } = await client.query<{ relname: string; relrowsecurity: boolean; policies: number }>(
        `SELECT c.relname, c.relrowsecurity,
                (SELECT COUNT(*)::int FROM pg_policies p WHERE p.tablename = c.relname) AS policies
           FROM pg_class c WHERE c.relname = ANY($1::text[]) ORDER BY c.relname`,
        [RLS_TABLES],
      );
      assert.equal(rows.length, 4);
      assert.ok(rows.every((row) => row.relrowsecurity && row.policies >= 1), JSON.stringify(rows));
    });

    it('returns no rows at all when no tenant is set', async () => {
      for (const table of RLS_TABLES) {
        const { rows } = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`);
        assert.equal(rows[0].n, 0, table);
      }
    });

    it('shows only the current tenant\'s rows, even when filtering by the other tenant', async () => {
      const ownIds = idsOf(a);
      const otherIds = idsOf(b);
      await asTenant(AGERA_DEV, async () => {
        for (const table of RLS_TABLES) {
          const other = await client.query(`SELECT id FROM ${table} WHERE id = $1 OR tenant_id = $2`, [
            otherIds[table],
            ACME_TEST,
          ]);
          assert.equal(other.rowCount, 0, table);
          const own = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [ownIds[table]]);
          assert.equal(own.rowCount, 1, table);
          const foreign = await client.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id <> $1`,
            [AGERA_DEV],
          );
          assert.equal(foreign.rows[0].n, 0, table);
        }
      });
    });

    it('cannot update or delete the other tenant\'s rows', async () => {
      const otherIds = idsOf(b);
      await asTenant(AGERA_DEV, async () => {
        for (const table of RLS_TABLES) {
          const updated = await client.query(`UPDATE ${table} SET tenant_id = tenant_id WHERE id = $1`, [otherIds[table]]);
          assert.equal(updated.rowCount, 0, table);
          const deleted = await client.query(`DELETE FROM ${table} WHERE id = $1`, [otherIds[table]]);
          assert.equal(deleted.rowCount, 0, table);
        }
      });
      await asTenant(ACME_TEST, async () => {
        for (const table of RLS_TABLES) {
          const still = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [otherIds[table]]);
          assert.equal(still.rowCount, 1, table);
        }
      });
    });

    it('cannot move own rows into the other tenant', async () => {
      await asTenant(AGERA_DEV, async () => {
        await client.query('SAVEPOINT move');
        await assert.rejects(
          client.query(`UPDATE dsr_activities SET tenant_id = $1 WHERE id = $2`, [ACME_TEST, a.activity.id]),
          (error: { code?: string }) => error.code === '42501',
        );
        await client.query('ROLLBACK TO SAVEPOINT move');
      });
    });

    it('cannot insert rows for the other tenant', async () => {
      const inserts: Record<(typeof RLS_TABLES)[number], [string, unknown[]]> = {
        financial_models: [`INSERT INTO financial_models (tenant_id, model_name, fiscal_year) VALUES ($1, 'x', 2026)`, []],
        financial_line_items: [
          `INSERT INTO financial_line_items (tenant_id, model_id, category, period_code) VALUES ($1, $2, 'revenue', '2026-01')`,
          [b.model.id],
        ],
        dsr_activities: [
          `INSERT INTO dsr_activities (tenant_id, dsr_id, stakeholder_email, activity_type) VALUES ($1, $2, 'x@y.z', 'view')`,
          [randomUUID()],
        ],
        nexus_voice_events: [
          `INSERT INTO nexus_voice_events (tenant_id, user_id, context_route, audio_payload_url, audio_mime_type, audio_size_bytes)
           VALUES ($1, $2, '/', 'k', 'audio/wav', 1)`,
          [alice.profile.id],
        ],
      };
      await asTenant(AGERA_DEV, async () => {
        for (const table of RLS_TABLES) {
          const [sql, params] = inserts[table];
          await client.query('SAVEPOINT attempt');
          await assert.rejects(
            client.query(sql, [ACME_TEST, ...params]),
            (error: { code?: string }) => error.code === '42501',
            table,
          );
          await client.query('ROLLBACK TO SAVEPOINT attempt');
        }
      });
    });

    it('does not keep the tenant setting after the transaction ends', async () => {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [AGERA_DEV]);
      await client.query('COMMIT');
      const { rows } = await client.query<{ tenant: string | null }>(
        `SELECT NULLIF(current_setting('app.current_tenant', true), '') AS tenant`,
      );
      assert.equal(rows[0].tenant, null);
      const leaked = await client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM financial_models');
      assert.equal(leaked.rows[0].n, 0);
    });
  });
});
