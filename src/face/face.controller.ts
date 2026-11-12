import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Caller, CallerContext } from '../auth/caller.decorator';
import { FaceService } from './face.service';

const MAX_FRAMES = parseInt(process.env.FACE_MAX_FRAMES || '6', 10);
const MAX_FRAME_BYTES = parseInt(process.env.FACE_MAX_FRAME_BYTES || String(3 * 1024 * 1024), 10);

@Controller('v1/face')
export class FaceController {
  constructor(private readonly face: FaceService) {}

  /**
   * Measures the face in each frame.
   *
   * multipart/form-data, one or more files named `frames`, answered in the
   * order sent. For each: how many faces, and for the largest its box,
   * landmarks, head turn, size, focus, exposure and identity embedding.
   *
   * Nothing is kept, and nothing is decided: no template is stored here and
   * no two faces are compared. The caller holds the templates and the rules.
   */
  @Post('analyse')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('frames', MAX_FRAMES, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FRAME_BYTES, files: MAX_FRAMES },
    }),
  )
  async analyse(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    // Named so the tenant is on the request, for logs; nothing is looked up by it.
    @CallerContext() _caller: Caller,
  ) {
    if (!files?.length) throw new BadRequestException('Send at least one image as `frames`');
    return this.face.analyse(files.map((file) => file.buffer));
  }
}
