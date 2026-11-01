/**
 * Idempotent import of the Agera source files (seed/agera/*.json) into one tenant.
 *
 *   internal-users.json  -> users (seed-linked Keycloak IDs)
 *   dsr-clients.json     -> financial_models + financial_line_items (contract_value_eur as projected revenue)
 *                           digital_sales_rooms (active_project as room name, deterministic client_id)
 *   retail-stores.json   -> stores + one COMPLETED merchandising visit + visit report whose
 *                           auditData.complianceStatus feeds the store_compliance anomaly (V9)
 *
 * Usage: node dist/seed/agera-seed.js [--tenant-domain agera.local] [--source-tenant agera] [--dir seed/agera]
 * Only records whose "tenant" field equals --source-tenant are accepted; anything else aborts the import.
 * Contract values are booked as projected revenue in <current year>-Q3 (the files carry no dates).
 * Uses the backend's DB_* environment variables. Re-running updates rows in place.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';

interface Address {
  street: string;
  postal_code: string;
  city: string;
  country: string;
}

/** Fields shared by every source record; each file is a JSON array of these. */
interface SourceRecord {
  account_id: string;
  entity_type: string;
  tenant: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_office?: string;
  phone_mobile?: string;
  role: string;
  title?: string;
  company_name: string;
  address?: Address;
}

interface DsrClient extends SourceRecord {
  vat_number?: string;
  active_project: string;
  contract_value_eur: number;
}

interface RetailStore extends SourceRecord {
  store_code: string;
  address: Address;
  status: string;
}

