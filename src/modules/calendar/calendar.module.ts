import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

@Module({
  imports: [CoreModule, UserModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
