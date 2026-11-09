import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { IncomingMessage } from 'node:http';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, oneOf, optionalString, optionalUuid, requiredString } from '../core/http/validation.js';
import { BadRequestException } from '@nestjs/common';
import { MAX_DOCUMENT_BYTES } from '../documents/documents.service.js';
import { type EditorSession, NEW_FORMATS, type OfficeDocumentView, OfficeService, type OfficeVersionView } from './office.service.js';

@ApiTags('Office documents')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('v1/documents')
export class OfficeDocumentsController {
  constructor(private readonly office: OfficeService) {}

  @Get('editor-status')
  @ApiOperation({ summary: 'Whether the office editor (Collabora Online) is connected' })
  status(): Promise<{ connected: boolean; editor: string }> {
    return this.office.status();
  }

  @Get()
  @ApiOperation({ summary: "A client's documents (Word, spreadsheets, presentations and other files), newest first" })
  @ApiQuery({ name: 'clientId', format: 'uuid', required: false })
  @ApiQuery({ name: 'drafts', required: false, description: 'true: documents of all clients not yet shared in a client room (the Navigator drafts list)' })
  @ApiErrors(400)
  list(@Query('clientId') clientId?: string, @Query('drafts') drafts?: string): Promise<OfficeDocumentView[]> {
    if (drafts === 'true') return this.office.drafts();
    const id = optionalUuid('clientId', clientId);
    if (!id) throw new BadRequestException('clientId is required');
    return this.office.list(id);
  }

  @Post()
  @ApiOperation({ summary: 'New .docx/.xlsx/.pptx for a client: blank, from a document template (docx) or a CSV starter (xlsx)' })
  @ApiErrors(400, 404, 503)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<OfficeDocumentView> {
    const raw = asObject(body);
    const clientId = optionalUuid('clientId', raw.clientId);
    if (!clientId) throw new BadRequestException('clientId is required');
    const starterCsv = typeof raw.starterCsv === 'string' && raw.starterCsv.length <= 200_000 ? raw.starterCsv : null;
    return this.office.create(
      {
        clientId,
        contactId: optionalUuid('contactId', raw.contactId),
        dealId: optionalUuid('dealId', raw.dealId),
        clientRoomId: optionalUuid('clientRoomId', raw.clientRoomId),
        title: requiredString('title', raw.title, 200),
        format: oneOf('format', raw.format, NEW_FORMATS),
        templateId: optionalUuid('templateId', raw.templateId),
        starterCsv,
      },
      identity,
    );
  }

  @Get(':id')
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<OfficeDocumentView> {
    return this.office.get(id);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Version history with SHA-256 fingerprints and who saved each version' })
  @ApiErrors(404)
  versions(@Param('id', ParseUUIDPipe) id: string): Promise<OfficeVersionView[]> {
    return this.office.versions(id);
  }

  @Get(':id/download')
  @ApiQuery({ name: 'version', required: false })
  @ApiErrors(404)
  async download(@Param('id', ParseUUIDPipe) id: string, @Query('version') version: string | undefined): Promise<StreamableFile> {
    const n = version ? Number(version) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1)) throw new BadRequestException('version must be a positive integer');
    const file = await this.office.download(id, n);
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.sizeBytes,
      disposition: `attachment; filename="${file.fileName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  @Post(':id/session')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open the document in the office editor: returns the editor URL and a 60-minute access token' })
  @ApiErrors(400, 404, 503)
  session(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<EditorSession> {
    return this.office.session(id, identity);
  }
}

type Request = IncomingMessage & { body?: unknown };
interface Response {
  status(code: number): Response;
  setHeader(name: string, value: string): unknown;
  end(): void;
  json(body: unknown): void;
}

function readBody(req: Request, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BadRequestException('File too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** WOPI host for Collabora Online; authenticated by the access token from POST /v1/documents/:id/session. */
@ApiExcludeController()
@Public()
@Controller('v1/wopi/files')
export class WopiController {
  constructor(private readonly office: OfficeService) {}

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  checkFileInfo(@Param('id', ParseUUIDPipe) id: string, @Query('access_token') token: string | undefined): Promise<Record<string, unknown>> {
    return this.office.checkFileInfo(id, token);
  }

  @Get(':id/contents')
  async getFile(@Param('id', ParseUUIDPipe) id: string, @Query('access_token') token: string | undefined, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.office.getFile(id, token);
    res.setHeader('X-WOPI-ItemVersion', String(file.version));
    return new StreamableFile(file.stream, { type: 'application/octet-stream' });
  }

  @Post(':id/contents')
  async putFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('access_token') token: string | undefined,
    @Headers('x-wopi-lock') lock: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const data = Buffer.isBuffer(req.body) ? req.body : await readBody(req, MAX_DOCUMENT_BYTES);
    const result = await this.office.putFile(id, token, data, lock);
    if ('conflict' in result) {
      res.status(409).setHeader('X-WOPI-Lock', result.conflict);
      res.end();
      return;
    }
    res.setHeader('X-WOPI-ItemVersion', String(result.version));
    res.status(200).json({ LastModifiedTime: result.lastModified });
  }

  @Post(':id')
  async lock(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('access_token') token: string | undefined,
    @Headers('x-wopi-override') override: string | undefined,
    @Headers('x-wopi-lock') lock: string | undefined,
    @Headers('x-wopi-oldlock') oldLock: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.office.lock(id, token, (override ?? '').toUpperCase(), lock ?? '', oldLock);
    if (result.lock !== undefined) res.setHeader('X-WOPI-Lock', result.lock);
    res.status(result.status).end();
  }
}
