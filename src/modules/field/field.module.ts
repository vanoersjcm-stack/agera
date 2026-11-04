import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { RetailCareModule } from '../retailcare/retailcare.module.js';
import { UserModule } from '../user/user.module.js';
import { FieldController } from './field.controller.js';
import { FieldService } from './field.service.js';

@Module({
  imports: [CoreModule, UserModule, RetailCareModule],
  controllers: [FieldController],
  providers: [FieldService],
})
export class FieldModule {}
