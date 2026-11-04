import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [CoreModule, UserModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
