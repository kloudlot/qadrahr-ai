import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Caller, CallerContext } from '../auth/caller.decorator';
import { parseOr400 } from '../common/zod';
import { ReviewDraftRequestSchema } from './performance.schemas';
import { PerformanceService } from './performance.service';

@Controller('v1/performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  /**
   * A draft of a review's strengths, development areas and overall comment,
   * from the evidence the backend gathered — never names.
   */
  @Post('review-draft')
  @HttpCode(HttpStatus.OK)
  async reviewDraft(@Body() body: unknown, @CallerContext() _caller: Caller) {
    return this.performance.reviewDraft(parseOr400(ReviewDraftRequestSchema, body));
  }
}
