import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import configuration from './config/configuration.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CoreModule } from './modules/core/core.module.js';
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
  ],
})
export class AppModule {}
