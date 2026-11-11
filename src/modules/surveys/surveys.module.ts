import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { PortalSurveysController, SurveysController } from './surveys.controller.js';
import { SurveysService } from './surveys.service.js';

@Module({
  imports: [CoreModule, UserModule],
  controllers: [SurveysController, PortalSurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
