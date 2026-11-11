import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, SignJWT } from 'jose';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import type { OfficeConfig } from '../../config/configuration.js';
import { CommercialService } from '../commercial/commercial.service.js';
import { AuditService } from '../core/audit/audit.service.js';
import { LOCKED_STATUSES } from '../core/idms/idms.js';
import { StorageService } from '../core/storage/storage.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, safeName } from '../documents/documents.service.js';
import { UserService } from '../user/user.service.js';

export const NEW_FORMATS = ['docx', 'xlsx', 'pptx'] as const;
export type NewFormat = (typeof NEW_FORMATS)[number];
/** Formats Collabora opens for editing. */
export const EDITABLE_FORMATS = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'doc', 'xls', 'csv']);

const TOKEN_TTL_SECONDS = 60 * 60;
const LOCK_TTL_MS = 30 * 60 * 1000;
const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;

export interface OfficeDocumentView {
  id: string;
  title: string;
  clientId: string;
  clientName: string | null;
  clientRoomId: string | null;
  roomName: string | null;
  contactId: string | null;
  contactName: string | null;
  dealId: string | null;
  dealName: string | null;
  fileFormat: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  currentVersion: number;
  idmsStatus: string;
  editable: boolean;
  lastModifiedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OfficeVersionView {
  id: string;
  version: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  uploadedByName: string | null;
  createdAt: Date;
}

export interface EditorSession {
  documentId: string;
  editorUrl: string;
  accessToken: string;
  accessTokenTtl: number;
  documentTitle: string;
  clientName: string | null;
  contactName: string | null;
  fileFormat: string;
}

export interface CreateOfficeDocument {
  clientId: string;
  contactId: string | null;
  dealId: string | null;
  clientRoomId: string | null;
  title: string;
  format: NewFormat;
  templateId: string | null;
  starterCsv: string | null;
}

interface WopiClaims {
  sub: string;
  tid: string;
  doc: string;
  name: string;
  write: boolean;
}

interface Discovery {
  at: number;
  urls: Map<string, string>;
}

const VIEW_SQL = `
  SELECT d.id, d.title, d.client_id AS "clientId", c.name AS "clientName", d.client_room_id AS "clientRoomId", r.room_name AS "roomName",
         d.contact_id AS "contactId", NULLIF(btrim(concat_ws(' ', ct.first_name, ct.last_name)), '') AS "contactName",
         d.deal_id AS "dealId", dl.title AS "dealName", d.file_format AS "fileFormat", d.idms_status AS "idmsStatus",
         v.file_name AS "fileName", v.mime_type AS "mimeType", v.size_bytes AS "sizeBytes", v.sha256, d.current_version AS "currentVersion",
         ${PERSON('u')} AS "lastModifiedByName", d.created_at AS "createdAt", d.updated_at AS "updatedAt"
    FROM room_documents d
    JOIN room_document_versions v ON v.document_id = d.id AND v.version = d.current_version
    LEFT JOIN clients c ON c.tenant_id = d.tenant_id AND c.id = d.client_id
    LEFT JOIN digital_sales_rooms r ON r.tenant_id = d.tenant_id AND r.id = d.client_room_id
    LEFT JOIN contacts ct ON ct.id = d.contact_id
    LEFT JOIN deals dl ON dl.tenant_id = d.tenant_id AND dl.id = d.deal_id
    LEFT JOIN users u ON u.id = COALESCE(d.last_modified_by, v.uploaded_by)`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string);
}

/**
 * Client-bound office documents (.docx/.xlsx/.pptx) edited in Collabora Online. Files and versions live in
 * room_documents / room_document_versions; Collabora reads and saves them through the WOPI endpoints, which
 * authenticate with a short-lived signed token instead of a Keycloak session.
 */
/** WOPI POST operations that would change the file or its lock; refused (403) on read-only and locked documents. */
const CHANGING_OPS = new Set(['LOCK', 'REFRESH_LOCK', 'RENAME_FILE', 'DELETE', 'PUT_RELATIVE']);

@Injectable()
export class OfficeService {
  private readonly office: OfficeConfig;
  private readonly secret: Uint8Array;
  private discovery: Discovery | null = null;

  constructor(
    config: ConfigService,
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly storage: StorageService,
    private readonly userService: UserService,
    private readonly commercial: CommercialService,
    private readonly audit: AuditService,
  ) {
    this.office = config.getOrThrow<OfficeConfig>('office');
    const seed = process.env.WOPI_TOKEN_SECRET || `${process.env.DB_PASSWORD ?? ''}:${process.env.KEYCLOAK_CLIENT_SECRET ?? ''}`;
    this.secret = createHmac('sha256', 'agera-wopi-token').update(seed).digest();
  }

