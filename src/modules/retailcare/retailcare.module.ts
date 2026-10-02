import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { User } from '../core/entities/index.js';
import { UserModule } from '../user/user.module.js';
import { WorkOrder } from '../work-orders/entities/work-order.entity.js';
import { MerchandisingVisit } from './entities/merchandising-visit.entity.js';
import { Store } from './entities/store.entity.js';
import { StoresController } from './stores.controller.js';
import { StoresService } from './stores.service.js';
import { VisitsController } from './visits.controller.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Store, MerchandisingVisit, User, WorkOrder]), CoreModule, UserModule],
  controllers: [StoresController, VisitsController],
  providers: [StoresService, VisitsService],
})
export class RetailCareModule {}
