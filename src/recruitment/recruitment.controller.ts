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
import { MatchRequestSchema, ScreenRequestSchema } from './recruitment.schemas';
import { RecruitmentService } from './recruitment.service';

/** Multer's own ceiling. The configured CV limit is checked again, with a clearer message, by extraction. */
const UPLOAD_CEILING = parseInt(process.env.MAX_CV_BYTES || String(10 * 1024 * 1024), 10);

@Controller('v1/recruitment')
export class RecruitmentController {
  constructor(private readonly recruitment: RecruitmentService) {}

  /**
   * Screens a CV against a posting.
   *
   * multipart/form-data:
   * - `posting` — JSON: { title, description, requirements?, location?, workMode?, department?, designation? }
   * - `cv` — the file (PDF, DOCX or text), or
   * - `cvText` — text instead of a file, e.g. a cover letter.
   */
  @Post('screen')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('cv', {
      storage: memoryStorage(),
      limits: { fileSize: UPLOAD_CEILING, files: 1 },
    }),
  )
  async screen(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    // Named so the tenant is on the request, for logs; nothing is looked up by it.
    @CallerContext() _caller: Caller,
  ) {
    const request = parseOr400(ScreenRequestSchema, {
      posting: parseJsonField(body.posting, 'posting'),
      cvText: body.cvText,
    });

    if (!file && !request.cvText?.trim()) {
      throw new BadRequestException('Send a CV file as `cv`, or its text as `cvText`');
    }

    return this.recruitment.screen(request.posting, {
      file: file?.buffer,
      filename: file?.originalname,
      text: request.cvText,
    });
  }

  /** Scores a structured candidate profile against a role. JSON in, JSON out. */
  @Post('match')
  @HttpCode(HttpStatus.OK)
  async match(@Body() body: unknown, @CallerContext() _caller: Caller) {
    return this.recruitment.match(parseOr400(MatchRequestSchema, body));
  }
}

function parseJsonField(value: unknown, name: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new BadRequestException(`\`${name}\` must be JSON`);
  }
}
