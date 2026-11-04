import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import configuration from './config/configuration.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ClientsModule } from './modules/clients/clients.module.js';
import { CoreModule } from './modules/core/core.module.js';
import { DealsModule } from './modules/deals/deals.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { FieldModule } from './modules/field/field.module.js';
import { GovernanceModule } from './modules/governance/governance.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';
import { FinancialsModule } from './modules/financials/financials.module.js';
import { NexusModule } from './modules/nexus/nexus.module.js';
import { SalesRoomsModule } from './modules/sales-rooms/sales-rooms.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { PortalModule } from './modules/portal/portal.module.js';
import { RetailCareModule } from './modules/retailcare/retailcare.module.js';
import { UserModule } from './modules/user/user.module.js';
import { WorkOrdersModule } from './modules/work-orders/work-orders.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    EventEmitterModule.forRoot(),
    CoreModule,
    AuthModule,
    UserModule,
    WorkOrdersModule,
    RetailCareModule,
    PortalModule,
    FinancialsModule,
    NexusModule,
    SalesRoomsModule,
    SearchModule,
    DocumentsModule,
    FieldModule,
    ClientsModule,
    DealsModule,
    InvoicesModule,
    GovernanceModule,
  ],
})
export class AppModule {}
