/**
 * Demo data generator: two fictional organisations with realistic, connected data for testing every screen.
 *
 *   Agera Demo          (demo.agera.nl, Symphony edition)  full data set
 *   Agera Demo Vanguard (vanguard-demo.agera.nl, Vanguard)  small data set within the Vanguard limits
 *
 * Every run first deletes both demo organisations (rows and stored files) and then creates them again, so the
 * data is always the same shape (generated from a fixed random seed; dates follow today's date). Logins get new
 * passwords on every run.
 *
 * Usage: node dist/seed/demo-seed.js [--reset-only] [--out-dir /tmp/agera-demo]
 * Writes to --out-dir: keycloak-users.json (Keycloak partial import), keycloak-user-ids.txt, demo-logins.txt.
 * Database: DB_HOST, DB_PORT, DB_NAME and SEED_DB_USER / SEED_DB_PASSWORD (the database owner; needed to delete the
 * demo organisations across row-level security). Files: UPLOAD_DIR (default ./uploads).
 */
import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';

type Row = Record<string, unknown>;
type Tier = 'symphony' | 'vanguard';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function demoUuid(key: string): string {
  const hash = createHash('sha1').update(`agera-demo:${key}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Deterministic PRNG (mulberry32) so every run produces the same data set. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
    sample: <T>(items: readonly T[], n: number): T[] => {
      const copy = [...items];
      const out: T[] = [];
      while (out.length < n && copy.length) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
      return out;
    },
  };
}

const DAY = 86_400_000;
const NOW = new Date();
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(NOW.getTime() - n * DAY);
  d.setUTCHours(hour, (n * 7) % 60, 0, 0);
  return d;
};
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const year = NOW.getUTCFullYear();

const FIRST = ['Sanne', 'Daan', 'Lotte', 'Bram', 'Emma', 'Lucas', 'Julia', 'Sem', 'Fleur', 'Thijs', 'Noor', 'Jesse', 'Lisa', 'Ruben', 'Eva', 'Milan', 'Anouk', 'Tim', 'Sophie', 'Niels', 'Iris', 'Koen', 'Femke', 'Joris', 'Maud', 'Stijn', 'Esmee', 'Wouter', 'Roos', 'Gijs'];
const LAST = ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer', 'de Wit', 'Dijkstra', 'Smits', 'de Graaf', 'van der Meer', 'Kok', 'Jacobs', 'Willems', 'van Vliet', 'Schouten', 'Hoekstra'];
const CITIES: [string, string, 'Noord' | 'Midden' | 'Zuid'][] = [
  ['Amsterdam', '1012', 'Midden'], ['Rotterdam', '3011', 'Zuid'], ['Den Haag', '2511', 'Midden'], ['Utrecht', '3511', 'Midden'], ['Eindhoven', '5611', 'Zuid'],
  ['Groningen', '9711', 'Noord'], ['Tilburg', '5038', 'Zuid'], ['Almere', '1315', 'Midden'], ['Breda', '4811', 'Zuid'], ['Nijmegen', '6511', 'Zuid'],
  ['Arnhem', '6811', 'Midden'], ['Haarlem', '2011', 'Midden'], ['Enschede', '7511', 'Noord'], ['Amersfoort', '3811', 'Midden'], ['Zwolle', '8011', 'Noord'],
  ['Leiden', '2311', 'Midden'], ['Maastricht', '6211', 'Zuid'], ['Dordrecht', '3311', 'Zuid'], ['Apeldoorn', '7311', 'Noord'], ['Leeuwarden', '8911', 'Noord'],
];
const CITY_COORDS: Record<string, [number, number]> = {
  Amsterdam: [52.3702, 4.8952], Rotterdam: [51.9244, 4.4777], 'Den Haag': [52.0705, 4.3007], Utrecht: [52.0907, 5.1214], Eindhoven: [51.4416, 5.4697],
  Groningen: [53.2194, 6.5665], Tilburg: [51.5555, 5.0913], Almere: [52.3508, 5.2647], Breda: [51.5719, 4.7683], Nijmegen: [51.8126, 5.8372],
  Arnhem: [51.9851, 5.8987], Haarlem: [52.3874, 4.6462], Enschede: [52.2215, 6.8937], Amersfoort: [52.1561, 5.3878], Zwolle: [52.5168, 6.083],
  Leiden: [52.1601, 4.497], Maastricht: [50.8514, 5.691], Dordrecht: [51.8133, 4.6901], Apeldoorn: [52.2112, 5.9699], Leeuwarden: [53.2012, 5.7999],
};
const STREETS = ['Dorpsstraat', 'Kerkstraat', 'Stationsweg', 'Marktplein', 'Hoofdstraat', 'Molenweg', 'Schoolstraat', 'Julianalaan', 'Beatrixstraat', 'Industrieweg', 'Parallelweg', 'Nieuwstraat'];
const RETAILERS = ['Versmarkt', 'Buurtsuper', 'DagelijksVers', 'Stadsmarkt', 'Polder Super', 'Kustwinkels', 'Groenhoek', 'Marktplein Retail', 'De Korenbloem', 'Noorderzon', 'Zuiderhaven', 'Molenhoek', 'Plein Supermarkten', 'Vers & Co', 'Hollandse Hoek', 'Lindeboom', 'Oranjehof', 'De Graanschuur', 'Buitenhof', 'Eikenhof', 'Waterkant Retail', 'Kanaalzijde', 'Duinrand', 'De Kaasstolp', 'Huismerk Winkels'];
const BRANDS = ['Lage Landen Dranken', 'Zeeuws Zout', 'Brabantse Bakkerij', 'Friese Zuivel', 'Delta Snacks', 'Hollandse Koffiebranders', 'Veluwe Vers', 'Noordzee Visgroep', 'Twentse Sappen', 'Limburgse Vlaai', 'Utrechtse Thee', 'Gouds Kaashuis', 'Rijnmond Frisdrank', 'Achterhoek Vlees', 'Westland Groente', 'Betuwe Fruit', 'Kempen Chips', 'Wadden Water', 'Zaanse Specerijen', 'Drentse Granen', 'Hanze Huishoud', 'Maas Verzorging', 'Groene Hart Bio', 'Kennemer Bloem', 'IJssel Pasta'];
const WHOLESALE = ['Horeca Groothandel Midden', 'Foodservice Randstad', 'Cash & Carry Noord', 'Campus Catering', 'Zorgcatering Zuid', 'Stationsshops NL', 'Tankshop Partners', 'Sportkantine Service', 'Bedrijfsrestaurants Holland', 'Festival Supply'];
const CATEGORIES: Record<string, string[]> = {
  Dranken: ['Cola Zero 1,5L', 'Sinaasappelsap 1L', 'Bruisend water 6x0,5L', 'Ice tea perzik 1,5L', 'Energiedrank 250ml'],
  Zuivel: ['Halfvolle melk 1L', 'Griekse yoghurt 500g', 'Jong belegen kaas 500g', 'Vla vanille 1L', 'Roomboter 250g'],
  Snacks: ['Paprikachips 225g', 'Zoute pinda 300g', 'Tortillachips 200g', 'Mueslireep 6-pack', 'Popcorn zoet 100g'],
  Bakkerij: ['Volkorenbrood heel', 'Krentenbollen 6 st', 'Ontbijtkoek 500g', 'Stroopwafels 10 st', 'Croissants 4 st'],
  'Koffie & thee': ['Filterkoffie 500g', 'Koffiebonen 1kg', 'Groene thee 20 st', 'Koffiecups 10 st', 'Rooibos 20 st'],
  Verzorging: ['Douchegel 250ml', 'Tandpasta 75ml', 'Shampoo 300ml', 'Deodorant 150ml', 'Handzeep 250ml'],
  Huishoud: ['Afwasmiddel 500ml', 'Allesreiniger 1L', 'Wasmiddel 1,5L', 'Keukenrol 4 st', 'Vaatwastabletten 30 st'],
  'Groente & fruit': ['Appels Elstar 1kg', 'Tomaten 500g', 'Komkommer', 'Bananen 1kg', 'Sla krop'],
};
const SECTORS = { retail: 'Retail – supermarkets', brand: 'FMCG – food & beverages', wholesale: 'Foodservice & wholesale' };
const WORK_TITLES = ['Schapinrichting controleren', 'Promotiedisplay opbouwen', 'Prijskaartjes vervangen', 'Voorraadtelling uitvoeren', 'Planogram reset', 'Nieuwe listing plaatsen', 'Klacht filiaalmanager opvolgen', 'Koeling herindelen', 'Actiemateriaal plaatsen'];
const EXCEPTION_TITLES = ['Promotiedisplay niet opgebouwd', 'Schap leeg bij levering', 'Prijsverschil kassa vs. schap', 'Beschadigde levering', 'Planogram niet gevolgd', 'Koeling defect', 'Verkeerde artikelen geleverd', 'Filiaalmanager niet bereikbaar', 'Factuur betwist door klant', 'Actiemateriaal ontbreekt'];

interface Persona {
  key: string;
  first: string;
  last: string;
  email: string;
  role: 'admin' | 'user' | 'External_Client';
  title: string;
  zone?: 'Noord' | 'Midden' | 'Zuid';
  /** Index into the tenant's client list for client contacts. */
  clientIndex?: number;
  hint: string;
}

interface TenantSpec {
  key: string;
  name: string;
  domain: string;
  tier: Tier;
  maxSeats: number | null;
  seed: number;
  counts: { retailers: number; brands: number; wholesale: number; storesPerRetailer: [number, number]; products: number; deals: number; visits: number; workOrders: number; fieldOrders: number; exceptions: number };
  personas: Persona[];
}

const ROLE_SETS: Record<Persona['role'], string[]> = { admin: ['admin', 'user'], user: ['user'], External_Client: ['External_Client'] };

const SPECS: TenantSpec[] = [
  {
    key: 'symphony',
    name: 'Agera Demo',
    domain: 'demo.agera.nl',
    tier: 'symphony',
    maxSeats: null,
    seed: 20261105,
    counts: { retailers: 25, brands: 25, wholesale: 10, storesPerRetailer: [8, 16], products: 120, deals: 40, visits: 450, workOrders: 150, fieldOrders: 140, exceptions: 30 },
    personas: [
      { key: 'admin', first: 'Iris', last: 'Bakker', email: 'iris.bakker@agera-demo.nl', role: 'admin', title: 'Operations director', hint: 'Admin: manages users and settings of Agera Demo; sees everything' },
      { key: 'director', first: 'Thomas', last: 'Visser', email: 'thomas.visser@agera-demo.nl', role: 'user', title: 'Commercial director', hint: 'Approves agreements; owns key accounts and deals' },
      { key: 'am1', first: 'Lotte', last: 'de Boer', email: 'lotte.deboer@agera-demo.nl', role: 'user', title: 'Key account manager', hint: 'Account manager for about a third of the clients' },
      { key: 'am2', first: 'Daan', last: 'Mulder', email: 'daan.mulder@agera-demo.nl', role: 'user', title: 'Account manager', hint: 'Account manager for about a third of the clients' },
      { key: 'finance', first: 'Fatima', last: 'El Amrani', email: 'fatima.elamrani@agera-demo.nl', role: 'user', title: 'Finance controller', hint: 'Invoices, credit locks, second approval step' },
      { key: 'fieldlead', first: 'Ruben', last: 'Smit', email: 'ruben.smit@agera-demo.nl', role: 'user', title: 'Field team lead', zone: 'Midden', hint: 'Plans work orders and audit rounds for the field team' },
      { key: 'field1', first: 'Noah', last: 'Jansen', email: 'noah.jansen@agera-demo.nl', role: 'user', title: 'Field merchandiser', zone: 'Noord', hint: 'Store visits and work orders in region Noord' },
      { key: 'field2', first: 'Emma', last: 'de Vries', email: 'emma.devries@agera-demo.nl', role: 'user', title: 'Field merchandiser', zone: 'Midden', hint: 'Store visits and work orders in region Midden' },
      { key: 'field3', first: 'Milan', last: 'Peters', email: 'milan.peters@agera-demo.nl', role: 'user', title: 'Field merchandiser', zone: 'Zuid', hint: 'Store visits and work orders in region Zuid' },
      { key: 'client1a', first: 'Sophie', last: 'Hendriks', email: 'sophie.hendriks@versmarkt.example', role: 'External_Client', title: 'Purchasing manager', clientIndex: 0, hint: 'Client portal for Versmarkt (retailer): rooms, documents, surveys, signing' },
      { key: 'client1b', first: 'Koen', last: 'Dekker', email: 'koen.dekker@versmarkt.example', role: 'External_Client', title: 'Store manager', clientIndex: 0, hint: 'Second Versmarkt contact: same company, different person' },
      { key: 'client2', first: 'Femke', last: 'Brouwer', email: 'femke.brouwer@lagelandendranken.example', role: 'External_Client', title: 'Category manager', clientIndex: 25, hint: 'Client portal for Lage Landen Dranken (brand)' },
      { key: 'client3', first: 'Joris', last: 'van Vliet', email: 'joris.vanvliet@horecagroothandel.example', role: 'External_Client', title: 'Finance manager', clientIndex: 50, hint: 'Client portal for Horeca Groothandel Midden (wholesale)' },
    ],
  },
  {
    key: 'vanguard',
    name: 'Agera Demo Vanguard',
    domain: 'vanguard-demo.agera.nl',
    tier: 'vanguard',
    maxSeats: 10,
    seed: 20261106,
    counts: { retailers: 4, brands: 4, wholesale: 2, storesPerRetailer: [3, 6], products: 25, deals: 6, visits: 40, workOrders: 15, fieldOrders: 12, exceptions: 5 },
    personas: [
      { key: 'admin', first: 'Maud', last: 'Kok', email: 'maud.kok@vanguard-demo.nl', role: 'admin', title: 'Managing director', hint: 'Admin of the Vanguard demo: see the edition limits' },
      { key: 'user', first: 'Stijn', last: 'Willems', email: 'stijn.willems@vanguard-demo.nl', role: 'user', title: 'Account manager & field', zone: 'Midden', hint: 'Day-to-day user in the Vanguard demo' },
      { key: 'client1', first: 'Roos', last: 'Schouten', email: 'roos.schouten@buurtsuper.example', role: 'External_Client', title: 'Owner', clientIndex: 0, hint: 'Client portal in the Vanguard demo' },
    ],
  },
];

const OUT_DIR = resolve(arg('out-dir', '/tmp/agera-demo'));
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? './uploads');
const ASSETS = resolve(process.cwd(), 'assets', 'office');

class Writer {
  constructor(private readonly db: pg.Client) {}
  count = 0;
  async insert(table: string, row: Row): Promise<void> {
    const cols = Object.keys(row);
    const vals = cols.map((c) => {
      const v = row[c];
      if (c === 'realm_roles') return v;
      return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
    });
    await this.db.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
    this.count++;
  }
}

async function reset(db: pg.Client): Promise<void> {
  const ids = SPECS.map((s) => demoUuid(`tenant:${s.key}`));
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'`,
  );
  await db.query('SET LOCAL session_replication_role = replica');
  for (const { table_name } of rows) await db.query(`DELETE FROM ${table_name} WHERE tenant_id = ANY($1::uuid[])`, [ids]);
  await db.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids]);
  await db.query('SET LOCAL session_replication_role = DEFAULT');
  for (const id of ids) await rm(join(UPLOAD_DIR, id), { recursive: true, force: true });
}

