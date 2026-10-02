import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { Tenant } from '../core/entities/index.js';
import { UserModule } from '../user/user.module.js';
import { ApiKey } from './api-key.entity.js';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey, Tenant]), CoreModule, UserModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
