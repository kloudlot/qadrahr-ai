import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TextExtractionService } from '../extraction/text-extraction.service';
import { LlmService } from '../llm/llm.service';
import type { Usage } from '../llm/llm.types';
import { matchMessages, normaliseSkills, screeningMessages } from './recruitment.prompts';
import {
  MatchRequestSchema,
  MatchScore,
  MatchScoreSchema,
  Posting,
  ScreeningResult,
  ScreeningResultSchema,
} from './recruitment.schemas';

export interface ScreenResponse {
  result: ScreeningResult;
  document: { format: string; characters: number; truncated: boolean };
  usage: Usage;
}

@Injectable()
export class RecruitmentService {
  constructor(
    private readonly llm: LlmService,
    private readonly extraction: TextExtractionService,
  ) {}

  /** Screens a CV — a file, or text when there is no file — against a posting. */
  async screen(
    posting: Posting,
    cv: { file?: Buffer; filename?: string; text?: string | null },
  ): Promise<ScreenResponse> {
    const document = cv.file
      ? await this.extraction.extract(cv.file, cv.filename)
      : this.extraction.fromText(cv.text ?? '');

    const { data, usage } = await this.llm.structured({
      name: 'cv_screening',
      schema: ScreeningResultSchema,
      messages: screeningMessages(posting, document.text),
    });

    const result: ScreeningResult = {
      extracted: { ...data.extracted, skills: normaliseSkills(data.extracted.skills) },
      // The recommendation follows from the score, not the model's say-so:
      // one rule for every candidate, whatever the model chose to call it.
      evaluation: { ...data.evaluation, recommendation: recommendationFor(data.evaluation.score) },
    };

    return {
      result,
      document: {
        format: document.format,
        characters: document.text.length,
        truncated: document.truncated,
      },
      usage,
    };
  }

  async match(
    input: z.infer<typeof MatchRequestSchema>,
  ): Promise<{ result: MatchScore; usage: Usage }> {
    const normalised = {
      role: { ...input.role, skillsRequired: normaliseSkills(input.role.skillsRequired) },
      candidate: { ...input.candidate, skills: normaliseSkills(input.candidate.skills) },
    };
    const { data, usage } = await this.llm.structured({
      name: 'match_score',
      schema: MatchScoreSchema,
      messages: matchMessages(normalised),
    });
    return { result: data, usage };
  }
}

export function recommendationFor(score: number): ScreeningResult['evaluation']['recommendation'] {
  if (score > 75) return 'interview';
  if (score >= 50) return 'review';
  return 'reject';
}
