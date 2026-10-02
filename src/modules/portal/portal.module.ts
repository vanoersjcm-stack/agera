import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { MerchandisingVisit } from '../retailcare/entities/merchandising-visit.entity.js';
import { VisitReport } from '../retailcare/entities/visit-report.entity.js';
import { WorkOrder } from '../work-orders/entities/work-order.entity.js';
import { PortalController } from './portal.controller.js';
import { PortalService } from './portal.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, MerchandisingVisit, VisitReport]), CoreModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
