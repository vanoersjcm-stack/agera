import { Module } from '@nestjs/common';
import { CommercialModule } from '../commercial/commercial.module.js';
import { CoreModule } from '../core/core.module.js';
import { MailModule } from '../mail/mail.module.js';
import { UserModule } from '../user/user.module.js';
import { OfficeDocumentsController, WopiController } from './office.controller.js';
import { OfficeService } from './office.service.js';

@Module({
  imports: [CoreModule, UserModule, CommercialModule, MailModule],
  controllers: [OfficeDocumentsController, WopiController],
  providers: [OfficeService],
  exports: [OfficeService],
})
export class OfficeModule {}
