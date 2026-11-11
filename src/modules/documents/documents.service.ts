import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { StorageService } from '../core/storage/storage.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { assertStatusWritable, assertWritable } from '../core/idms/idms.js';
import { UserService } from '../user/user.service.js';

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Office documents, PDF, images and plain text; matched on extension, the browser-supplied type is not trusted. */
export const DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  txt: 'text/plain',
  html: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const PERSON = (a: string) => `COALESCE(NULLIF(btrim(concat_ws(' ', ${a}.first_name, ${a}.last_name)), ''), ${a}.email)`;

export interface DocumentView {
  id: string;
  clientRoomId: string;
  title: string;
  currentVersion: number;
  idmsStatus: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  downloads: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentVersionView {
  id: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadedByName: string | null;
  createdAt: Date;
}

export interface SignatureView {
  id: string;
  agreementId: string;
  clientRoomId: string | null;
  signerName: string;
  signerEmail: string;
  contentSha256: string;
  signedAt: Date;
}

export interface UploadedDocument {
  originalName: string;
  data: Buffer;
}

export function documentType(fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return DOCUMENT_TYPES[ext] ?? null;
}

export function safeName(fileName: string): string {
  return fileName.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-200) || 'document';
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly storage: StorageService,
    private readonly userService: UserService,
    private readonly audit: AuditService,
  ) {}

  private get external(): boolean {
    return this.context.tenant.access.scope === 'external';
  }

  list(roomId: string): Promise<DocumentView[]> {
    return this.tx.run(async (manager) => {
      await this.assertRoom(manager, roomId);
      return this.query(manager, roomId);
    });
  }

  versions(roomId: string, documentId: string): Promise<DocumentVersionView[]> {
    return this.tx.run(async (manager) => {
      await this.assertDocument(manager, roomId, documentId);
      return manager.query(
        `SELECT v.id, v.version, v.file_name AS "fileName", v.mime_type AS "mimeType", v.size_bytes AS "sizeBytes", v.sha256,
                ${PERSON('u')} AS "uploadedByName", v.created_at AS "createdAt"
           FROM room_document_versions v LEFT JOIN users u ON u.id = v.uploaded_by
          WHERE v.tenant_id = $1 AND v.document_id = $2 ORDER BY v.version DESC`,
        [this.context.tenantId, documentId],
      );
    });
  }

  /** New document (version 1), or a new version of `documentId`. */
  async upload(roomId: string, file: UploadedDocument, title: string | null, documentId: string | null, identity: AuthenticatedUser): Promise<DocumentView> {
    const mimeType = documentType(file.originalName);
    if (!mimeType) throw new BadRequestException(`file type not allowed; use ${Object.keys(DOCUMENT_TYPES).join(', ')}`);
    const actor = await this.userService.resolveActor(identity);
    const versionId = randomUUID();
    const fileName = safeName(file.originalName);
    const key = `${this.context.tenantId}/rooms/${roomId}/${versionId}-${fileName}`;
    const sha256 = createHash('sha256').update(file.data).digest('hex');
    let written = false;
    try {
      const view = await this.tx.run(async (manager) => {
        await this.assertRoom(manager, roomId);
        let docId = documentId;
        let version = 1;
        if (docId) {
          const [doc] = await manager.query(
            'SELECT current_version, idms_status FROM room_documents WHERE tenant_id = $1 AND client_room_id = $2 AND id = $3 FOR UPDATE',
            [this.context.tenantId, roomId, docId],
          );
          if (!doc) throw new NotFoundException('Document not found');
          assertStatusWritable(doc.idms_status);
          version = doc.current_version + 1;
          await manager.query('UPDATE room_documents SET current_version = $2, last_modified_by = $3, file_format = $4 WHERE id = $1', [docId, version, actor.id, fileName.toLowerCase().split('.').pop()]);
        } else {
          const [doc] = await manager.query(
            `INSERT INTO room_documents (tenant_id, client_room_id, client_id, title, file_format, created_by, last_modified_by)
             SELECT $1, r.id, r.client_id, $3, $5, $4, $4 FROM digital_sales_rooms r WHERE r.tenant_id = $1 AND r.id = $2 RETURNING id`,
            [this.context.tenantId, roomId, title ?? fileName.replace(/\.[^.]+$/, ''), actor.id, fileName.toLowerCase().split('.').pop()],
          );
          docId = doc.id as string;
        }
        await this.storage.put(key, file.data);
        written = true;
        await manager.query(
          `INSERT INTO room_document_versions (id, tenant_id, document_id, version, file_name, mime_type, size_bytes, sha256, storage_key, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [versionId, this.context.tenantId, docId, version, fileName, mimeType, file.data.length, sha256, key, actor.id],
        );
        return (await this.query(manager, roomId, docId))[0];
      });
      this.audit.logAction(this.context.tenantId, actor.id, documentId ? 'document.version_uploaded' : 'document.uploaded', {
        roomId,
        documentId: view.id,
        version: view.currentVersion,
      });
      return view;
    } catch (error) {
      if (written) await this.storage.delete(key);
      throw error;
    }
  }

  async rename(roomId: string, documentId: string, title: string, identity: AuthenticatedUser): Promise<DocumentView> {
    const actor = await this.userService.resolveActor(identity);
    const view = await this.tx.run(async (manager) => {
      await this.assertDocument(manager, roomId, documentId);
      await assertWritable(manager, 'room_documents', this.context.tenantId, documentId);
      await manager.query('UPDATE room_documents SET title = $2 WHERE id = $1', [documentId, title]);
      return (await this.query(manager, roomId, documentId))[0];
    });
    this.audit.logAction(this.context.tenantId, actor.id, 'document.renamed', { roomId, documentId });
    return view;
  }

  async remove(roomId: string, documentId: string, identity: AuthenticatedUser): Promise<void> {
    const actor = await this.userService.resolveActor(identity);
    const keys = await this.tx.run(async (manager) => {
      await this.assertDocument(manager, roomId, documentId);
      await assertWritable(manager, 'room_documents', this.context.tenantId, documentId);
      const rows: { storage_key: string }[] = await manager.query('SELECT storage_key FROM room_document_versions WHERE document_id = $1', [documentId]);
      await manager.query('DELETE FROM room_documents WHERE id = $1', [documentId]);
      return rows.map((r) => r.storage_key);
    });
    await Promise.all(keys.map((k) => this.storage.delete(k)));
    this.audit.logAction(this.context.tenantId, actor.id, 'document.deleted', { roomId, documentId });
  }

  /** Streams a version (latest by default). Client downloads are recorded as `download` engagement in the room. */
  async open(roomId: string, documentId: string, version: number | null, identity: AuthenticatedUser): Promise<{ fileName: string; mimeType: string; sizeBytes: number; stream: Readable }> {
    const row = await this.tx.run(async (manager) => {
      await this.assertDocument(manager, roomId, documentId);
      const [v] = await manager.query(
        `SELECT v.version, v.file_name, v.mime_type, v.size_bytes, v.storage_key, d.title
           FROM room_document_versions v JOIN room_documents d ON d.id = v.document_id
          WHERE v.document_id = $1 AND v.version = COALESCE($2::int, d.current_version)`,
        [documentId, version],
      );
      if (!v) throw new NotFoundException('Document version not found');
      if (this.external) {
        await manager.query(
          `INSERT INTO dsr_activities (tenant_id, dsr_id, stakeholder_email, activity_type, details) VALUES ($1, $2, $3, 'download', $4)`,
          [this.context.tenantId, roomId, identity.email, JSON.stringify({ documentId, version: v.version, title: v.title })],
        );
      }
      return v as { version: number; file_name: string; mime_type: string; size_bytes: number; storage_key: string };
    });
    const stream = await this.storage.get(row.storage_key);
    if (!stream) throw new NotFoundException('Document file not found');
    return { fileName: row.file_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, stream };
  }

  // Signatures ------------------------------------------------------------------------------------------------

  signatures(agreementId: string): Promise<SignatureView[]> {
    return this.tx.run(async (manager) => {
      await this.assertAgreement(manager, agreementId);
      return manager.query(`${SIGNATURE_SQL} WHERE s.tenant_id = $1 AND s.agreement_id = $2 ORDER BY s.signed_at`, [this.context.tenantId, agreementId]);
    });
  }

  /**
   * Simple electronic signature (eIDAS art. 3(10)): the drawn signature image, the signer's verified login e-mail,
   * a timestamp and a SHA-256 over the signed agreement content. Signing also records `terms_accepted` in the room.
   */
  async sign(agreementId: string, signerName: string, png: Buffer, identity: AuthenticatedUser): Promise<SignatureView> {
    if (!this.external) throw new ForbiddenException('Agreements are signed by the client contact in the client portal');
    if (png.length < 100 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new BadRequestException('signature must be a PNG image');
    if (png.length > 1024 * 1024) throw new BadRequestException('signature image must be at most 1 MB');
    const actor = await this.userService.resolveActor(identity);
    const id = randomUUID();
    const key = `${this.context.tenantId}/signatures/${agreementId}/${id}.png`;
    let written = false;
    try {
      const view = await this.tx.run(async (manager) => {
        const agreement = await this.assertAgreement(manager, agreementId);
        if (agreement.status !== 'pending_approval') throw new ConflictException('Only agreements awaiting approval can be signed');
        const [room] = await manager.query(
          `SELECT id FROM digital_sales_rooms WHERE tenant_id = $1 AND agreement_id = $2 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
          [this.context.tenantId, agreementId],
        );
        const signedAt = new Date();
        const contentSha256 = createHash('sha256')
          .update(JSON.stringify({ agreementId, title: agreement.title, documentUrl: agreement.document_url, signerName, signerEmail: identity.email, signedAt: signedAt.toISOString() }))
          .update(png)
          .digest('hex');
        await this.storage.put(key, png);
        written = true;
        await manager.query(
          `INSERT INTO agreement_signatures (id, tenant_id, agreement_id, client_room_id, signer_name, signer_email, image_key, content_sha256, signed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [id, this.context.tenantId, agreementId, room?.id ?? null, signerName, identity.email, key, contentSha256, signedAt],
        );
        if (room) {
          await manager.query(
            `INSERT INTO dsr_activities (tenant_id, dsr_id, stakeholder_email, activity_type, details) VALUES ($1, $2, $3, 'terms_accepted', $4)`,
            [this.context.tenantId, room.id, identity.email, JSON.stringify({ agreementId, signatureId: id, reason: 'Signed electronically' })],
          );
        }
        const [view] = await manager.query(`${SIGNATURE_SQL} WHERE s.id = $1`, [id]);
        return view as SignatureView;
      });
      this.audit.logAction(this.context.tenantId, actor.id, 'agreement.signed', { agreementId, signatureId: id });
      return view;
    } catch (error) {
      if (written) await this.storage.delete(key);
      throw error;
    }
  }

  async signatureImage(agreementId: string, signatureId: string): Promise<Readable> {
    const key = await this.tx.run(async (manager) => {
      const [row] = await manager.query('SELECT image_key FROM agreement_signatures WHERE tenant_id = $1 AND agreement_id = $2 AND id = $3', [
        this.context.tenantId,
        agreementId,
        signatureId,
      ]);
      if (!row) throw new NotFoundException('Signature not found');
      return row.image_key as string;
    });
    const stream = await this.storage.get(key);
    if (!stream) throw new NotFoundException('Signature image not found');
    return stream;
  }

  private async assertRoom(manager: EntityManager, roomId: string): Promise<void> {
    const [room] = await manager.query('SELECT id FROM digital_sales_rooms WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, roomId]);
    if (!room) throw new NotFoundException('Client room not found');
  }

  private async assertDocument(manager: EntityManager, roomId: string, documentId: string): Promise<void> {
    const [doc] = await manager.query('SELECT id FROM room_documents WHERE tenant_id = $1 AND client_room_id = $2 AND id = $3', [
      this.context.tenantId,
      roomId,
      documentId,
    ]);
    if (!doc) throw new NotFoundException('Document not found');
  }

  private async assertAgreement(manager: EntityManager, agreementId: string): Promise<{ title: string; status: string; document_url: string }> {
    const [a] = await manager.query('SELECT title, status, document_url FROM agreements WHERE tenant_id = $1 AND id = $2', [this.context.tenantId, agreementId]);
    if (!a) throw new NotFoundException('Agreement not found');
    return a;
  }

  private query(manager: EntityManager, roomId: string, id?: string): Promise<DocumentView[]> {
    const params: unknown[] = [this.context.tenantId, roomId];
    return manager.query(
      `SELECT d.id, d.client_room_id AS "clientRoomId", d.title, d.current_version AS "currentVersion", d.idms_status AS "idmsStatus",
              v.file_name AS "fileName", v.mime_type AS "mimeType", v.size_bytes AS "sizeBytes", ${PERSON('u')} AS "uploadedByName",
              (SELECT count(*)::int FROM dsr_activities a
                WHERE a.tenant_id = d.tenant_id AND a.dsr_id = d.client_room_id AND a.activity_type = 'download' AND a.details->>'documentId' = d.id::text) AS downloads,
              d.created_at AS "createdAt", d.updated_at AS "updatedAt"
         FROM room_documents d
         JOIN room_document_versions v ON v.document_id = d.id AND v.version = d.current_version
         LEFT JOIN users u ON u.id = v.uploaded_by
        WHERE d.tenant_id = $1 AND d.client_room_id = $2${id ? ` AND d.id = $${params.push(id)}` : ''}
        ORDER BY d.updated_at DESC`,
      params,
    );
  }
}

const SIGNATURE_SQL = `
  SELECT s.id, s.agreement_id AS "agreementId", s.client_room_id AS "clientRoomId", s.signer_name AS "signerName",
         s.signer_email AS "signerEmail", s.content_sha256 AS "contentSha256", s.signed_at AS "signedAt"
    FROM agreement_signatures s`;
