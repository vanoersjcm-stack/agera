import { ApiProperty } from '@nestjs/swagger';
import { VisitReportDto } from '../../retailcare/dto/visit-record.dto.js';
import { VisitDto } from '../../retailcare/dto/visit.dto.js';
import { WorkOrderDto } from '../../work-orders/dto/work-order.dto.js';

export class SyncOverviewDto {
  @ApiProperty({ type: [WorkOrderDto], description: 'Changed work orders, oldest change first' })
  workOrders!: WorkOrderDto[];

  @ApiProperty({
    type: [VisitDto],
    description: 'Changed visits, oldest change first. A visit also changes when its report or photos change.',
  })
  visits!: VisitDto[];

  @ApiProperty({ type: [VisitReportDto], description: 'Changed visit reports, oldest change first' })
  reports!: VisitReportDto[];

  @ApiProperty({ description: 'More changes are waiting; call again with updatedSince = nextUpdatedSince' })
  hasMore!: boolean;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Send as updatedSince on the next poll (null only when nothing exists yet)',
  })
  nextUpdatedSince!: Date | null;
}
