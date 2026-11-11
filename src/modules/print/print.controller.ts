import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AllowJobRoles } from '../auth/job-roles.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalUuid, requiredString } from '../core/http/validation.js';
import { BadRequestException } from '@nestjs/common';
import { type PrintJobView, PrintService, type PrintStatus } from './print.service.js';

@ApiTags('Print')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@AllowJobRoles('HQ_ADMIN', 'ACCOUNT_MANAGER')
@Controller('v1/print')
export class PrintController {
  constructor(private readonly print: PrintService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the local CUPS / IPP-over-TLS print server (CUPS_IPP_URL) is configured and reachable' })
  status(): Promise<PrintStatus> {
    return this.print.status();
  }

  @Get('jobs')
  @ApiOperation({ summary: 'My pull-print jobs (latest 50); the release code is shown while a job is queued' })
  jobs(@CurrentUser() identity: AuthenticatedUser): Promise<PrintJobView[]> {
    return this.print.mine(identity);
  }

  @Post('queue')
  @ApiOperation({ summary: 'Queue an office document for pull printing; returns the job with its 6-digit release code (audit: print.queued)' })
  @ApiErrors(400, 404)
  queue(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<PrintJobView> {
    const raw = asObject(body);
    const copies = raw.copies === undefined ? 1 : Number(raw.copies);
    if (!Number.isInteger(copies) || copies < 1 || copies > 20) throw new BadRequestException('copies must be between 1 and 20');
    const documentId = optionalUuid('documentId', raw.documentId);
    if (!documentId) throw new BadRequestException('documentId is required');
    return this.print.queue(documentId, copies, identity);
  }

  @Post('release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release my queued job with its release code and send it to the printer (audit: print.released); 503 when the print server is not connected' })
  @ApiErrors(400, 404, 503)
  release(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<PrintJobView> {
    const code = requiredString('code', asObject(body).code, 6);
    if (!/^[0-9]{6}$/.test(code)) throw new BadRequestException('code must be 6 digits');
    return this.print.release(code, identity);
  }
}
