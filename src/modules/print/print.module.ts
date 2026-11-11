import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { OfficeModule } from '../office/office.module.js';
import { UserModule } from '../user/user.module.js';
import { PrintController } from './print.controller.js';
import { PrintService } from './print.service.js';

@Module({
  imports: [CoreModule, UserModule, OfficeModule],
  controllers: [PrintController],
  providers: [PrintService],
})
export class PrintModule {}
