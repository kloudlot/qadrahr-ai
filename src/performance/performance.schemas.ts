import { z } from 'zod';

/** What the model must return: the review's three text fields, and what to check. */
export const ReviewDraftSchema = z.object({
  strengths: z
    .string()
    .describe('What went well, with the evidence for it. A short paragraph or a few bullets'),
  developmentAreas: z
    .string()
    .describe('What to work on next, each with a concrete, doable step. Kind and direct'),
  overallComment: z
    .string()
    .describe('Two to four sentences summing up the period, consistent with the ratings given'),
  checks: z
    .array(z.string())
    .describe(
      'Up to three things the writer should check before using the draft: thin evidence, a rating ' +
        'the evidence does not seem to support, a goal not mentioned. Empty if none',
    ),
});

export type ReviewDraft = z.infer<typeof ReviewDraftSchema>;

const Text = z.string().max(4000).nullish();

export const ReviewDraftRequestSchema = z.object({
  /** Whose words these will be: the manager's about a report, or the employee's own. */
  perspective: z.enum(['manager', 'self']),
  scale: z
    .array(
      z.object({
        value: z.number(),
        label: z.string().max(100),
        description: z.string().max(500).nullish(),
      }),
    )
    .max(10)
    .default([]),
  goals: z
    .array(
      z.object({
        title: z.string().max(300),
        description: z.string().max(2000).nullish(),
        measure: z.string().max(500).nullish(),
        weight: z.number().min(0).max(1),
        progress: z.number().min(0).max(100),
        status: z.string().max(30),
        rating: z.number().nullish(),
        comment: Text,
      }),
    )
    .max(30)
    .default([]),
  competencies: z
    .array(
      z.object({
        name: z.string().max(200),
        description: z.string().max(1000).nullish(),
        rating: z.number().nullish(),
        comment: Text,
      }),
    )
    .max(30)
    .default([]),
  /** The employee's submitted self-review, for a manager's draft. */
  selfReview: z.object({ strengths: Text, developmentAreas: Text, overallComment: Text }).nullish(),
  /** Anonymous peer and upward feedback, already held back when too few gave it. */
  feedback: z
    .array(
      z.object({
        reviewType: z.enum(['peer', 'upward']),
        strengths: Text,
        developmentAreas: Text,
        overallComment: Text,
      }),
    )
    .max(50)
    .default([]),
  notes: z.string().max(3000).nullish(),
});

export type ReviewDraftRequest = z.infer<typeof ReviewDraftRequestSchema>;
