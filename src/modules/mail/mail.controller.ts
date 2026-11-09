import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AuditService } from '../core/audit/audit.service.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalUuid, requiredString } from '../core/http/validation.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { UserService } from '../user/user.service.js';
import { MailService, type MailStatus } from './mail.service.js';

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

@ApiTags('E-mail')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('v1/mail')
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly context: TenantContext,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether outgoing e-mail (SMTP relay from .env) is configured and reachable' })
  status(): Promise<MailStatus> {
    return this.mail.status();
  }

  @Post('send')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a plain-text e-mail through the SMTP relay; logged in the activity log' })
  @ApiErrors(400, 503)
  async send(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<{ messageId: string }> {
    const raw = asObject(body);
    const to = requiredString('to', raw.to, 254).trim();
    if (!EMAIL.test(to)) throw new BadRequestException('to must be one e-mail address');
    const subject = requiredString('subject', raw.subject, 300);
    if (/[\r\n]/.test(subject)) throw new BadRequestException('subject must be a single line');
    const text = requiredString('text', raw.text, 50_000);
    const clientId = optionalUuid('clientId', raw.clientId);
    const actor = await this.users.resolveActor(identity);
    const result = await this.mail.send({ to, subject, text, replyTo: actor.email });
    this.audit.logAction(this.context.tenantId, actor.id, 'mail.sent', { to, subject, clientId });
    return result;
  }
}
