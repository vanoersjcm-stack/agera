import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { FinancialsModule } from '../financials/financials.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { SalesRoomsModule } from '../sales-rooms/sales-rooms.module.js';
import { UserModule } from '../user/user.module.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  imports: [CoreModule, UserModule, FinancialsModule, SalesRoomsModule, InvoicesModule],
  controllers: [WorkflowController],
  providers: [WorkflowService],
})
export class WorkflowModule {}
