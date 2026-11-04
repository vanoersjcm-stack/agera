import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AllowExternal } from '../auth/allow-external.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { DOCUMENT_TYPES, DocumentsService, type DocumentVersionView, type DocumentView, MAX_DOCUMENT_BYTES, type SignatureView } from './documents.service.js';
import { DocumentUploadExceptionFilter } from './upload-exception.filter.js';

class DocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) clientRoomId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() currentVersion!: number;
  @ApiProperty() fileName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ type: String, nullable: true }) uploadedByName!: string | null;
  @ApiProperty({ description: 'Downloads by client contacts' }) downloads!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

class DocumentVersionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() version!: number;
  @ApiProperty() fileName!: string;
  @ApiProperty() mimeType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty({ type: String, nullable: true }) uploadedByName!: string | null;
  @ApiProperty() createdAt!: Date;
}

class UploadDocumentDto {
  @ApiProperty({ type: 'string', format: 'binary' }) file!: unknown;
  @ApiProperty({ required: false, description: 'Title (defaults to the file name)' }) title?: string;
  @ApiProperty({ required: false, format: 'uuid', description: 'Upload as a new version of this document' }) documentId?: string;
}

class RenameDocumentDto {
  @ApiProperty() title!: string;
}

class SignatureDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) agreementId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) clientRoomId!: string | null;
  @ApiProperty() signerName!: string;
  @ApiProperty() signerEmail!: string;
  @ApiProperty({ description: 'SHA-256 over the agreement content, signer, timestamp and signature image' }) contentSha256!: string;
  @ApiProperty() signedAt!: Date;
}

class SignDto {
  @ApiProperty() signerName!: string;
  @ApiProperty({ description: 'data:image/png;base64,… of the drawn signature' }) signatureImage!: string;
}

interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@ApiTags('Documents')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('v1/nexus/client-rooms/:roomId/documents')
export class RoomDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @AllowExternal()
  @ApiOperation({ summary: 'Documents shared in a client room (client contacts: own active rooms)' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiOkResponse({ type: [DocumentDto] })
  @ApiErrors(404)
  list(@Param('roomId', ParseUUIDPipe) roomId: string): Promise<DocumentView[]> {
    return this.documents.list(roomId);
  }

  @Post()
  @UseFilters(DocumentUploadExceptionFilter)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 5 } }))
  @ApiOperation({
    summary: 'Upload a document or a new version (audit: document.uploaded / document.version_uploaded)',
    description: `multipart/form-data; allowed: ${Object.keys(DOCUMENT_TYPES).join(', ')}; at most ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`,
  })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDocumentDto })
  @ApiCreatedResponse({ type: DocumentDto })
  @ApiErrors(400, 404)
  upload(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<DocumentView> {
    if (!file || file.size === 0) throw new BadRequestException('file is required');
    const raw = asObject(body ?? {});
    return this.documents.upload(
      roomId,
      { originalName: file.originalname, data: file.buffer },
      optionalString('title', raw.title, 200),
      optionalUuid('documentId', raw.documentId),
      identity,
    );
  }

  @Get(':id/versions')
  @AllowExternal()
  @ApiOperation({ summary: 'Version history of a document' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [DocumentVersionDto] })
  @ApiErrors(404)
  versions(@Param('roomId', ParseUUIDPipe) roomId: string, @Param('id', ParseUUIDPipe) id: string): Promise<DocumentVersionView[]> {
    return this.documents.versions(roomId, id);
  }

  @Get(':id/download')
  @AllowExternal()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Download a document version (latest by default); client downloads are recorded as room engagement' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'version', required: false, type: Number })
  @ApiOkResponse({ description: 'The file', schema: { type: 'string', format: 'binary' } })
  @ApiErrors(400, 404)
  async download(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('version') version: string | undefined,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<StreamableFile> {
    let v: number | null = null;
    if (version !== undefined) {
      v = Number(version);
      if (!Number.isInteger(v) || v < 1) throw new BadRequestException('version must be a positive integer');
    }
    const file = await this.documents.open(roomId, id, v, identity);
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.sizeBytes,
      disposition: `attachment; filename="${file.fileName.replace(/"/g, '')}"`,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a document (audit: document.renamed)' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: RenameDocumentDto })
  @ApiOkResponse({ type: DocumentDto })
  @ApiErrors(400, 404)
  rename(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @CurrentUser() identity: AuthenticatedUser,
  ): Promise<DocumentView> {
    return this.documents.rename(roomId, id, requiredString('title', asObject(body).title, 200), identity);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a document with all versions (audit: document.deleted)' })
  @ApiParam({ name: 'roomId', format: 'uuid' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiErrors(404)
  async remove(@Param('roomId', ParseUUIDPipe) roomId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<void> {
    await this.documents.remove(roomId, id, identity);
  }
}

@ApiTags('Agreements')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('v1/agreements/:id/signatures')
export class SignaturesController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @AllowExternal()
  @ApiOperation({ summary: 'Electronic signatures on an agreement' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: [SignatureDto] })
  @ApiErrors(404)
  list(@Param('id', ParseUUIDPipe) id: string): Promise<SignatureView[]> {
    return this.documents.signatures(id);
  }

  @Post()
  @AllowExternal()
  @ApiOperation({
    summary: 'Sign an agreement awaiting approval (client contacts only; audit: agreement.signed)',
    description: 'Simple electronic signature: drawn signature (PNG), login e-mail, timestamp and SHA-256 of the signed content. Also records terms_accepted in the linked room.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: SignDto })
  @ApiCreatedResponse({ type: SignatureDto })
  @ApiErrors(400, 404, 409)
  sign(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<SignatureView> {
    const raw = asObject(body);
    const signerName = requiredString('signerName', raw.signerName, 200);
    const image = typeof raw.signatureImage === 'string' ? raw.signatureImage : '';
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!m) throw new BadRequestException('signatureImage must be a data:image/png;base64 URL');
    return this.documents.sign(id, signerName, Buffer.from(m[1], 'base64'), identity);
  }

  @Get(':signatureId/image')
  @AllowExternal()
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'The drawn signature image' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'signatureId', format: 'uuid' })
  @ApiOkResponse({ description: 'PNG image', schema: { type: 'string', format: 'binary' } })
  @ApiErrors(404)
  async image(@Param('id', ParseUUIDPipe) id: string, @Param('signatureId', ParseUUIDPipe) signatureId: string): Promise<StreamableFile> {
    return new StreamableFile(await this.documents.signatureImage(id, signatureId), { type: 'image/png', disposition: 'inline' });
  }
}