/** Stable UUID (RFC 4122 v5 layout) derived from a seed key, so re-runs hit the same rows. */
export function seedUuid(key: string): string {
  const hash = createHash('sha1').update(`agera-seed:${key}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** "Flagged Anomaly (Promotiedisplay niet opgebouwd)" -> { status: 'flagged_anomaly', finding: '...' } */
export function parseStoreStatus(raw: string): { status: string; label: string; finding: string | null } {
  const match = /^\s*([^(]*?)\s*(?:\((.*)\))?\s*$/.exec(raw);
  const label = match?.[1] || raw.trim();
  const status = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return { status, label, finding: match?.[2]?.trim() || null };
}

async function load<T extends SourceRecord>(dir: string, file: string, entityType: string, sourceTenant: string): Promise<T[]> {
  const records = JSON.parse(await readFile(join(dir, file), 'utf8')) as T[];
  if (!Array.isArray(records)) throw new Error(`${file}: expected a JSON array of records`);
  for (const r of records) {
    if (r.entity_type !== entityType) throw new Error(`${file}: ${r.account_id} has entity_type "${r.entity_type}"`);
    if (r.tenant !== sourceTenant) throw new Error(`${file}: ${r.account_id} belongs to tenant "${r.tenant}"`);
  }
  return records;
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function contactJson(c: SourceRecord): Record<string, string | null> {
  return {
    name: `${c.first_name} ${c.last_name}`,
    title: c.title ?? null,
    email: c.email,
    phoneOffice: c.phone_office ?? null,
    phoneMobile: c.phone_mobile ?? null,
  };
}

async function main(): Promise<void> {
  const dir = resolve(arg('dir', 'seed/agera'));
  const domain = arg('tenant-domain', 'agera.local');
  const sourceTenant = arg('source-tenant', 'agera');
  const [internalUsers, dsrClients, retailStores] = await Promise.all([
    load<SourceRecord>(dir, 'internal-users.json', 'internal_user', sourceTenant),
    load<DsrClient>(dir, 'dsr-clients.json', 'dsr_client', sourceTenant),
    load<RetailStore>(dir, 'retail-stores.json', 'retail_store', sourceTenant),
  ]);

  const client = new pg.Client({
    host: env('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    database: env('DB_NAME'),
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query<{ id: string; name: string }>('SELECT id, name FROM tenants WHERE domain = $1', [domain]);
    if (tenant.rowCount !== 1) throw new Error(`No tenant with domain "${domain}"`);
    const tenantId = tenant.rows[0].id;
    await client.query(
      `SELECT set_config('app.current_tenant', $1, true), set_config('app.access_scope', 'internal', true),
              set_config('app.current_client', '', true)`,
      [tenantId],
    );

    const userIds = new Map<string, string>();
    for (const u of internalUsers) {
      const id = seedUuid(`user:${u.account_id}`);
      const row = await client.query<{ id: string; tenant_id: string }>(
        `INSERT INTO users (id, tenant_id, keycloak_id, email, first_name, last_name)
         VALUES ($1, $2, $6, lower($3), $4, $5)
         ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name
         RETURNING id, tenant_id`,
        [id, tenantId, u.email, u.first_name, u.last_name, id],
      );
      if (row.rows[0].tenant_id !== tenantId) throw new Error(`${u.email} already belongs to another tenant`);
      userIds.set(u.account_id, row.rows[0].id);
    }

    const fieldRep = internalUsers.find((u) => u.role === 'field_merchandiser') ?? internalUsers[0];
    if (!fieldRep) throw new Error('internal-users.json has no users to assign store visits to');
    const fieldRepId = userIds.get(fieldRep.account_id) as string;

    const fiscalYear = new Date().getUTCFullYear();
    for (const c of dsrClients) {
      const clientId = seedUuid(`client:${c.account_id}`);
      const modelId = seedUuid(`${tenantId}:model:${c.account_id}`);
      const metadata = {
        source: 'agera-seed',
        accountId: c.account_id,
        clientId,
        companyName: c.company_name,
        vatNumber: c.vat_number ?? null,
        activeProject: c.active_project,
        contractValueEur: c.contract_value_eur,
        contact: contactJson(c),
        address: c.address ?? null,
      };
      await client.query(
        `INSERT INTO clients (id, tenant_id, name, legal_name, vat_number, city, country)
         VALUES ($1, $2, $3, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, legal_name = EXCLUDED.legal_name,
           vat_number = EXCLUDED.vat_number, city = EXCLUDED.city, country = EXCLUDED.country`,
        [clientId, tenantId, c.company_name, c.vat_number ?? null, c.address?.city ?? null, c.address?.country ?? null],
      );
      const [firstName, ...lastName] = `${c.first_name ?? ''}`.trim() ? [c.first_name as string, c.last_name as string] : ['Contact'];
      await client.query(
        `INSERT INTO contacts (id, tenant_id, client_id, first_name, last_name, email, phone, role_title, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
         ON CONFLICT (tenant_id, client_id) WHERE is_primary DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
           email = EXCLUDED.email, phone = EXCLUDED.phone, role_title = EXCLUDED.role_title`,
        [
          seedUuid(`${tenantId}:contact:${c.account_id}`),
          tenantId,
          clientId,
          firstName,
          lastName.join(' ') || null,
          c.email ? String(c.email).toLowerCase() : null,
          c.phone_mobile ?? c.phone_office ?? null,
          c.title ?? null,
        ],
      );
      await client.query(
        `INSERT INTO financial_models (id, tenant_id, model_name, fiscal_year, status, metadata)
         VALUES ($1, $2, $3, $4, 'approved', $5)
         ON CONFLICT (id) DO UPDATE SET model_name = EXCLUDED.model_name, metadata = EXCLUDED.metadata`,
        [modelId, tenantId, `${c.company_name} – contract`.slice(0, 100), fiscalYear, metadata],
      );
      await client.query(
        `INSERT INTO financial_line_items (id, tenant_id, model_id, category, subcategory, period_code, projected_amount, currency)
         VALUES ($1, $2, $3, 'revenue', $4, $5, $6, 'EUR')
         ON CONFLICT (id) DO UPDATE SET subcategory = EXCLUDED.subcategory, projected_amount = EXCLUDED.projected_amount`,
        [seedUuid(`${tenantId}:line:${c.account_id}`), tenantId, modelId, c.active_project.slice(0, 100), `${fiscalYear}-Q3`, c.contract_value_eur],
      );
      await client.query(
        `INSERT INTO digital_sales_rooms (id, tenant_id, client_id, room_name, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (id) DO UPDATE SET room_name = EXCLUDED.room_name`,
        [seedUuid(`${tenantId}:dsr:${c.account_id}`), tenantId, clientId, c.active_project.slice(0, 150)],
      );
    }

    for (const s of retailStores) {
      const store = await client.query<{ id: string }>(
        `INSERT INTO stores (tenant_id, store_code, name, address, city, postal_code, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, store_code) DO UPDATE SET name = EXCLUDED.name, address = EXCLUDED.address,
           city = EXCLUDED.city, postal_code = EXCLUDED.postal_code, country = EXCLUDED.country
         RETURNING id`,
        [tenantId, s.store_code, s.company_name, s.address.street, s.address.city, s.address.postal_code, s.address.country],
      );
      const visitId = seedUuid(`${tenantId}:visit:${s.account_id}`);
      const { status, label, finding } = parseStoreStatus(s.status);
      await client.query(
        `INSERT INTO merchandising_visits (id, tenant_id, store_id, field_rep_id, visit_date, notes, status)
         VALUES ($1, $2, $3, $4, NOW(), $5, 'COMPLETED')
         ON CONFLICT (id) DO UPDATE SET notes = EXCLUDED.notes`,
        [visitId, tenantId, store.rows[0].id, fieldRepId, `Imported store status: ${s.status}`],
      );
      await client.query(
        `INSERT INTO visit_reports (tenant_id, visit_id, summary, audit_data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (visit_id) DO UPDATE SET summary = EXCLUDED.summary, audit_data = EXCLUDED.audit_data`,
        [
          tenantId,
          visitId,
          finding ? `${label}: ${finding}` : label,
          { source: 'agera-seed', accountId: s.account_id, complianceStatus: status, finding, storeContact: contactJson(s) },
        ],
      );
    }

    await client.query('COMMIT');
    console.log(
      `Seeded tenant "${tenant.rows[0].name}" (${domain}): ${internalUsers.length} users, ` +
        `${dsrClients.length} client contracts + rooms, ${retailStores.length} stores with compliance reports.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith('agera-seed.js') || process.argv[1]?.endsWith('agera-seed.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
