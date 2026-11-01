import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { Client } from '../clients/entities/client.entity.js';
import { Store } from '../retailcare/entities/store.entity.js';
import { Agreement } from '../sales-rooms/entities/agreement.entity.js';
import { DigitalSalesRoom } from '../sales-rooms/entities/digital-sales-room.entity.js';
import { WorkOrder } from '../work-orders/entities/work-order.entity.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Store, WorkOrder, Agreement, DigitalSalesRoom, Client]), CoreModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
