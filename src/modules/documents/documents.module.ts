import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { UserModule } from '../user/user.module.js';
import { RoomDocumentsController, SignaturesController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

@Module({
  imports: [CoreModule, UserModule],
  controllers: [RoomDocumentsController, SignaturesController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