  // Editor availability ---------------------------------------------------------------------------------------

  async status(): Promise<{ connected: boolean; editor: string }> {
    return { connected: (await this.editorUrls()) !== null, editor: 'Collabora Online' };
  }

  /** ext -> editor path from Collabora's discovery document (cached 5 minutes). */
  private async editorUrls(): Promise<Map<string, string> | null> {
    if (!this.office.collaboraUrl) return null;
    if (this.discovery && Date.now() - this.discovery.at < 5 * 60 * 1000) return this.discovery.urls;
    try {
      const res = await fetch(`${this.office.collaboraUrl}/hosting/discovery`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const xml = await res.text();
      const urls = new Map<string, string>();
      for (const m of xml.matchAll(/<action\b([^>]*)\/?>/g)) {
        const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(m[1])?.[1];
        const ext = attr('ext');
        const name = attr('name');
        const src = attr('urlsrc');
        if (!ext || !src || (name !== 'edit' && name !== 'view')) continue;
        if (name === 'view' && urls.has(ext)) continue;
        const url = new URL(src);
        urls.set(ext, url.pathname);
      }
      this.discovery = { at: Date.now(), urls };
      return urls;
    } catch {
      return null;
    }
  }

  // Documents -------------------------------------------------------------------------------------------------

  list(clientId: string): Promise<OfficeDocumentView[]> {
    return this.tx.run(async (manager) => {
      const rows: OfficeDocumentView[] = await manager.query(`${VIEW_SQL} WHERE d.tenant_id = $1 AND d.client_id = $2 ORDER BY d.updated_at DESC`, [
        this.context.tenantId,
        clientId,
      ]);
      return rows.map((r) => ({ ...r, editable: EDITABLE_FORMATS.has(r.fileFormat ?? '') && !LOCKED_STATUSES.has(r.idmsStatus) }));
    });
  }

  /** Documents in IDMS status DRAFT, newest first. */
  drafts(): Promise<OfficeDocumentView[]> {
    return this.tx.run(async (manager) => {
      const rows: OfficeDocumentView[] = await manager.query(`${VIEW_SQL} WHERE d.tenant_id = $1 AND d.idms_status = 'DRAFT' ORDER BY d.updated_at DESC LIMIT 100`, [this.context.tenantId]);
      return rows.map((r) => ({ ...r, editable: EDITABLE_FORMATS.has(r.fileFormat ?? '') && !LOCKED_STATUSES.has(r.idmsStatus) }));
    });
  }

  get(id: string): Promise<OfficeDocumentView> {
    return this.tx.run((manager) => this.view(manager, id));
  }

  versions(id: string): Promise<OfficeVersionView[]> {
    return this.tx.run(async (manager) => {
      await this.view(manager, id);
      return manager.query(
        `SELECT v.id, v.version, v.file_name AS "fileName", v.size_bytes AS "sizeBytes", v.sha256, ${PERSON('u')} AS "uploadedByName", v.created_at AS "createdAt"
           FROM room_document_versions v LEFT JOIN users u ON u.id = v.uploaded_by
          WHERE v.tenant_id = $1 AND v.document_id = $2 ORDER BY v.version DESC`,
        [this.context.tenantId, id],
      );
    });
  }

  async download(id: string, version: number | null): Promise<{ fileName: string; mimeType: string; sizeBytes: number; stream: Readable }> {
    const v = await this.tx.run(async (manager) => {
      const [row] = await manager.query(
        `SELECT v.file_name, v.mime_type, v.size_bytes, v.storage_key FROM room_document_versions v JOIN room_documents d ON d.id = v.document_id
          WHERE d.tenant_id = $1 AND d.id = $2 AND v.version = COALESCE($3::int, d.current_version)`,
        [this.context.tenantId, id, version],
      );
      if (!row) throw new NotFoundException('Document not found');
      return row as { file_name: string; mime_type: string; size_bytes: number; storage_key: string };
    });
    const stream = await this.storage.get(v.storage_key);
    if (!stream) throw new NotFoundException('Document file not found');
    return { fileName: v.file_name, mimeType: v.mime_type, sizeBytes: v.size_bytes, stream };
  }

  async create(input: CreateOfficeDocument, identity: AuthenticatedUser): Promise<OfficeDocumentView> {
    const actor = await this.userService.resolveActor(identity);
    await this.tx.run((manager) => this.assertLinks(manager, input));
    const data = await this.initialContent(input, identity);
    const fileName = `${safeName(input.title).replace(/\.(docx|xlsx|pptx)$/i, '')}.${input.format}`;
    const versionId = randomUUID();
    const key = `${this.context.tenantId}/clients/${input.clientId}/${versionId}-${fileName}`;
    let written = false;
    try {
      const view = await this.tx.run(async (manager) => {
        const [doc] = await manager.query(
          `INSERT INTO room_documents (tenant_id, client_room_id, client_id, contact_id, deal_id, title, file_format, created_by, last_modified_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
          [this.context.tenantId, input.clientRoomId, input.clientId, input.contactId, input.dealId, input.title, input.format, actor.id],
        );
        await this.storage.put(key, data);
        written = true;
        await manager.query(
          `INSERT INTO room_document_versions (id, tenant_id, document_id, version, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by)
           VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9)`,
          [versionId, this.context.tenantId, doc.id, fileName, DOCUMENT_TYPES[input.format], data.length, createHash('sha256').update(data).digest('hex'), key, actor.id],
        );
        return this.view(manager, doc.id as string);
      });
      this.audit.logAction(this.context.tenantId, actor.id, 'document.created', { documentId: view.id, clientId: input.clientId, format: input.format });
      return view;
    } catch (error) {
      if (written) await this.storage.delete(key);
      throw error;
    }
  }

  /** Blank file, a document template filled with the client's data, or a spreadsheet starter (CSV). */
  private async initialContent(input: CreateOfficeDocument, identity: AuthenticatedUser): Promise<Buffer> {
    if (input.templateId && input.format === 'docx') {
      const rendered = await this.commercial.render(input.templateId, { clientId: input.clientId, roomId: input.clientRoomId }, identity);
      const body = rendered.text.split(/\r?\n/).map((line) => `<p>${escapeHtml(line) || '&nbsp;'}</p>`).join('\n');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title></head><body>${body}</body></html>`;
      return this.convert(Buffer.from(html, 'utf8'), 'document.html', 'docx');
    }
    if (input.starterCsv && input.format === 'xlsx') {
      return this.convert(Buffer.from(input.starterCsv, 'utf8'), 'sheet.csv', 'xlsx');
    }
    return readFile(join(process.cwd(), 'assets', 'office', `blank.${input.format}`));
  }

  private async convert(data: Buffer, name: string, to: string): Promise<Buffer> {
    if (!this.office.collaboraUrl) throw new ServiceUnavailableException('Agera Office is not connected');
    const form = new FormData();
    form.append('data', new Blob([new Uint8Array(data)]), name);
    let res: Response;
    try {
      res = await fetch(`${this.office.collaboraUrl}/cool/convert-to/${to}`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    } catch {
      throw new ServiceUnavailableException('Agera Office is not reachable');
    }
    if (!res.ok) throw new ServiceUnavailableException(`Document conversion failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async assertLinks(manager: EntityManager, input: CreateOfficeDocument): Promise<void> {
    const t = this.context.tenantId;
    const [client] = await manager.query('SELECT id FROM clients WHERE tenant_id = $1 AND id = $2', [t, input.clientId]);
    if (!client) throw new NotFoundException('Client not found');
    if (input.contactId) {
      const [c] = await manager.query('SELECT id FROM contacts WHERE tenant_id = $1 AND client_id = $2 AND id = $3', [t, input.clientId, input.contactId]);
      if (!c) throw new BadRequestException('contactId does not belong to this client');
    }
    if (input.dealId) {
      const [d] = await manager.query('SELECT id FROM deals WHERE tenant_id = $1 AND client_id = $2 AND id = $3', [t, input.clientId, input.dealId]);
      if (!d) throw new BadRequestException('dealId does not belong to this client');
    }
    if (input.clientRoomId) {
      const [r] = await manager.query('SELECT id FROM digital_sales_rooms WHERE tenant_id = $1 AND client_id = $2 AND id = $3', [t, input.clientId, input.clientRoomId]);
      if (!r) throw new BadRequestException('clientRoomId does not belong to this client');
    }
  }

  private async view(manager: EntityManager, id: string): Promise<OfficeDocumentView> {
    const [row] = await manager.query(`${VIEW_SQL} WHERE d.tenant_id = $1 AND d.id = $2`, [this.context.tenantId, id]);
    if (!row) throw new NotFoundException('Document not found');
    return { ...row, editable: EDITABLE_FORMATS.has(row.fileFormat ?? '') && !LOCKED_STATUSES.has(row.idmsStatus) };
  }

  // Editor session ----------------------------------------------------------------------------------------------

  async session(id: string, identity: AuthenticatedUser): Promise<EditorSession> {
    const urls = await this.editorUrls();
    if (!urls) throw new ServiceUnavailableException('Agera Office is not connected');
    const actor = await this.userService.resolveActor(identity);
    const { doc, name } = await this.tx.run(async (manager) => {
      const doc = await this.view(manager, id);
      const [u] = await manager.query(`SELECT ${PERSON('u')} AS name FROM users u WHERE u.id = $1`, [actor.id]);
      return { doc, name: (u?.name as string) ?? identity.email };
    });
    const format = doc.fileFormat ?? '';
    const path = urls.get(format);
    if (!path || !EDITABLE_FORMATS.has(format)) throw new BadRequestException(`.${format || '?'} files cannot be opened in the editor`);
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const accessToken = await new SignJWT({ tid: this.context.tenantId, doc: id, name, write: !LOCKED_STATUSES.has(doc.idmsStatus) })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(actor.id)
      .setAudience('agera-wopi')
      .setExpirationTime(exp)
      .sign(this.secret);
    const wopiSrc = `${this.office.wopiHostUrl}/v1/wopi/files/${id}`;
    return {
      documentId: id,
      editorUrl: `${path}?WOPISrc=${encodeURIComponent(wopiSrc)}`,
      accessToken,
      accessTokenTtl: exp * 1000,
      documentTitle: doc.title,
      clientName: doc.clientName,
      contactName: doc.contactName,
      fileFormat: format,
    };
  }

  // WOPI host ---------------------------------------------------------------------------------------------------

  private async claims(token: string | undefined, fileId: string): Promise<WopiClaims> {
    if (!token) throw new UnauthorizedException('Missing access token');
    try {
      const { payload } = await jwtVerify(token, this.secret, { audience: 'agera-wopi', algorithms: ['HS256'] });
      if (payload.doc !== fileId || typeof payload.sub !== 'string' || typeof payload.tid !== 'string') throw new Error('wrong document');
      return { sub: payload.sub, tid: payload.tid, doc: payload.doc, name: String(payload.name ?? ''), write: payload.write === true };
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private as<T>(c: WopiClaims, work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.context.run({ id: c.tid, name: '', domain: '', source: 'claim', access: { scope: 'internal' } }, () => this.tx.run(work));
  }

  async checkFileInfo(fileId: string, token: string | undefined): Promise<Record<string, unknown>> {
    const c = await this.claims(token, fileId);
    const doc = await this.as(c, (m) => this.view(m, fileId));
    return {
      BaseFileName: doc.fileName,
      OwnerId: doc.clientId,
      Size: doc.sizeBytes,
      UserId: c.sub,
      UserFriendlyName: c.name,
      Version: String(doc.currentVersion),
      LastModifiedTime: new Date(doc.updatedAt).toISOString(),
      UserCanWrite: c.write && !LOCKED_STATUSES.has(doc.idmsStatus),
      ReadOnly: !c.write || LOCKED_STATUSES.has(doc.idmsStatus),
      UserCanNotWriteRelative: true,
      UserCanRename: false,
      SupportsUpdate: true,
      SupportsLocks: true,
      SupportsGetLock: true,
      SupportsRename: false,
      PostMessageOrigin: this.office.publicOrigin,
    };
  }

  async getFile(fileId: string, token: string | undefined): Promise<{ stream: Readable; version: number }> {
    const c = await this.claims(token, fileId);
    const row = await this.as(c, async (m) => {
      const [r] = await m.query(
        `SELECT v.storage_key, d.current_version FROM room_documents d JOIN room_document_versions v ON v.document_id = d.id AND v.version = d.current_version
          WHERE d.tenant_id = $1 AND d.id = $2`,
        [c.tid, fileId],
      );
      if (!r) throw new NotFoundException('Document not found');
      return r as { storage_key: string; current_version: number };
    });
    const stream = await this.storage.get(row.storage_key);
    if (!stream) throw new NotFoundException('Document file not found');
    return { stream, version: row.current_version };
  }

  /** Saves the editor's file as a new version. Returns `conflict` with the current lock when another editor holds it. */
  async putFile(fileId: string, token: string | undefined, data: Buffer, lock: string | undefined): Promise<{ conflict: string } | { version: number; lastModified: string }> {
    const c = await this.claims(token, fileId);
    const [state] = await this.as(c, (m) => m.query('SELECT idms_status FROM room_documents WHERE tenant_id = $1 AND id = $2', [c.tid, fileId]));
    if (!state) throw new NotFoundException('Document not found');
    if (!c.write || LOCKED_STATUSES.has(state.idms_status)) {
      // The WOPI routes are public (token-authenticated), so the 403 audit filter cannot see the organisation: log here.
      const reason = c.write ? `Document is ${state.idms_status} and opens read-only` : 'Read-only access';
      this.audit.logAction(c.tid, c.sub, 'access.denied', { method: 'POST', path: `/v1/wopi/files/${fileId}/contents`, reason, documentId: fileId });
      throw new ForbiddenException(reason);
    }
    if (data.length > MAX_DOCUMENT_BYTES) throw new BadRequestException('File too large');
    const versionId = randomUUID();
    let key = '';
    let written = false;
    try {
      const result = await this.as(c, async (m) => {
        const [doc] = await m.query(
          `SELECT d.current_version, d.client_id, d.title, d.lock_token, d.lock_expires_at > NOW() AS locked, v.file_name, v.mime_type
             FROM room_documents d JOIN room_document_versions v ON v.document_id = d.id AND v.version = d.current_version
            WHERE d.tenant_id = $1 AND d.id = $2 FOR UPDATE OF d`,
          [c.tid, fileId],
        );
        if (!doc) throw new NotFoundException('Document not found');
        if (doc.locked && doc.lock_token !== (lock ?? '')) return { conflict: doc.lock_token as string };
        const version = (doc.current_version as number) + 1;
        key = `${c.tid}/clients/${doc.client_id}/${versionId}-${doc.file_name}`;
        await this.storage.put(key, data);
        written = true;
        await m.query(
          `INSERT INTO room_document_versions (id, tenant_id, document_id, version, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [versionId, c.tid, fileId, version, doc.file_name, doc.mime_type, data.length, createHash('sha256').update(data).digest('hex'), key, c.sub],
        );
        await m.query('UPDATE room_documents SET current_version = $2, last_modified_by = $3 WHERE id = $1', [fileId, version, c.sub]);
        const [u] = await m.query('SELECT updated_at FROM room_documents WHERE id = $1', [fileId]);
        return { version, lastModified: new Date(u.updated_at).toISOString() };
      });
      if ('version' in result) this.audit.logAction(c.tid, c.sub, 'document.edited', { documentId: fileId, version: result.version });
      return result;
    } catch (error) {
      if (written) await this.storage.delete(key);
      throw error;
    }
  }

  /** WOPI lock operations (X-WOPI-Override). Returns the HTTP status and the X-WOPI-Lock header to send. */
  async lock(fileId: string, token: string | undefined, op: string, lock: string, oldLock: string | undefined): Promise<{ status: number; lock?: string }> {
    const c = await this.claims(token, fileId);
    return this.as(c, async (m) => {
      const [doc] = await m.query(
        `SELECT lock_token, lock_expires_at > NOW() AS locked, idms_status FROM room_documents WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [c.tid, fileId],
      );
      if (!doc) throw new NotFoundException('Document not found');
      if (CHANGING_OPS.has(op) && (!c.write || LOCKED_STATUSES.has(doc.idms_status))) {
        const reason = c.write ? `Document is ${doc.idms_status} and opens read-only` : 'Read-only access';
        this.audit.logAction(c.tid, c.sub, 'access.denied', { method: 'POST', path: `/v1/wopi/files/${fileId}`, op, reason, documentId: fileId });
        throw new ForbiddenException(reason);
      }
      const current: string = doc.locked ? doc.lock_token : '';
      const set = (value: string | null) =>
        m.query('UPDATE room_documents SET lock_token = $2, lock_expires_at = $3 WHERE id = $1', [fileId, value, value ? new Date(Date.now() + LOCK_TTL_MS) : null]);
      switch (op) {
        case 'GET_LOCK':
          return { status: 200, lock: current };
        case 'LOCK':
          if (oldLock !== undefined) {
            if (current !== oldLock) return { status: 409, lock: current };
          } else if (current && current !== lock) {
            return { status: 409, lock: current };
          }
          if (!lock) throw new BadRequestException('X-WOPI-Lock is required');
          await set(lock);
          return { status: 200 };
        case 'REFRESH_LOCK':
          if (current !== lock) return { status: 409, lock: current };
          await set(lock);
          return { status: 200 };
        case 'UNLOCK':
          if (current !== lock) return { status: 409, lock: current };
          await set(null);
          return { status: 200 };
        default:
          return { status: 501 };
      }
    });
  }
}

export function isNewFormat(value: string): value is NewFormat {
  return (NEW_FORMATS as readonly string[]).includes(value);
}
