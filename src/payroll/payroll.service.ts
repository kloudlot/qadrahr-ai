import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { reviewBriefMessages } from './payroll.prompts';
import { ReviewBriefRequest, ReviewBriefResponse, ReviewBriefSchema } from './payroll.schemas';

const MAX_PRIORITIES = 5;

@Injectable()
export class PayrollService {
  constructor(private readonly llm: LlmService) {}

  /**
   * A brief for the approver, from findings the backend already made.
   *
   * Priorities that cite no real finding are dropped: the brief points the
   * reviewer at findings, it doesn't add new ones. With nothing to say,
   * there is no call.
   */
  async reviewBrief(input: ReviewBriefRequest): Promise<ReviewBriefResponse> {
    const worth = input.findings.filter((f) => f.severity !== 'info');
    if (!worth.length) {
      return {
        result: {
          summary:
            'Nothing in this run needs a closer look: no bank changes, no unusual swings in net pay, and the payslips add up.',
          priorities: [],
        },
        usage: { model: this.llm.model, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    const { data, usage } = await this.llm.structured({
      name: 'payroll_review_brief',
      schema: ReviewBriefSchema,
      messages: reviewBriefMessages(input),
    });

    const ids = new Set(input.findings.map((f) => f.id));
    const priorities = data.priorities
      .map((p) => ({ ...p, findings: [...new Set(p.findings)].filter((id) => ids.has(id)) }))
      .filter((p) => p.findings.length > 0)
      .slice(0, MAX_PRIORITIES);

    return { result: { summary: data.summary, priorities }, usage };
  }
}
