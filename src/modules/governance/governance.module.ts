import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { CreditHold } from './credit-hold.entity.js';
import { CreditHoldsController } from './credit-holds.controller.js';
import { CreditHoldsService } from './credit-holds.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([CreditHold]), CoreModule, UserModule],
  controllers: [CreditHoldsController],
  providers: [CreditHoldsService],
})
export class GovernanceModule {}
