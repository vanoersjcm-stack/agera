import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { PLATFORM_ADMIN_ROLE, Roles } from '../auth/roles.decorator.js';
import { ApiErrors, BEARER_AUTH } from '../core/http/api-docs.js';
import { asObject, optionalUuid, requiredString } from '../core/http/validation.js';
import { CreditHoldsService, type CreditHoldView } from './credit-holds.service.js';

export class CreditHoldInputDto {
  @ApiProperty({ required: false, nullable: true, type: String, format: 'uuid', description: 'Leave empty for an organisation-wide lock' }) clientId?: string | null;
  @ApiProperty({ example: 'Payment overdue > 60 days' }) reason!: string;
}

export class CreditHoldDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) clientId!: string | null;
  @ApiProperty({ type: String, nullable: true }) clientName!: string | null;
  @ApiProperty() reason!: string;
  @ApiProperty({ type: String, nullable: true }) setByName!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) releasedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) releasedByName!: string | null;
  @ApiProperty() active!: boolean;
}

@ApiTags('governance')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller({ path: 'governance/credit-holds', version: '1' })
export class CreditHoldsController {
  constructor(private readonly holds: CreditHoldsService) {}

  @Get()
  @ApiOperation({ summary: 'Credit locks of the active tenant (active ones first)' })
  @ApiQuery({ name: 'includeReleased', required: false, type: Boolean })
  @ApiOkResponse({ type: [CreditHoldDto] })
  list(@Query('includeReleased') includeReleased?: string): Promise<CreditHoldView[]> {
    return this.holds.list(includeReleased === 'true');
  }

  @Post()
  @Roles('admin', PLATFORM_ADMIN_ROLE)
  @ApiOperation({ summary: 'Set an emergency credit lock; blocks agreement activation (audit: credit_hold.set)' })
  @ApiBody({ type: CreditHoldInputDto })
  @ApiCreatedResponse({ type: CreditHoldDto })
  @ApiErrors(400, 409)
  create(@Body() body: unknown, @CurrentUser() identity: AuthenticatedUser): Promise<CreditHoldView> {
    const raw = asObject(body);
    return this.holds.create({ clientId: optionalUuid('clientId', raw.clientId), reason: requiredString('reason', raw.reason, 1000).trim() }, identity);
  }

  @Delete(':id')
  @Roles('admin', PLATFORM_ADMIN_ROLE)
  @ApiOperation({ summary: 'Release a credit lock (audit: credit_hold.released)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CreditHoldDto })
  @ApiErrors(400, 404, 409)
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() identity: AuthenticatedUser): Promise<CreditHoldView> {
    return this.holds.release(id, identity);
  }
}
