import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { IdmsController, RetentionController } from './idms.controller.js';
import { IdmsService } from './idms.service.js';

@Module({
  imports: [CoreModule, UserModule],
  controllers: [IdmsController, RetentionController],
  providers: [IdmsService],
})
export class IdmsModule {}
