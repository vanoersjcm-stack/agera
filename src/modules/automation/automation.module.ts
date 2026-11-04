import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { AutomationController } from './automation.controller.js';
import { AutomationService } from './automation.service.js';

@Module({
  imports: [CoreModule, UserModule],
  controllers: [AutomationController],
  providers: [AutomationService],
})
export class AutomationModule {}
