import { z } from 'zod';

/** What the model must return. Strict structured output: every field required. */
export const PolicyAnswerSchema = z.object({
  answered: z
    .boolean()
    .describe('True only if the passages answer the question. False when they do not cover it'),
  answer: z
    .string()
    .describe(
      'The answer in plain language, at most about 150 words, addressed to the employee as "you". ' +
        'When not answered: one or two sentences saying the policies shown do not cover it and to ask HR',
    ),
  passages: z
    .array(z.string())
    .describe('Ids of every passage the answer relies on, e.g. "P2-4". Empty when not answered'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high: a passage states it plainly. medium: it follows from the passages with little reading-in. ' +
        'low: the passages are unclear, partial or conflicting',
    ),
});

export type PolicyAnswer = z.infer<typeof PolicyAnswerSchema>;

/* ── Requests from the backend ─────────────────────────────────────────── */

export const PolicyQuestionSchema = z.object({
  question: z.string().trim().min(3).max(1000),
  policies: z
    .array(
      z.object({
        /** The backend's id for the policy version, echoed back in citations. */
        ref: z.string().min(1).max(64),
        title: z.string().min(1).max(200),
        version: z.number().int().min(1).nullish(),
        summary: z.string().max(5000).nullish(),
        text: z.string().max(1_000_000).default(''),
      }),
    )
    .min(1)
    .max(200),
});

export type PolicyQuestion = z.infer<typeof PolicyQuestionSchema>;

export interface PolicyCitation {
  ref: string;
  title: string;
  version: number | null;
  passage: string;
  /** Our copy of the passage, never the model's: a citation can't misquote. */
  excerpt: string;
}

export interface PolicyAnswerResponse {
  result: {
    answered: boolean;
    answer: string;
    confidence: PolicyAnswer['confidence'];
    citations: PolicyCitation[];
  };
  context: {
    policies: number;
    passages: number;
    /** Passages shown to the model. */
    selected: number;
    /** False when the policies were too long to show whole and passages were chosen. */
    complete: boolean;
  };
  usage: { model: string; promptTokens: number; completionTokens: number; totalTokens: number };
}
