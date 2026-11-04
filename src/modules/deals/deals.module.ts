import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { DealsController, MilestonesController } from './deals.controller.js';
import { DealsService, MilestonesService } from './deals.service.js';
import { DealStageChange } from './entities/deal-stage-change.entity.js';
import { Deal } from './entities/deal.entity.js';
import { RoomMilestone } from './entities/room-milestone.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Deal, DealStageChange, RoomMilestone]), CoreModule, UserModule],
  controllers: [DealsController, MilestonesController],
  providers: [DealsService, MilestonesService],
})
export class DealsModule {}
