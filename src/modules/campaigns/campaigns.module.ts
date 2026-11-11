import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { MailModule } from '../mail/mail.module.js';
import { SurveysModule } from '../surveys/surveys.module.js';
import { UserModule } from '../user/user.module.js';
import { MailMergeController } from './mail-merge.controller.js';
import { MailMergeService } from './mail-merge.service.js';

@Module({
  imports: [CoreModule, UserModule, MailModule, SurveysModule],
  controllers: [MailMergeController],
  providers: [MailMergeService],
})
export class CampaignsModule {}
