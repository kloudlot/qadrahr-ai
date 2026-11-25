import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Caller, CallerContext } from '../auth/caller.decorator';
import { parseOr400 } from '../common/zod';
import { ReviewBriefRequestSchema } from './payroll.schemas';
import { PayrollService } from './payroll.service';

@Controller('v1/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /**
   * A short brief for whoever approves a payroll run, from the findings
   * of the backend's own checks. JSON: { run, findings }.
   */
  @Post('review-brief')
  @HttpCode(HttpStatus.OK)
  async reviewBrief(@Body() body: unknown, @CallerContext() _caller: Caller) {
    return this.payroll.reviewBrief(parseOr400(ReviewBriefRequestSchema, body));
  }
}
