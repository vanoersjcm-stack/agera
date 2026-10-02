import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../entities/index.js';
import { TenantContext } from './tenant-context.service.js';
import { TenantInterceptor } from './tenant.interceptor.js';
import { TenantResolver } from './tenant-resolver.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  providers: [TenantContext, TenantResolver, { provide: APP_INTERCEPTOR, useClass: TenantInterceptor }],
  exports: [TenantContext],
})
export class TenancyModule {}
