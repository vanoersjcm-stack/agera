import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { MailController } from './mail.controller.js';
import { MailService } from './mail.service.js';

@Module({
  imports: [CoreModule, UserModule],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
