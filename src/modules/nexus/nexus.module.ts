import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { DsrActivity } from './entities/dsr-activity.entity.js';
import { NexusVoiceEvent } from './entities/nexus-voice-event.entity.js';
import { NexusController } from './nexus.controller.js';
import { NexusService } from './nexus.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([DsrActivity, NexusVoiceEvent]), CoreModule, UserModule],
  controllers: [NexusController],
  providers: [NexusService],
})
export class NexusModule {}
