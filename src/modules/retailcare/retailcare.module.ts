import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { User } from '../core/entities/index.js';
import { UserModule } from '../user/user.module.js';
import { WorkOrder } from '../work-orders/entities/work-order.entity.js';
import { MerchandisingVisit } from './entities/merchandising-visit.entity.js';
import { Store } from './entities/store.entity.js';
import { VisitMedia } from './entities/visit-media.entity.js';
import { VisitReport } from './entities/visit-report.entity.js';
import { MediaStorage } from './media/media-storage.service.js';
import { StoresController } from './stores.controller.js';
import { StoresService } from './stores.service.js';
import { VisitRecordsController } from './visit-records.controller.js';
import { VisitRecordsService } from './visit-records.service.js';
import { VisitsController } from './visits.controller.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Store, MerchandisingVisit, VisitReport, VisitMedia, User, WorkOrder]),
    CoreModule,
    UserModule,
  ],
  controllers: [StoresController, VisitsController, VisitRecordsController],
  providers: [StoresService, VisitsService, VisitRecordsService, MediaStorage],
})
export class RetailCareModule {}
