import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { AllowJobRoles } from '../auth/job-roles.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, oneOf, optionalUuid } from '../core/http/validation.js';
import { audience } from '../surveys/surveys.controller.js';
import type { MailMergeInput, MailMergePreview } from './mail-merge.service.js';
import { MailMergeService } from './mail-merge.service.js';
import { BadRequestException } from '@nestjs/common';

const OBJ = { schema: { type: 'object' } };

function input(body: unknown): MailMergeInput {
  const o = asObject(body);
  const templateId = optionalUuid('templateId', o.templateId);
  if (!templateId) throw new BadRequestException('templateId is required');
  return { audience: audience(o), templateId, recipients: o.recipients === undefined ? 'primary' : oneOf('recipients', o.recipients, ['primary', 'all'] as const) };
}

@ApiTags('mail-merge')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(400, 401, 403)
@AllowJobRoles('HQ_ADMIN', 'ACCOUNT_MANAGER')
@Controller({ path: 'mail-merge', version: '1' })
export class MailMergeController {
  constructor(private readonly merge: MailMergeService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'ManyMail: personalised e-mail per contact for a client cohort (same filters as survey dispatch) and a mail template' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  preview(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<MailMergePreview> {
    return this.merge.preview(input(body), identity);
  }

  @Post('send')
  @HttpCode(202)
  @ApiOperation({ summary: 'ManyMail: send the merged batch through the SMTP relay (503 when not connected; audit: mail_merge.sent)' })
  @ApiBody(OBJ)
  @ApiOkResponse(OBJ)
  @ApiErrors(503)
  send(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<unknown> {
    return this.merge.send(input(body), identity);
  }
}
