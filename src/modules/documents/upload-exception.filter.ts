import { type ArgumentsHost, BadRequestException, Catch, type ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { MAX_DOCUMENT_BYTES } from './documents.service.js';

/** Reports oversized uploads as 400 (multer's limit surfaces as 413 by default). */
@Catch(PayloadTooLargeException)
export class DocumentUploadExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  override catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    super.catch(new BadRequestException(`file must be at most ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB`), host);
  }
}
