import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { Agreement } from '../sales-rooms/entities/agreement.entity.js';
import { DigitalSalesRoom } from '../sales-rooms/entities/digital-sales-room.entity.js';
import { UserModule } from '../user/user.module.js';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { Client } from './entities/client.entity.js';
import { Contact } from './entities/contact.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Client, Contact, Agreement, DigitalSalesRoom]), CoreModule, UserModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
