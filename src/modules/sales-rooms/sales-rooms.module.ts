import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { Agreement } from './entities/agreement.entity.js';
import { DigitalSalesRoom } from './entities/digital-sales-room.entity.js';
import { AgreementsController, AnomaliesController, SalesRoomsController } from './sales-rooms.controller.js';
import { SalesRoomsService } from './sales-rooms.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Agreement, DigitalSalesRoom]), CoreModule, UserModule],
  controllers: [AgreementsController, SalesRoomsController, AnomaliesController],
  providers: [SalesRoomsService],
})
export class SalesRoomsModule {}
