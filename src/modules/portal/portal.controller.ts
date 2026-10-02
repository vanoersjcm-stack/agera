import { BadRequestException, Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AllowApiKey } from '../auth/allow-api-key.decorator.js';
import { ApiErrors, ApiUpdatedSince, BEARER_AUTH } from '../core/http/api-docs.js';
import { parseTimestamp } from '../core/http/validation.js';
import { toReportResponse } from '../retailcare/visit-records.controller.js';
import { toVisitResponse } from '../retailcare/visits.controller.js';
import { toWorkOrderResponse } from '../work-orders/work-orders.controller.js';
import { SyncOverviewDto } from './dto/portal.dto.js';
import { PortalService } from './portal.service.js';

export const MAX_SYNC_LIMIT = 500;

@ApiTags('portal')
@ApiBearerAuth(BEARER_AUTH)
@ApiErrors(401, 403)
@Controller('portal/sync')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('overview')
  @AllowApiKey()
  @ApiOperation({
    summary: 'Delta of work orders, visits and reports changed after updatedSince (pull-based portal sync)',
    description:
      'Without updatedSince the full state is returned page by page. Poll with updatedSince = the previous ' +
      'nextUpdatedSince; repeat immediately while hasMore is true.',
  })
  @ApiUpdatedSince()
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: MAX_SYNC_LIMIT, default: 100 },
    description: 'Maximum rows per collection',
  })
  @ApiOkResponse({ type: SyncOverviewDto })
  @ApiErrors(400)
  async overview(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('updatedSince') updatedSince?: string,
  ): Promise<SyncOverviewDto> {
    if (limit < 1 || limit > MAX_SYNC_LIMIT) {
      throw new BadRequestException(`limit must be between 1 and ${MAX_SYNC_LIMIT}`);
    }
    const result = await this.portal.overview(parseTimestamp('updatedSince', updatedSince), limit);
    return {
      workOrders: result.workOrders.map(toWorkOrderResponse),
      visits: result.visits.map(toVisitResponse),
      reports: result.reports.map(toReportResponse),
      hasMore: result.hasMore,
      nextUpdatedSince: result.nextUpdatedSince,
    };
  }
}
