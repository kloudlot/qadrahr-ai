import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { TextExtractionService } from '../extraction/text-extraction.service';
import { LlmService } from '../llm/llm.service';
import type { Usage } from '../llm/llm.types';
import {
  candidateProbeMessages,
  interviewKitMessages,
  jobDescriptionMessages,
  matchMessages,
  normaliseSkills,
  screeningMessages,
  touchesProtectedTopic,
} from './recruitment.prompts';
import {
  CandidateProbes,
  CandidateProbesRequestSchema,
  CandidateProbesSchema,
  InterviewKit,
  InterviewKitRequestSchema,
  InterviewKitSchema,
  JobDescriptionDraft,
  JobDescriptionDraftSchema,
  JobDescriptionRequestSchema,
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

  /** A careers-page advert, drafted from the requisition and designation. Nothing is saved. */
  async jobDescription(
    input: z.infer<typeof JobDescriptionRequestSchema>,
  ): Promise<{ result: JobDescriptionDraft; usage: Usage }> {
    const { data, usage } = await this.llm.structured({
      name: 'job_description',
      schema: JobDescriptionDraftSchema,
      messages: jobDescriptionMessages(input),
    });
    const clean = (items: string[]) => items.map((i) => i.trim()).filter(Boolean);
    return {
      result: {
        title: data.title.trim() || input.role.title,
        summary: data.summary.trim(),
        responsibilities: clean(data.responsibilities),
        requirements: clean(data.requirements),
        niceToHave: clean(data.niceToHave),
      },
      usage,
    };
  }

  /**
   * The questions every candidate for a posting is asked. Any that touch a
   * protected topic are dropped, whatever the model returned.
   */
  async interviewKit(
    input: z.infer<typeof InterviewKitRequestSchema>,
  ): Promise<{ result: InterviewKit; removed: number; usage: Usage }> {
    const { data, usage } = await this.llm.structured({
      name: 'interview_kit',
      schema: InterviewKitSchema,
      messages: interviewKitMessages(input.posting, input.stage),
    });
    const fair = data.questions.filter((q) => !touchesProtectedTopic(q.question));
    return {
      result: { questions: fair.slice(0, MAX_QUESTIONS), criteria: data.criteria.slice(0, 6) },
      removed: data.questions.length - fair.length,
      usage,
    };
  }

  /** Follow-up questions for one candidate, from their screening's gaps. */
  async candidateProbes(
    input: z.infer<typeof CandidateProbesRequestSchema>,
  ): Promise<{ result: CandidateProbes; removed: number; usage: Usage }> {
    const { data, usage } = await this.llm.structured({
      name: 'candidate_probes',
      schema: CandidateProbesSchema,
      messages: candidateProbeMessages(input.posting, input.screening),
    });
    const fair = data.probes.filter((p) => !touchesProtectedTopic(p.question));
    return {
      result: { probes: fair.slice(0, MAX_PROBES) },
      removed: data.probes.length - fair.length,
      usage,
    };
  }
}

/** At most, whatever the model returns: a kit is read in an interview, not skimmed. */
const MAX_QUESTIONS = 10;
const MAX_PROBES = 5;

export function recommendationFor(score: number): ScreeningResult['evaluation']['recommendation'] {
  if (score > 75) return 'interview';
  if (score >= 50) return 'review';
  return 'reject';
}