interface Login { tenant: string; persona: Persona; password: string; keycloakId: string; clientName?: string }

async function generate(db: pg.Client, spec: TenantSpec, logins: Login[], keycloakUsers: Row[]): Promise<string> {
  const r = rng(spec.seed);
  const w = new Writer(db);
  const t = demoUuid(`tenant:${spec.key}`);
  const id = (k: string) => demoUuid(`${spec.key}:${k}`);
  await w.insert('tenants', { id: t, name: spec.name, domain: spec.domain, license_tier: spec.tier, max_seats: spec.maxSeats });

  // Clients ------------------------------------------------------------------------------------------------------
  type Client = { id: string; name: string; kind: 'retail' | 'brand' | 'wholesale'; city: [string, string, string]; am: string; contacts: { id: string; name: string; email: string }[]; credit: string; slug: string };
  const clients: Client[] = [];
  const names: [string, Client['kind']][] = [
    ...RETAILERS.slice(0, spec.counts.retailers).map((n) => [n, 'retail'] as [string, Client['kind']]),
    ...BRANDS.slice(0, spec.counts.brands).map((n) => [n, 'brand'] as [string, Client['kind']]),
    ...WHOLESALE.slice(0, spec.counts.wholesale).map((n) => [n, 'wholesale'] as [string, Client['kind']]),
  ];
  if (spec.key === 'vanguard') names[0] = ['Buurtsuper', 'retail'];

  // Users --------------------------------------------------------------------------------------------------------
  const userId: Record<string, string> = {};
  for (const p of spec.personas.filter((p) => p.role !== 'External_Client')) {
    const uid = id(`user:${p.key}`);
    userId[p.key] = uid;
    await w.insert('users', { id: uid, tenant_id: t, keycloak_id: uid, email: p.email, first_name: p.first, last_name: p.last, realm_roles: ROLE_SETS[p.role], title: p.title, zone: p.zone ?? null, is_active: true });
  }
  const internal = Object.values(userId);
  const ams = spec.key === 'symphony' ? [userId.director, userId.am1, userId.am2] : [userId.user];
  const fieldByZone: Record<string, string> = spec.key === 'symphony' ? { Noord: userId.field1, Midden: userId.field2, Zuid: userId.field3 } : { Noord: userId.user, Midden: userId.user, Zuid: userId.user };
  const fieldLead = userId.fieldlead ?? userId.user;
  const finance = userId.finance ?? userId.admin;
  const director = userId.director ?? userId.admin;

  for (let i = 0; i < names.length; i++) {
    const [name, kind] = names[i];
    const cid = id(`client:${i}`);
    const city = r.pick(CITIES);
    const credit = i % 17 === 5 ? 'locked' : i % 13 === 7 ? 'review_required' : 'approved';
    const slug = name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');
    const status = i % 23 === 22 ? 'archived' : 'active';
    const c: Client = { id: cid, name, kind, city, am: ams[i % ams.length], contacts: [], credit, slug };
    clients.push(c);
    await w.insert('clients', {
      id: cid, tenant_id: t, name, legal_name: `${name} B.V.`, vat_number: `NL${String(800000000 + r.int(0, 99999999))}B01`, kvk_number: String(r.int(10000000, 99999999)),
      city: city[0], country: 'NL', address: `${r.pick(STREETS)} ${r.int(1, 220)}, ${city[1]} ${String.fromCharCode(65 + r.int(0, 25))}${String.fromCharCode(65 + r.int(0, 25))} ${city[0]}`,
      sector: SECTORS[kind], payment_terms: r.pick(['14 days', '30 days', '30 days', '45 days', '60 days']), credit_limit: r.pick([25000, 50000, 100000, 250000, 500000]),
      credit_status: credit, erp_id: r.chance(0.6) ? `ERP-${10000 + i}` : null, account_manager_id: c.am, status, created_at: daysAgo(r.int(200, 700)),
    });
    const nContacts = r.int(2, 4);
    for (let k = 0; k < nContacts; k++) {
      const first = r.pick(FIRST);
      const last = r.pick(LAST);
      const email = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + `@${slug}.example`;
      const ctId = id(`contact:${i}:${k}`);
      c.contacts.push({ id: ctId, name: `${first} ${last}`, email });
      await w.insert('contacts', {
        id: ctId, tenant_id: t, client_id: cid, first_name: first, last_name: last, email, phone: `06${r.int(10000000, 99999999)}`,
        role_title: r.pick(['Purchasing manager', 'Category manager', 'Store manager', 'Finance manager', 'Marketing manager', 'Logistics coordinator']), is_primary: k === 0,
      });
    }
    if (credit === 'locked') {
      await w.insert('credit_holds', { id: id(`hold:${i}`), tenant_id: t, client_id: cid, reason: 'Payment overdue more than 60 days; deliveries on hold until settled', set_by: finance, created_at: daysAgo(r.int(5, 40)) });
    }
    if (i % 11 === 3) {
      await w.insert('credit_holds', { id: id(`hold-old:${i}`), tenant_id: t, client_id: cid, reason: 'Credit limit exceeded after peak season orders', set_by: finance, created_at: daysAgo(160), released_at: daysAgo(130), released_by: finance });
    }
  }

  // Client logins: the persona becomes (or replaces) a contact of its client.
  for (const p of spec.personas) {
    const kcId = id(`user:${p.key}`);
    const password = `Demo-${randomBytes(4).toString('hex')}-${randomBytes(2).toString('hex')}`;
    const client = p.clientIndex !== undefined ? clients[p.clientIndex] : undefined;
    if (client) {
      const ctId = id(`contact-login:${p.key}`);
      client.contacts.push({ id: ctId, name: `${p.first} ${p.last}`, email: p.email });
      await w.insert('contacts', { id: ctId, tenant_id: t, client_id: client.id, first_name: p.first, last_name: p.last, email: p.email, phone: `06${r.int(10000000, 99999999)}`, role_title: p.title, is_primary: false });
    }
    logins.push({ tenant: spec.name, persona: p, password, keycloakId: kcId, clientName: client?.name });
    const attributes: Record<string, string[]> = { tenant_id: [t], tenant_license_tier: [spec.tier] };
    if (client) attributes.client_id = [client.id];
    keycloakUsers.push({
      id: kcId, username: p.email, email: p.email, firstName: p.first, lastName: p.last, enabled: true, emailVerified: true, attributes,
      realmRoles: ROLE_SETS[p.role], credentials: [{ type: 'password', value: password, temporary: false }],
    });
  }
  const active = clients.filter((_, i) => !(i % 23 === 22));

  // Products, planograms, price lists ------------------------------------------------------------------------------
  const products: { id: string; name: string; price: number }[] = [];
  const cats = Object.keys(CATEGORIES);
  for (let i = 0; i < spec.counts.products; i++) {
    const cat = cats[i % cats.length];
    const brand = BRANDS[i % BRANDS.length];
    const item = CATEGORIES[cat][Math.floor(i / cats.length) % CATEGORIES[cat].length];
    const pid = id(`product:${i}`);
    const price = r.int(79, 899) / 100;
    products.push({ id: pid, name: `${brand.split(' ')[0]} ${item}`, price });
    await w.insert('products', { id: pid, tenant_id: t, sku: `DEMO-${String(10000 + i)}`, name: `${brand.split(' ')[0]} ${item}`, brand, category: cat, unit_price: money(price), active: i % 37 !== 36 });
  }
  const planograms: { id: string; items: { productId: string; facings: number }[] }[] = [];
  for (let i = 0; i < Math.min(10, cats.length + 2); i++) {
    const cat = cats[i % cats.length];
    const pgId = id(`planogram:${i}`);
    const items = r.sample(products, r.int(6, 10)).map((p) => ({ productId: p.id, facings: r.int(2, 8) }));
    planograms.push({ id: pgId, items });
    await w.insert('planograms', { id: pgId, tenant_id: t, name: `${cat} – standaard schap ${i < cats.length ? '' : 'XL'}`.trim(), category: cat, store_id: null, active: true });
    for (let k = 0; k < items.length; k++) {
      await w.insert('planogram_items', { id: id(`planogram-item:${i}:${k}`), tenant_id: t, planogram_id: pgId, product_id: items[k].productId, expected_facings: items[k].facings, shelf: `Plank ${1 + (k % 4)}`, position: k + 1 });
    }
  }
  const priceLists = spec.key === 'symphony' ? 8 : 2;
  for (let i = 0; i < priceLists; i++) {
    const c = active[(i * 3) % active.length];
    const plId = id(`pricelist:${i}`);
    await w.insert('price_lists', { id: plId, tenant_id: t, name: `Contractprijzen ${year} – ${c.name}`, client_id: c.id, valid_from: `${year}-01-01`, valid_to: `${year}-12-31`, active: true });
    for (const [k, p] of r.sample(products, 12).entries()) {
      await w.insert('price_list_items', { id: id(`pli:${i}:${k}:1`), tenant_id: t, price_list_id: plId, product_id: p.id, unit_price: money(p.price * 0.95), min_quantity: 1 });
      await w.insert('price_list_items', { id: id(`pli:${i}:${k}:2`), tenant_id: t, price_list_id: plId, product_id: p.id, unit_price: money(p.price * 0.88), min_quantity: 50 });
    }
  }

  // Stores --------------------------------------------------------------------------------------------------------
  const stores: { id: string; name: string; zone: string; clientId: string }[] = [];
  let storeNo = 0;
  for (const c of clients.filter((x) => x.kind === 'retail')) {
    const n = r.int(...spec.counts.storesPerRetailer);
    for (let k = 0; k < n; k++) {
      const city = r.pick(CITIES);
      const sid = id(`store:${storeNo}`);
      stores.push({ id: sid, name: `${c.name} ${city[0]}${k > 0 && r.chance(0.4) ? ` ${r.pick(['Centrum', 'Noord', 'Zuid', 'West', 'Oost'])}` : ''}`, zone: city[2], clientId: c.id });
      await w.insert('stores', {
        id: sid, tenant_id: t, store_code: `${c.slug.slice(0, 3).toUpperCase()}${String(clients.indexOf(c)).padStart(2, '0')}-${String(101 + k)}`, name: stores[stores.length - 1].name, address: `${r.pick(STREETS)} ${r.int(1, 180)}`,
        city: city[0], postal_code: `${city[1]} ${String.fromCharCode(65 + r.int(0, 25))}${String.fromCharCode(65 + r.int(0, 25))}`, country: 'NL', status: storeNo % 31 === 30 ? 'closed' : 'active', client_id: c.id,
        latitude: (CITY_COORDS[city[0]]?.[0] ?? 52.09) + ((storeNo * 37) % 41 - 20) / 1000, longitude: (CITY_COORDS[city[0]]?.[1] ?? 5.12) + ((storeNo * 53) % 41 - 20) / 1000,
      });
      storeNo++;
    }
  }

  // Agreements, rooms, milestones, activity --------------------------------------------------------------------------
  type Agreement = { id: string; client: Client; status: string; annual: number; roomId: string };
  const agreements: Agreement[] = [];
  const withAgreement = active.filter((c) => c.kind !== 'wholesale' || r.chance(0.5)).slice(0, spec.key === 'symphony' ? 50 : 8);
  for (const [i, c] of withAgreement.entries()) {
    const aid = id(`agreement:${i}`);
    const status = i % 9 === 4 ? 'pending_approval' : i % 9 === 8 ? 'expired' : 'active';
    const annual = r.int(25, 750) * 1000;
    const churn = status === 'active' && i % 6 === 1 ? Math.round(annual * r.int(10, 40) / 100) : 0;
    const roomId = id(`room:${i}`);
    agreements.push({ id: aid, client: c, status, annual, roomId });
    await w.insert('agreements', {
      id: aid, tenant_id: t, client_id: c.id, title: `Jaarovereenkomst ${status === 'expired' ? year - 1 : year} – ${c.name}`, status, document_url: `https://docs.agera-demo.nl/agreements/${aid}.pdf`,
      annual_value: annual, churn_risk: churn, end_date: status === 'expired' ? `${year - 1}-12-31` : `${year}-12-31`, created_at: daysAgo(r.int(60, 400)),
    });
    await w.insert('digital_sales_rooms', {
      id: roomId, tenant_id: t, client_id: c.id, agreement_id: aid, room_name: `Joint Business Plan ${year} – ${c.name}`, status: status === 'expired' ? 'archived' : 'active', created_at: daysAgo(r.int(30, 300)),
    });
    const steps: [string, 'internal' | 'client'][] = [['Kick-off en doelen vastleggen', 'internal'], ['Assortimentsvoorstel delen', 'internal'], ['Feedback op assortiment', 'client'], ['Promotiekalender akkoord', 'client'], ['Contract ondertekenen', 'client']];
    for (const [k, [title, side]] of steps.entries()) {
      const done = status === 'active' ? k < 4 || r.chance(0.5) : k < r.int(1, 3);
      await w.insert('client_room_milestones', {
        id: id(`milestone:${i}:${k}`), tenant_id: t, client_room_id: roomId, title, owner_side: side, due_date: dateOnly(daysAgo(60 - k * 14)), completed: done,
        completed_at: done ? daysAgo(70 - k * 14) : null, completed_by: done && side === 'internal' ? c.am : null,
      });
    }
    const quiet = i % 5 === 2;
    const acts = status === 'expired' ? 0 : r.int(4, 22);
    for (let k = 0; k < acts; k++) {
      const ago = quiet ? r.int(35, 90) : r.int(0, 60);
      await w.insert('dsr_activities', {
        id: id(`activity:${i}:${k}`), tenant_id: t, dsr_id: roomId, stakeholder_email: r.pick(c.contacts).email,
        activity_type: r.pick(['opened', 'opened', 'view', 'view', 'zone_viewed', 'download', 'comment']), details: { zone: r.pick(['Assortiment', 'Promoties', 'Contract', 'Rapportage']) }, created_at: daysAgo(ago, 9 + (k % 8)),
      });
    }
  }

  // Deals --------------------------------------------------------------------------------------------------------
  const stages = ['lead_ingest', 'proposal_sent', 'contract_negotiation', 'ops_handoff'];
  for (let i = 0; i < spec.counts.deals; i++) {
    const c = active[(i * 7) % active.length];
    const did = id(`deal:${i}`);
    const stageIdx = i % 4;
    const created = r.int(10, 160);
    await w.insert('deals', {
      id: did, tenant_id: t, client_id: c.id, title: `${r.pick(['Uitbreiding assortiment', 'Nieuwe listing', 'Promotiepakket', 'Jaarcontract', 'Pilot schapconcept', 'Private label'])} ${c.name}`,
      value: r.int(5, 400) * 1000, stage: stages[stageIdx], owner_id: c.am, priority: r.pick(['low', 'medium', 'medium', 'high']), due_date: dateOnly(daysAgo(-r.int(5, 90))),
      notes: r.chance(0.5) ? 'Besluit verwacht na interne afstemming bij de klant.' : null, created_at: daysAgo(created),
    });
    for (let s = 1; s <= stageIdx; s++) {
      await w.insert('deal_stage_changes', { id: id(`deal-stage:${i}:${s}`), tenant_id: t, deal_id: did, from_stage: stages[s - 1], to_stage: stages[s], changed_by: c.am, changed_at: daysAgo(Math.max(1, created - s * 15)) });
    }
  }

  // Invoices -------------------------------------------------------------------------------------------------------
  let invNo = 1;
  const latePayers = new Set(active.filter((_, i) => i % 7 === 3).map((c) => c.id));
  for (const a of agreements.filter((x) => x.status !== 'pending_approval')) {
    const months = a.status === 'expired' ? 12 : 18;
    for (let m = months - 1; m >= 0; m--) {
      const offset = a.status === 'expired' ? m + 6 : m;
      const issue = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - offset, 1));
      const due = new Date(issue.getTime() + 30 * DAY);
      const amount = a.annual / 12;
      const ageDays = (NOW.getTime() - issue.getTime()) / DAY;
      let status = 'paid';
      if (ageDays < 35) status = 'issued';
      else if (latePayers.has(a.client.id) && m < 3) status = 'issued';
      if (offset === 7 && a.client.name.length % 5 === 0) status = 'cancelled';
      await w.insert('invoices', {
        id: id(`invoice:${invNo}`), tenant_id: t, client_id: a.client.id, invoice_number: `${spec.key === 'symphony' ? 'AD' : 'AV'}-${issue.getUTCFullYear()}-${String(invNo).padStart(5, '0')}`,
        description: `Fee ${issue.toLocaleString('nl-NL', { month: 'long', year: 'numeric' })} – ${a.client.name}`, issue_date: dateOnly(issue), due_date: dateOnly(due),
        amount_excl_vat: money(amount), vat_amount: money(amount * 0.21), status, paid_at: status === 'paid' ? new Date(issue.getTime() + r.int(12, 40) * DAY) : null,
      });
      invNo++;
    }
  }
  for (const [k, a] of agreements.filter((x) => x.status === 'active').slice(0, 5).entries()) {
    const issue = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1));
    await w.insert('invoices', {
      id: id(`invoice-draft:${k}`), tenant_id: t, client_id: a.client.id, invoice_number: `${spec.key === 'symphony' ? 'AD' : 'AV'}-CONCEPT-${k + 1}`, description: `Concept – volgende maand – ${a.client.name}`,
      issue_date: dateOnly(issue), due_date: dateOnly(new Date(issue.getTime() + 30 * DAY)), amount_excl_vat: money(a.annual / 12), vat_amount: money((a.annual / 12) * 0.21), status: 'draft', paid_at: null,
    });
  }

  // Financial plans --------------------------------------------------------------------------------------------------
  const plans = spec.key === 'symphony' ? 16 : 3;
  for (let i = 0; i < plans; i++) {
    const a = agreements[i % agreements.length];
    const mid = id(`plan:${i}`);
    const fy = i % 4 === 3 ? year - 1 : year;
    await w.insert('financial_models', { id: mid, tenant_id: t, model_name: `${a.client.name} – Joint Business Plan ${fy}`, fiscal_year: fy, status: i % 5 === 4 ? 'draft' : 'approved', metadata: { source: 'agera-demo', clientId: a.client.id } });
    const currentQ = Math.floor(NOW.getUTCMonth() / 3) + 1;
    for (let q = 1; q <= 4; q++) {
      for (const [cat, share] of [['revenue', 0.25], ['cogs', 0.15], ['opex', 0.04]] as const) {
        const projected = a.annual * share;
        const past = fy < year || q < currentQ;
        const actual = past ? projected * (0.78 + r.next() * 0.35) : null;
        await w.insert('financial_line_items', {
          id: id(`line:${i}:${q}:${cat}`), tenant_id: t, model_id: mid, category: cat, subcategory: cat === 'revenue' ? 'Contractomzet' : cat === 'cogs' ? 'Inkoop' : 'Promotiekosten',
          period_code: `${fy}-Q${q}`, projected_amount: money(projected), actual_amount: actual === null ? null : money(actual), currency: 'EUR',
        });
      }
    }
  }

  // Audit rounds, work orders, visits, reports, field orders ------------------------------------------------------------
  const rounds: string[] = [];
  for (const [i, [name, checklist, status]] of ([
    ['Q3 promotie-check', ['Promotiedisplay staat op de afgesproken plek', 'Actieprijzen kloppen met de folder', 'Voldoende voorraad promotieartikelen'], 'closed'],
    ['Planogram audit Zuivel', ['Schap volgt het planogram', 'Prijskaartjes aanwezig en correct', 'Houdbaarheid gecontroleerd'], 'open'],
    ['Kerstdisplays', ['Kerstdisplay opgebouwd', 'Displaymateriaal compleet', 'Foto gemaakt van het display'], 'open'],
    ['Prijsintegriteit', ['Schapprijs gelijk aan kassaprijs', 'Geen verlopen actiekaartjes'], 'closed'],
  ] as [string, string[], string][]).slice(0, spec.key === 'symphony' ? 4 : 1).entries()) {
    const rid = id(`round:${i}`);
    rounds.push(rid);
    await w.insert('audit_rounds', { id: rid, tenant_id: t, name, checklist, due_date: dateOnly(daysAgo(status === 'closed' ? 30 + i * 20 : -14 - i * 7)), status, created_by: fieldLead, created_at: daysAgo(90 - i * 10) });
  }
  const workOrders: { id: string; user: string; status: string }[] = [];
  for (let i = 0; i < spec.counts.workOrders; i++) {
    const s = r.pick(stores);
    const user = fieldByZone[s.zone];
    const roll = r.next();
    const status = roll < 0.6 ? 'COMPLETED' : roll < 0.75 ? 'IN_PROGRESS' : roll < 0.95 ? 'PENDING' : 'CANCELLED';
    const created = r.int(1, 120);
    const woId = id(`workorder:${i}`);
    workOrders.push({ id: woId, user, status });
    await w.insert('work_orders', {
      id: woId, tenant_id: t, title: `${r.pick(WORK_TITLES)} – ${s.name}`, description: `Winkel ${s.name}. ${r.pick(['Graag voor het weekend afronden.', 'Afstemmen met de filiaalmanager.', 'Foto’s toevoegen aan het bezoekrapport.', 'Let op de nieuwe actieperiode.'])}`,
      status, assigned_user_id: status === 'PENDING' && r.chance(0.3) ? null : user, priority: r.pick(['low', 'normal', 'normal', 'high', 'urgent']), created_at: daysAgo(created),
      completed_at: status === 'COMPLETED' ? daysAgo(Math.max(0, created - r.int(1, 10))) : null,
    });
    const path = status === 'COMPLETED' ? ['PENDING', 'IN_PROGRESS', 'COMPLETED'] : status === 'IN_PROGRESS' ? ['PENDING', 'IN_PROGRESS'] : status === 'CANCELLED' ? ['PENDING', 'CANCELLED'] : [];
    for (let k = 1; k < path.length; k++) {
      await w.insert('work_order_logs', { id: id(`wolog:${i}:${k}`), tenant_id: t, work_order_id: woId, previous_status: path[k - 1], new_status: path[k], changed_by_user_id: k === 1 ? fieldLead : user, created_at: daysAgo(Math.max(0, created - k)) });
    }
  }
  const visits: { id: string; storeId: string; rep: string; date: Date; status: string }[] = [];
  for (let i = 0; i < spec.counts.visits; i++) {
    const s = stores[i % stores.length];
    const rep = fieldByZone[s.zone];
    const future = i % 11 === 0;
    const ago = future ? -r.int(1, 21) : r.int(0, 150);
    const status = future ? 'PLANNED' : ago === 0 ? r.pick(['IN_PROGRESS', 'PLANNED']) : r.chance(0.05) ? 'CANCELLED' : 'COMPLETED';
    const vid = id(`visit:${i}`);
    const date = daysAgo(ago, 8 + (i % 9));
    visits.push({ id: vid, storeId: s.id, rep, date, status });
    const wo = r.chance(0.2) ? workOrders.find((x) => x.user === rep) : undefined;
    await w.insert('merchandising_visits', {
      id: vid, tenant_id: t, store_id: s.id, field_rep_id: rep, work_order_id: wo?.id ?? null, visit_date: date, status, audit_round_id: rounds.length && r.chance(0.25) ? r.pick(rounds) : null,
      notes: status === 'PLANNED' ? 'Gepland bezoek' : null, created_at: new Date(date.getTime() - 3 * DAY),
    });
    if (status !== 'COMPLETED') continue;
    const roll = r.next();
    const compliance = roll < 0.75 ? 'compliant' : roll < 0.9 ? 'flagged_anomaly' : 'variance_pending';
    const oos = r.chance(0.25) ? r.sample(products, r.int(1, 3)).map((p) => p.name) : [];
    const plan = r.chance(0.5) ? r.pick(planograms) : null;
    const checks = plan ? plan.items.map((it) => ({ productId: it.productId, expectedFacings: it.facings, actualFacings: Math.max(0, it.facings - (r.chance(0.25) ? r.int(1, it.facings) : 0)) })) : undefined;
    const expected = checks?.reduce((s2, c2) => s2 + c2.expectedFacings, 0) ?? 0;
    const matched = checks?.reduce((s2, c2) => s2 + Math.min(c2.actualFacings, c2.expectedFacings), 0) ?? 0;
    await w.insert('visit_reports', {
      id: id(`report:${i}`), tenant_id: t, visit_id: vid,
      summary: compliance === 'compliant' ? r.pick(['Schap op orde, promotie goed zichtbaar.', 'Alles volgens afspraak; prijzen gecontroleerd.', 'Schap aangevuld en gefaced.']) : compliance === 'flagged_anomaly' ? r.pick(['Promotiedisplay niet opgebouwd', 'Schap grotendeels leeg', 'Verkeerde prijskaartjes']) : 'Vertraagde schapinrichting, opvolging nodig',
      audit_data: { complianceStatus: compliance, ...(oos.length ? { outOfStockItems: oos } : {}), ...(checks ? { planogramChecks: checks, planogramScore: expected ? Math.round((matched / expected) * 100) : null } : {}), facings: r.int(6, 30), priceTagsOk: compliance === 'compliant' || r.chance(0.5) },
      created_at: new Date(date.getTime() + 2 * 3600_000),
    });
  }
  for (let i = 0; i < spec.counts.fieldOrders; i++) {
    const v = visits.filter((x) => x.status === 'COMPLETED')[i % Math.max(1, visits.filter((x) => x.status === 'COMPLETED').length)];
    if (!v) break;
    const oid = id(`fieldorder:${i}`);
    const status = r.pick(['draft', 'submitted', 'submitted', 'confirmed', 'delivered', 'delivered', 'cancelled']);
    await w.insert('field_orders', { id: oid, tenant_id: t, store_id: v.storeId, visit_id: v.id, status, notes: r.chance(0.3) ? 'Spoedlevering gevraagd' : null, created_by: v.rep, submitted_at: status === 'draft' ? null : v.date, created_at: v.date });
    for (const [k, p] of r.sample(products, r.int(2, 6)).entries()) {
      await w.insert('field_order_lines', { id: id(`fol:${i}:${k}`), tenant_id: t, order_id: oid, product_id: p.id, quantity: r.pick([6, 12, 12, 24, 48, 60]), unit_price: money(p.price) });
    }
  }

  // RetailPower operations: crew, shifts, vehicles, apparel, returns, stock claims ----------------------------------------
  const crewKeys = spec.key === 'symphony' ? ['field1', 'field2', 'field3', 'fieldlead'] : ['user'];
  const zoneOf: Record<string, string> = { field1: 'Noord', field2: 'Midden', field3: 'Zuid', fieldlead: 'Midden', user: 'Midden' };
  const LANGS = [['nl', 'en'], ['nl', 'en', 'de'], ['nl', 'ar', 'en'], ['nl', 'tr'], ['nl', 'pl', 'en'], ['nl', 'fr']];
  const CERTS = BRANDS.slice(0, 8);
  for (const [i, key] of crewKeys.entries()) {
    const uid = userId[key];
    if (!uid) continue;
    await w.insert('merchandisers', {
      id: id(`crew:${key}`), tenant_id: t, user_id: uid, contract_type: i % 3 === 2 ? 'flex' : 'fixed', languages: `{${LANGS[i % LANGS.length].join(',')}}`,
      brand_certifications: `{${r.sample(CERTS, r.int(1, 3)).map((b) => `"${b}"`).join(',')}}`, available_days: i % 3 === 2 ? '{2,4,6}' : '{1,2,3,4,5}',
      availability: i === 1 ? 'busy' : 'available', home_region: zoneOf[key], phone: `06${r.int(10000000, 99999999)}`,
    });
  }
  const crewUsers = crewKeys.map((k) => userId[k]).filter(Boolean);
  const coordinator = fieldLead === userId.user ? (userId.admin ?? fieldLead) : fieldLead;
  const doneVisits = visits.filter((v) => v.status === 'COMPLETED' && v.date.getTime() > NOW.getTime() - 45 * DAY);
  for (const [i, v] of doneVisits.slice(0, spec.key === 'symphony' ? 120 : 15).entries()) {
    const start = new Date(v.date.getTime() + (8 + (i % 3)) * 3600_000);
    const end = new Date(start.getTime() + r.int(3, 8) * 3600_000 + r.pick([0, 15, 30, 45]) * 60_000);
    const age = (NOW.getTime() - start.getTime()) / DAY;
    const status = age < 7 ? 'pending' : i % 23 === 4 ? 'rejected' : 'approved';
    const far = i % 17 === 3;
    await w.insert('shift_logs', {
      id: id(`shift:${i}`), tenant_id: t, user_id: v.rep, store_id: v.storeId, visit_id: v.id, clock_in_at: start, clock_out_at: end,
      geofence_distance_m: far ? r.int(400, 2500) : r.int(5, 180), validation_status: status,
      validated_by: status === 'pending' || v.rep === coordinator ? (status === 'pending' ? null : (userId.admin ?? coordinator)) : coordinator,
      validated_at: status === 'pending' ? null : new Date(end.getTime() + DAY), rejection_reason: status === 'rejected' ? 'Clock-in far from the store; please explain' : null,
    });
  }
  const PLATES = ['V-123-KB', 'V-456-LN', 'V-789-PR', 'V-321-ST', 'V-654-HG'];
  const VANS = ['VW Caddy', 'Renault Kangoo', 'Peugeot Partner', 'Ford Transit Connect', 'Opel Combo'];
  for (const [i, uid] of crewUsers.entries()) {
    await w.insert('vehicle_allocations', {
      id: id(`vehicle:${i}`), tenant_id: t, user_id: uid, vehicle_id: PLATES[i % PLATES.length], vehicle_description: VANS[i % VANS.length],
      allocated_from: daysAgo(r.int(0, 5)), status: 'pending_check', created_by: coordinator,
    });
    for (const [k, item] of (['polo', 'polo', 'jacket', 'cap', 'shoes'] as const).entries()) {
      if (k > 1 && r.chance(0.4)) continue;
      await w.insert('apparel_assignments', {
        id: id(`apparel:${i}:${k}`), tenant_id: t, user_id: uid, item, size: item === 'shoes' ? String(r.int(38, 46)) : item === 'cap' ? null : r.pick(['S', 'M', 'L', 'XL']),
        quantity: item === 'polo' ? 2 : 1, issued_on: daysAgo(r.int(30, 300)), returned_on: k === 1 && i % 2 === 1 ? daysAgo(r.int(1, 20)) : null,
      });
    }
  }
  const rmaFlow = ['open', 'open', 'approved', 'shipped', 'credited', 'credited', 'rejected'] as const;
  for (let i = 0; i < (spec.key === 'symphony' ? 24 : 4); i++) {
    const s = stores[(i * 7) % stores.length];
    const p = products.length ? products[(i * 5) % products.length] : null;
    const status = rmaFlow[i % rmaFlow.length];
    const created = daysAgo(r.int(2, 120));
    await w.insert('rma_cases', {
      id: id(`rma:${i}`), tenant_id: t, case_number: `RMA-${created.getFullYear()}-${String(i + 1).padStart(4, '0')}`, store_id: s.id, product_id: p?.id ?? null, client_id: s.clientId,
      quantity: r.pick([1, 2, 6, 12, 24]), reason: r.pick(['damaged', 'expired', 'recall', 'wrong_delivery', 'defective', 'other']), status,
      description: r.pick(['Doos beschadigd bij levering', 'THT verstreken op schap', 'Terugroepactie leverancier', null]), opened_by: crewUsers[i % crewUsers.length] ?? coordinator,
      closed_at: status === 'credited' || status === 'rejected' ? new Date(created.getTime() + 10 * DAY) : null, created_at: created,
    });
  }
  const claimFlow = ['submitted', 'submitted', 'approved', 'paid', 'paid', 'rejected'] as const;
  for (let i = 0; i < (spec.key === 'symphony' ? 18 : 3); i++) {
    const s = stores[(i * 11 + 3) % stores.length];
    const p = products.length ? products[(i * 3) % products.length] : null;
    const status = claimFlow[i % claimFlow.length];
    const qty = r.pick([6, 12, 24, 48]);
    const created = daysAgo(r.int(2, 90));
    await w.insert('stock_protection_claims', {
      id: id(`claim:${i}`), tenant_id: t, store_id: s.id, product_id: p?.id ?? null, client_id: s.clientId, claim_type: r.pick(['price_protection', 'damaged', 'shrinkage', 'expired', 'other']),
      quantity: qty, amount: money(qty * (p?.price ?? 2) * 0.3), status, submitted_by: crewUsers[i % crewUsers.length] ?? coordinator,
      decided_by: status === 'submitted' ? null : finance, decided_at: status === 'submitted' ? null : new Date(created.getTime() + 5 * DAY), created_at: created,
    });
  }

  // Exceptions, approvals, notifications ---------------------------------------------------------------------------------
  for (let i = 0; i < spec.counts.exceptions; i++) {
    const s = r.pick(stores);
    const status = i % 3 === 0 ? 'resolved' : i % 3 === 1 ? 'in_progress' : 'open';
    const c = clients.find((x) => x.id === s.clientId)!;
    await w.insert('exceptions', {
      id: id(`exception:${i}`), tenant_id: t, title: `${r.pick(EXCEPTION_TITLES)} – ${s.name}`, description: 'Gemeld tijdens winkelbezoek; zie bezoekrapport.', severity: r.pick(['low', 'medium', 'medium', 'high']), status,
      owner_id: r.pick([fieldLead, c.am]), store_id: s.id, client_id: c.id, source: r.pick(['manual', 'visit', 'automation']), resolution: status === 'resolved' ? 'Opgelost met de filiaalmanager; schap hersteld.' : null,
      created_by: fieldByZone[s.zone], resolved_at: status === 'resolved' ? daysAgo(r.int(1, 20)) : null, created_at: daysAgo(r.int(2, 60)),
    });
  }
  if (spec.tier === 'symphony') {
    for (const [i, a] of agreements.entries()) {
      if (a.status === 'expired' || (a.status === 'active' && i % 4 !== 0)) continue;
      const reqId = id(`approval:${i}`);
      const pending = a.status === 'pending_approval';
      await w.insert('approval_requests', {
        id: reqId, tenant_id: t, entity_type: 'agreement', entity_id: a.id, entity_label: `Jaarovereenkomst ${year} – ${a.client.name}`, note: pending ? 'Graag akkoord voor de start van het nieuwe kwartaal.' : null,
        status: pending ? 'pending' : 'approved', requested_by: a.client.am, created_at: daysAgo(pending ? r.int(1, 10) : r.int(40, 200)), decided_at: pending ? null : daysAgo(r.int(20, 39)),
      });
      const firstDone = !pending || i % 2 === 0;
      await w.insert('approval_steps', { id: id(`approval-step:${i}:1`), tenant_id: t, request_id: reqId, step_order: 1, approver_id: director, decision: firstDone ? 'approved' : 'pending', comment: firstDone ? 'Akkoord, past binnen de jaarplanning.' : null, decided_at: firstDone ? daysAgo(1) : null });
      await w.insert('approval_steps', { id: id(`approval-step:${i}:2`), tenant_id: t, request_id: reqId, step_order: 2, approver_id: finance, decision: pending ? 'pending' : 'approved', comment: pending ? null : 'Krediet gecontroleerd.', decided_at: pending ? null : daysAgo(20) });
    }
  }
  const notes: [string, string, string][] = [
    ['Nieuwe goedkeuring gevraagd', 'Een jaarovereenkomst wacht op jouw akkoord.', '/symphony/approvals'],
    ['Factuur over de vervaldatum', 'Er staan facturen open die over de vervaldatum zijn.', '/symphony/invoices'],
    ['Uitzondering gemeld', 'In een winkel is een uitzondering gemeld tijdens een bezoek.', '/nexus/exceptions'],
    ['Werkorder toegewezen', 'Er is een nieuwe werkorder aan je toegewezen.', '/retailpower/work-orders'],
    ['Klant heeft een document bekeken', 'Een klantcontact opende de contractzone in de klantroom.', '/nexus/client-rooms'],
  ];
  for (const [ui, u] of internal.entries()) {
    for (let k = 0; k < 5; k++) {
      const [title, body, link] = notes[(ui + k) % notes.length];
      await w.insert('notifications', { id: id(`notification:${ui}:${k}`), tenant_id: t, user_id: u, title, body, link, read_at: k > 2 ? daysAgo(1) : null, created_at: daysAgo(k * 2, 9 + k) });
    }
  }

  // Templates, automations, saved report ----------------------------------------------------------------------------------
  const templates: [string, string, string][] = [
    ['Voorstel jaarplan', 'proposal', 'Voorstel Joint Business Plan voor {{client.name}}\n\nBeste {{contact.name}},\n\nHierbij ons voorstel voor het komende jaar. Betalingstermijn: {{client.paymentTerms}}.\n\nMet vriendelijke groet,\n{{user.name}}'],
    ['Jaarovereenkomst', 'agreement', 'JAAROVEREENKOMST\n\nTussen Agera Demo en {{client.legalName}} (KvK {{client.kvk}}, btw {{client.vat}}), gevestigd te {{client.address}}.\n\nDatum: {{today}}\n\nPrijsafspraken:\n{{priceList}}'],
    ['Begeleidende brief', 'letter', '{{client.name}}\nT.a.v. {{contact.name}}\n{{client.address}}\n\n{{client.city}}, {{today}}\n\nBeste {{contact.name}},\n\n...'],
    ['Uitnodiging kwartaaloverleg', 'mail', 'Beste {{contact.name}},\n\nGraag plannen we het kwartaaloverleg voor {{client.name}}. Schikt een van de volgende momenten?\n\nGroet,\n{{user.name}}'],
    ['Herinnering openstaande factuur', 'mail', 'Beste {{contact.name}},\n\nVolgens onze administratie staat er nog een factuur open voor {{client.name}}. Wilt u de betaling controleren?\n\nMet vriendelijke groet,\n{{user.name}}'],
  ];
  for (const [i, [name, kind, body]] of templates.entries()) {
    await w.insert('document_templates', { id: id(`template:${i}`), tenant_id: t, name, kind, body, active: true, created_by: userId.admin });
  }
  const automations: { name: string; trigger: string; steps: Row[] }[] = spec.tier === 'symphony'
    ? [
        { name: 'Hoge uitzondering → teamlead', trigger: 'exception.created', steps: [{ condition: { field: 'severity', op: 'equals', value: 'high' }, action: 'notify_user', config: { userId: fieldLead, title: 'Hoge uitzondering gemeld' }, delayMinutes: 0 }] },
        { name: 'Afgekeurde goedkeuring → directeur', trigger: 'approval.rejected', steps: [{ condition: null, action: 'notify_user', config: { userId: director, title: 'Goedkeuring afgekeurd' }, delayMinutes: 0 }] },
        { name: 'Kredietblokkade → finance en uitzondering', trigger: 'credit_hold.set', steps: [
          { condition: null, action: 'notify_user', config: { userId: finance, title: 'Kredietblokkade gezet' }, delayMinutes: 0 },
          { condition: null, action: 'create_exception', config: { title: 'Kredietblokkade opvolgen', severity: 'medium' }, delayMinutes: 1440 },
        ] },
        { name: 'Deal naar overdracht → operations', trigger: 'deal.stage_changed', steps: [{ condition: { field: 'toStage', op: 'equals', value: 'ops_handoff' }, action: 'notify_user', config: { userId: fieldLead, title: 'Nieuwe klant naar operations' }, delayMinutes: 0 }] },
      ]
    : [{ name: 'Uitzondering → beheerder', trigger: 'exception.created', steps: [{ condition: null, action: 'notify_user', config: { userId: userId.admin, title: 'Nieuwe uitzondering' }, delayMinutes: 0 }] }];
  for (const [i, a] of automations.entries()) {
    const aid = id(`automation:${i}`);
    const runs = r.int(3, 12);
    await w.insert('automations', { id: aid, tenant_id: t, name: a.name, trigger: a.trigger, steps: a.steps, active: true, run_count: runs, last_run_at: daysAgo(r.int(0, 10)), created_by: userId.admin });
    for (let k = 0; k < Math.min(runs, 6); k++) {
      await w.insert('automation_runs', { id: id(`automation-run:${i}:${k}`), tenant_id: t, automation_id: aid, step_index: 0, status: k % 4 === 3 ? 'skipped' : 'done', run_at: daysAgo(k * 4), event: { action: a.trigger }, detail: k % 4 === 3 ? 'Condition not met' : null });
    }
  }
  if (spec.tier === 'symphony') {
    await w.insert('saved_reports', {
      id: id('report:clients'), tenant_id: t, name: 'Klanten per accountmanager', pinned: true, created_by: director,
      definition: { dataset: 'clients', columns: ['name', 'sector', 'city', 'creditStatus', 'accountManager'], filters: [], groupBy: null, aggregate: null, sort: { column: 'name', direction: 'asc' }, limit: 500 },
    });
  }

  // Surveys -------------------------------------------------------------------------------------------------------
  type Q = { id: string; type: string; label: string; required?: boolean; options?: string[]; showIf?: { questionId: string; equals: string } | null };
  const surveys: { title: string; status: string; questions: Q[]; reach: number; daysAgo: number }[] = [
    { title: 'Relatie-NPS ' + year, status: 'active', reach: 1, daysAgo: 45, questions: [
      { id: 'q1', type: 'nps', label: 'Hoe waarschijnlijk is het dat u ons aanbeveelt?', required: true },
      { id: 'q2', type: 'csat', label: 'Hoe tevreden bent u over de samenwerking?' },
      { id: 'q3', type: 'text', label: 'Wat kunnen we beter doen?' },
    ] },
    { title: 'Tevredenheid winkelbezoeken', status: 'active', reach: 0.6, daysAgo: 25, questions: [
      { id: 'q1', type: 'csat', label: 'Hoe tevreden bent u over de winkelbezoeken?', required: true },
      { id: 'q2', type: 'text', label: 'Opmerkingen over onze merchandisers' },
    ] },
    { title: 'Service & levering', status: 'active', reach: 0.5, daysAgo: 70, questions: [
      { id: 'q1', type: 'nps', label: 'Hoe waarschijnlijk is het dat u onze levering aanbeveelt?', required: true },
      { id: 'q2', type: 'single_choice', label: 'Werd er op tijd geleverd?', options: ['Altijd', 'Meestal', 'Soms niet'] },
      { id: 'q3', type: 'multi_choice', label: 'Wat ging er mis?', options: ['Te laat', 'Onvolledig', 'Beschadigd', 'Verkeerde artikelen'], showIf: { questionId: 'q2', equals: 'Soms niet' } },
      { id: 'q4', type: 'rating', label: 'Beoordeel de communicatie (1–5)' },
    ] },
    { title: 'Evaluatie promotiedisplays', status: 'closed', reach: 0.4, daysAgo: 150, questions: [
      { id: 'q1', type: 'rating', label: 'Hoe beoordeelt u de displays?' },
      { id: 'q2', type: 'single_choice', label: 'Wilt u volgend jaar weer displays?', options: ['Ja', 'Nee', 'Misschien'] },
    ] },
    { title: 'Onboarding nieuwe klanten', status: 'draft', reach: 0, daysAgo: 5, questions: [
      { id: 'q1', type: 'csat', label: 'Hoe verliep de start van de samenwerking?' },
      { id: 'q2', type: 'text', label: 'Wat miste u in de eerste maand?' },
    ] },
    { title: 'Jaarevaluatie ' + (year - 1), status: 'archived', reach: 0.7, daysAgo: 300, questions: [
      { id: 'q1', type: 'nps', label: 'Hoe waarschijnlijk is het dat u ons aanbeveelt?' },
      { id: 'q2', type: 'text', label: 'Wat was het hoogtepunt van het jaar?' },
    ] },
  ];
  const vanguardTypes = new Set(['nps', 'csat', 'text']);
  const usable = spec.tier === 'symphony' ? surveys : surveys.filter((s) => s.questions.every((q) => vanguardTypes.has(q.type) && !q.showIf)).slice(0, 2);
  const texts = ['Snelle opvolging, prettig contact.', 'Levering kan beter op maandag.', 'Graag vaker overleg over promoties.', 'Merchandisers zijn erg behulpzaam.', 'Facturen zijn soms onduidelijk.', 'Goede samenwerking dit jaar!', 'Meer inzicht in de schapresultaten graag.'];
  for (const [si, s] of usable.entries()) {
    const sid = id(`survey:${si}`);
    await w.insert('surveys', { id: sid, tenant_id: t, title: s.title, description: 'Uw mening helpt ons de samenwerking te verbeteren.', status: s.status, questions: s.questions, created_by: userId.am1 ?? userId.admin, created_at: daysAgo(s.daysAgo + 5) });
    if (s.reach === 0) continue;
    const targeted = active.filter((_, i) => (i * 37 + si * 11) % 100 < s.reach * 100);
    const did = id(`dispatch:${si}`);
    const contacts = targeted.reduce((n, c) => n + c.contacts.length, 0);
    await w.insert('survey_dispatches', {
      id: did, tenant_id: t, survey_id: sid, target_type: s.reach === 1 ? 'client_cohort' : spec.tier === 'symphony' ? 'client_cohort' : 'client_cohort', client_id: null, client_room_id: null,
      filter_criteria: s.reach === 1 ? { all: true } : { sector: null }, dispatched_by: userId.am1 ?? userId.admin, total_targeted: targeted.length, total_contacts: contacts, created_at: daysAgo(s.daysAgo),
    });
    for (const [ci, c] of targeted.entries()) {
      await w.insert('survey_dispatch_clients', { tenant_id: t, dispatch_id: did, survey_id: sid, client_id: c.id, client_room_id: null });
      const unhappy = latePayers.has(c.id) || c.credit !== 'approved';
      for (const [k, ct] of c.contacts.entries()) {
        if (!r.chance(0.55)) continue;
        if (ct.email.endsWith('.example') && spec.personas.some((p) => p.email === ct.email)) continue;
        const answers: Record<string, unknown> = {};
        let nps: number | null = null;
        for (const q of s.questions) {
          if (q.showIf && answers[q.showIf.questionId] !== q.showIf.equals) continue;
          if (q.type === 'nps') answers[q.id] = nps = unhappy ? r.int(2, 7) : r.int(6, 10);
          else if (q.type === 'csat' || q.type === 'rating') answers[q.id] = unhappy ? r.int(1, 3) : r.int(3, 5);
          else if (q.type === 'text') { if (r.chance(0.6)) answers[q.id] = r.pick(texts); }
          else if (q.type === 'single_choice') answers[q.id] = unhappy && q.options!.length > 2 ? q.options![2] : r.pick(q.options!);
          else if (q.type === 'multi_choice') answers[q.id] = r.sample(q.options!, r.int(1, 2));
        }
        await w.insert('survey_responses', {
          id: id(`response:${si}:${ci}:${k}`), tenant_id: t, survey_id: sid, dispatch_id: did, client_id: c.id, contact_id: ct.id, respondent_email: ct.email, answers, nps_score: nps,
          submitted_at: daysAgo(Math.max(0, s.daysAgo - r.int(1, Math.min(30, s.daysAgo))), 9 + (k % 8)),
        });
      }
    }
  }

  // Office documents in client dossiers -------------------------------------------------------------------------------
  const docTypes: Record<string, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  const blanks: Record<string, Buffer> = {};
  for (const f of Object.keys(docTypes)) blanks[f] = await readFile(join(ASSETS, `blank.${f}`));
  const docClients = agreements.slice(0, spec.tier === 'symphony' ? 20 : 4);
  for (const [i, a] of docClients.entries()) {
    const docs: [string, string][] = [[`Jaarovereenkomst ${year} – ${a.client.name}`, 'docx'], [`Prijsmatrix ${year} – ${a.client.name}`, 'xlsx']];
    if (i % 3 === 0) docs.push([`Kwartaalpresentatie Q${Math.floor(NOW.getUTCMonth() / 3) + 1} – ${a.client.name}`, 'pptx']);
    for (const [k, [title, fmt]] of docs.entries()) {
      const docId = id(`document:${i}:${k}`);
      const versionId = id(`document-version:${i}:${k}`);
      const fileName = `${title.replace(/[^\p{L}\p{N}._ -]/gu, '_')}.${fmt}`;
      const key = `${t}/clients/${a.client.id}/${versionId}-${fileName}`;
      const data = blanks[fmt];
      await mkdir(dirname(join(UPLOAD_DIR, key)), { recursive: true });
      await writeFile(join(UPLOAD_DIR, key), data);
      await w.insert('room_documents', {
        id: docId, tenant_id: t, client_room_id: k === 0 && a.status !== 'expired' ? a.roomId : null, client_id: a.client.id, contact_id: a.client.contacts[0]?.id ?? null, title, current_version: 1,
        file_format: fmt, created_by: a.client.am, last_modified_by: a.client.am, created_at: daysAgo(r.int(5, 90)),
      });
      await w.insert('room_document_versions', {
        id: versionId, tenant_id: t, document_id: docId, version: 1, file_name: fileName, mime_type: docTypes[fmt], size_bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'), storage_key: key, uploaded_by: a.client.am,
      });
    }
  }

  // Activity log -----------------------------------------------------------------------------------------------------
  for (const [i, c] of clients.entries()) {
    await w.insert('audit_logs', { id: id(`audit:client:${i}`), tenant_id: t, user_id: c.am, action: 'client.created', details: { clientId: c.id, name: c.name }, created_at: daysAgo(200 + (i % 300)) });
  }
  for (const [i, a] of agreements.entries()) {
    await w.insert('audit_logs', { id: id(`audit:agreement:${i}`), tenant_id: t, user_id: a.client.am, action: 'agreement.created', details: { agreementId: a.id, clientId: a.client.id }, created_at: daysAgo(30 + (i % 200)) });
  }

  console.log(`  ${spec.name}: ${w.count} records (${clients.length} clients, ${stores.length} stores, ${agreements.length} agreements, ${invNo - 1} invoices, ${visits.length} visits)`);
  return t;
}

