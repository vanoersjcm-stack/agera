import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { User } from '../core/entities/index.js';
import { UserModule } from '../user/user.module.js';
import { WorkOrderLog } from './entities/work-order-log.entity.js';
import { WorkOrder } from './entities/work-order.entity.js';
import { WorkOrdersController } from './work-orders.controller.js';
import { WorkOrdersService } from './work-orders.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WorkOrder, WorkOrderLog, User]), CoreModule, UserModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}
