import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { FinancialLineItem } from './entities/financial-line-item.entity.js';
import { FinancialModel } from './entities/financial-model.entity.js';
import { FinancialsController } from './financials.controller.js';
import { FinancialsService } from './financials.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([FinancialModel, FinancialLineItem]), CoreModule, UserModule],
  controllers: [FinancialsController],
  providers: [FinancialsService],
})
export class FinancialsModule {}