function loginsText(logins: Login[], publicUrl: string): string {
  const lines = [
    'AGERA DEMO LOGINS',
    `Generated ${NOW.toISOString().slice(0, 16).replace('T', ' ')} UTC. Log in at ${publicUrl} with the e-mail address and password.`,
    'Running the demo seed again creates new passwords. Keep this file private.',
    '',
  ];
  for (const tenant of [...new Set(logins.map((l) => l.tenant))]) {
    lines.push(`== ${tenant} ==`);
    for (const l of logins.filter((x) => x.tenant === tenant)) {
      const level = l.persona.role === 'External_Client' ? `Client contact (${l.clientName})` : l.persona.role === 'admin' ? 'Admin' : 'User';
      lines.push(`${l.persona.first} ${l.persona.last} — ${l.persona.title} — ${level}`);
      lines.push(`  Login:    ${l.persona.email}`);
      lines.push(`  Password: ${l.password}`);
      lines.push(`  Try:      ${l.persona.hint}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const resetOnly = process.argv.includes('--reset-only');
  const db = new pg.Client({
    host: env('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    user: env('SEED_DB_USER', process.env.POSTGRES_USER),
    password: env('SEED_DB_PASSWORD', process.env.POSTGRES_PASSWORD),
    database: env('DB_NAME', process.env.POSTGRES_DB),
  });
  await db.connect();
  const logins: Login[] = [];
  const keycloakUsers: Row[] = [];
  try {
    await db.query('BEGIN');
    await reset(db);
    if (!resetOnly) for (const spec of SPECS) await generate(db, spec, logins, keycloakUsers);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    await db.end();
  }
  await mkdir(OUT_DIR, { recursive: true });
  const allIds = SPECS.flatMap((s) => s.personas.map((p) => demoUuid(`${s.key}:user:${p.key}`)));
  await writeFile(join(OUT_DIR, 'keycloak-user-ids.txt'), `${allIds.join('\n')}\n`);
  if (resetOnly) {
    console.log('Demo organisations removed.');
    return;
  }
  await writeFile(join(OUT_DIR, 'keycloak-users.json'), JSON.stringify({ ifResourceExists: 'OVERWRITE', users: keycloakUsers }, null, 2));
  await writeFile(join(OUT_DIR, 'demo-logins.txt'), loginsText(logins, process.env.PUBLIC_URL ?? 'the Agera web address'), { mode: 0o600 });
  console.log(`Demo data created; ${logins.length} logins written to ${join(OUT_DIR, 'demo-logins.txt')}.`);
}

if (process.argv[1]?.endsWith('demo-seed.js') || process.argv[1]?.endsWith('demo-seed.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
