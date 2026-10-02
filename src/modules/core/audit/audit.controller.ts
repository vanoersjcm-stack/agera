import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { type AuditLogPage, AuditService } from './audit.service.js';

const MAX_LIMIT = 100;

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<AuditLogPage> {
    if (page < 1 || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`page must be >= 1 and limit between 1 and ${MAX_LIMIT}`);
    }
    return this.audit.findForActiveTenant(page, limit);
  }
}
