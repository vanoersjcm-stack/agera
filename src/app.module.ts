import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CoreModule } from './modules/core/core.module.js';
import { UserModule } from './modules/user/user.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    CoreModule,
    AuthModule,
    UserModule,
  ],
})
export class AppModule {}
