import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import type { Usage } from '../llm/llm.types';
import { reviewDraftMessages } from './performance.prompts';
import { ReviewDraft, ReviewDraftRequest, ReviewDraftSchema } from './performance.schemas';

/** The review form's own limit on each text field. */
const FIELD_MAX = 4000;

@Injectable()
export class PerformanceService {
  constructor(private readonly llm: LlmService) {}

  /** A first draft of a review's words, from the evidence. Ratings stay the writer's. */
  async reviewDraft(input: ReviewDraftRequest): Promise<{ result: ReviewDraft; usage: Usage }> {
    const { data, usage } = await this.llm.structured({
      name: 'review_draft',
      schema: ReviewDraftSchema,
      messages: reviewDraftMessages(input),
    });
    const fit = (text: string) => text.trim().slice(0, FIELD_MAX);
    return {
      result: {
        strengths: fit(data.strengths),
        developmentAreas: fit(data.developmentAreas),
        overallComment: fit(data.overallComment),
        checks: data.checks
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 3),
      },
      usage,
    };
  }
}
