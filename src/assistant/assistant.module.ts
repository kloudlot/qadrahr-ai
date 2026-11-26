import { Module } from '@nestjs/common';
import { TextExtractionService } from '../extraction/text-extraction.service';
import { AssistantController, DocumentsController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/** Answers from an organisation's own documents, and reading those documents. */
@Module({
  controllers: [AssistantController, DocumentsController],
  providers: [AssistantService, TextExtractionService],
})
export class AssistantModule {}
