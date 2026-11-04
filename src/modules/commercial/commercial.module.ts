import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { UserModule } from '../user/user.module.js';
import { DocumentTemplatesController, PriceListsController, RoomTemplateDocumentsController } from './commercial.controller.js';
import { CommercialService } from './commercial.service.js';

@Module({
  imports: [CoreModule, UserModule, DocumentsModule],
  controllers: [PriceListsController, DocumentTemplatesController, RoomTemplateDocumentsController],
  providers: [CommercialService],
})
export class CommercialModule {}
