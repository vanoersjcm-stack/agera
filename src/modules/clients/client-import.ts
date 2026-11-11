import { BadRequestException } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';

/** Bulk import of clients and contacts from CSV or XLSX (Nexus › Clients › Import). */

export const IMPORT_FIELDS = [
  'name', 'legalName', 'kvkNumber', 'erpId', 'vatNumber', 'sector', 'address', 'city', 'country', 'paymentTerms', 'accountManagerEmail',
  'contactFirstName', 'contactLastName', 'contactEmail', 'contactPhone', 'contactRole',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ImportRow = Partial<Record<ImportField, string>>;

const ALIASES: Record<ImportField, string[]> = {
  name: ['name', 'client', 'clientname', 'company', 'companyname', 'bedrijf', 'bedrijfsnaam', 'klant', 'klantnaam', 'naam'],
  legalName: ['legalname', 'statutairenaam', 'juridischenaam'],
  kvkNumber: ['kvk', 'kvknumber', 'kvknummer', 'chamberofcommerce', 'coc'],
  erpId: ['erpid', 'erp', 'erpnummer', 'customernumber', 'klantnummer', 'debiteurnummer'],
  vatNumber: ['vat', 'vatnumber', 'btw', 'btwnummer'],
  sector: ['sector', 'branche'],
  address: ['address', 'adres'],
  city: ['city', 'plaats', 'stad', 'woonplaats'],
  country: ['country', 'land'],
  paymentTerms: ['paymentterms', 'betalingstermijn'],
  accountManagerEmail: ['accountmanager', 'accountmanageremail'],
  contactFirstName: ['contactfirstname', 'firstname', 'voornaam'],
  contactLastName: ['contactlastname', 'lastname', 'achternaam'],
  contactEmail: ['contactemail', 'email', 'emailaddress', 'emailadres'],
  contactPhone: ['contactphone', 'phone', 'telefoon', 'telefoonnummer'],
  contactRole: ['contactrole', 'role', 'roletitle', 'functie'],
};
const LOOKUP = new Map<string, ImportField>(Object.entries(ALIASES).flatMap(([field, names]) => names.map((n) => [n, field as ImportField])));

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export function parseImportFile(data: Buffer): { rows: ImportRow[]; ignoredColumns: string[] } {
  const table = data.subarray(0, 2).toString('latin1') === 'PK' ? readXlsx(data) : readCsv(data.toString('utf8'));
  const nonEmpty = table.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) throw new BadRequestException('The file is empty');
  const [header, ...body] = nonEmpty;
  const columns = header.map((h) => LOOKUP.get(h.toLowerCase().replace(/[^a-z0-9]/g, '')) ?? null);
  if (!columns.includes('name')) throw new BadRequestException('The file needs a "name" column (client name)');
  if (body.length > MAX_IMPORT_ROWS) throw new BadRequestException(`At most ${MAX_IMPORT_ROWS} rows per import`);
  const ignoredColumns = header.filter((h, i) => columns[i] === null && h.trim() !== '');
  const rows = body.map((cells) => {
    const row: ImportRow = {};
    columns.forEach((field, i) => {
      const v = (cells[i] ?? '').trim();
      if (field && v) row[field] = v;
    });
    return row;
  });
  return { rows, ignoredColumns };
}

/** RFC 4180 CSV; the delimiter (comma, semicolon or tab) is taken from the header line. */
export function readCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) rows.push([...row, cell]);
  return rows;
}

function unzip(data: Buffer): Map<string, () => Buffer> {
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65_557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new BadRequestException('The file is not a valid .xlsx workbook');
  const entries = new Map<string, () => Buffer>();
  let p = data.readUInt32LE(end + 16);
  const count = data.readUInt16LE(end + 10);
  for (let n = 0; n < count && data.readUInt32LE(p) === 0x02014b50; n++) {
    const method = data.readUInt16LE(p + 10);
    const size = data.readUInt32LE(p + 20);
    const nameLen = data.readUInt16LE(p + 28);
    const local = data.readUInt32LE(p + 42);
    const name = data.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + data.readUInt16LE(p + 30) + data.readUInt16LE(p + 32);
    entries.set(name, () => {
      const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
      const raw = data.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw, { maxOutputLength: 50 * 1024 * 1024 });
      throw new BadRequestException('The .xlsx workbook uses an unsupported compression');
    });
  }
  return entries;
}

const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[e.toLowerCase()]) return named[e.toLowerCase()];
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');

/** First worksheet of an .xlsx workbook as rows of cell text. */
export function readXlsx(data: Buffer): string[][] {
  const files = unzip(data);
  const read = (name: string) => files.get(name)?.().toString('utf8');
  const shared = [...(read('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const firstSheet = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(read('xl/workbook.xml') ?? '')?.[1];
  const target = firstSheet && new RegExp(`<Relationship\\b[^>]*Id="${firstSheet}"[^>]*Target="([^"]+)"`).exec(read('xl/_rels/workbook.xml.rels') ?? '')?.[1];
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheet = read(sheetPath);
  if (!sheet) throw new BadRequestException('The .xlsx workbook has no worksheet');
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let next = 0;
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1];
      const col = ref ? [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1 : next;
      const type = /\bt="([^"]+)"/.exec(c[1])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
      row[col] = type === 's' ? (shared[Number(v)] ?? '') : type === 'inlineStr' ? texts(c[2] ?? '') : decode(v ?? '');
      next = col + 1;
    }
    rows.push(Array.from(row, (x) => x ?? ''));
  }
  return rows;
}
