import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Caller, CallerContext } from '../auth/caller.decorator';
import { parseOr400 } from '../common/zod';
import { TextExtractionService } from '../extraction/text-extraction.service';
import { PolicyQuestionSchema } from './assistant.schemas';
import { AssistantService } from './assistant.service';

/** Multer's ceiling. The configured document limit is checked again, with a clearer message. */
const DOCUMENT_CEILING = parseInt(process.env.MAX_DOCUMENT_BYTES || String(25 * 1024 * 1024), 10);

@Controller('v1/assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /**
   * Answers an employee's question from the policies sent — and only them.
   * The backend decides which policies this employee may be shown.
   *
   * JSON: { question, policies: [{ ref, title, version?, summary?, text }] }
   */
  @Post('policy')
  @HttpCode(HttpStatus.OK)
  async policy(@Body() body: unknown, @CallerContext() _caller: Caller) {
    return this.assistant.answerPolicyQuestion(parseOr400(PolicyQuestionSchema, body));
  }
}

@Controller('v1/documents')
export class DocumentsController {
  constructor(private readonly extraction: TextExtractionService) {}

  /**
   * The text of a document (PDF, DOCX or text), for the backend to keep.
   * No model call: reading a policy once, rather than on every question.
   *
   * multipart/form-data: `file`.
   */
  @Post('extract')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: DOCUMENT_CEILING, files: 1 },
    }),
  )
  async extract(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CallerContext() _caller: Caller,
  ) {
    if (!file) throw new BadRequestException('Send the document as `file`');
    const document = await this.extraction.extract(file.buffer, file.originalname, 'document');
    return {
      text: document.text,
      format: document.format,
      characters: document.text.length,
      truncated: document.truncated,
    };
  }
}
