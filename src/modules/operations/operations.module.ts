import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { OperationsController } from './operations.controller.js';
import { OperationsService } from './operations.service.js';

@Module({
  imports: [CoreModule, UserModule],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
