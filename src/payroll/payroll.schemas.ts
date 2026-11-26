import { z } from 'zod';

/** What the model must return. */
export const ReviewBriefSchema = z.object({
  summary: z
    .string()
    .describe(
      'Three or four sentences for the person approving the run: how it compares with last time, ' +
        'and what most needs their attention. Figures only as given',
    ),
  priorities: z
    .array(
      z.object({
        findings: z.array(z.string()).describe('Ids of the findings this is about, e.g. "F3"'),
        action: z
          .string()
          .describe('One sentence: what the reviewer should check or confirm before approving'),
      }),
    )
    .describe('Up to five things to check, most important first. Empty if nothing needs checking'),
});

export type ReviewBrief = z.infer<typeof ReviewBriefSchema>;

/* ── Requests from the backend ─────────────────────────────────────────── */

const Amount = z.string().max(40).nullish();

export const ReviewBriefRequestSchema = z.object({
  run: z.object({
    period: z.string().min(1).max(100),
    runType: z.string().max(40),
    currency: z.string().length(3),
    headcount: z.number().int().min(0),
    previousHeadcount: z.number().int().min(0).nullish(),
    /** Formatted by the backend, e.g. "NGN 41,200,000.00": quoted, never recomputed. */
    gross: Amount,
    net: Amount,
    previousGross: Amount,
    previousNet: Amount,
  }),
  findings: z
    .array(
      z.object({
        id: z.string().regex(/^F\d{1,4}$/),
        code: z.string().max(40),
        severity: z.enum(['high', 'medium', 'info']),
        /** An employee NUMBER, never a name: the model needs to tell people apart, not know them. */
        employee: z.string().max(40).nullish(),
        message: z.string().max(500),
        amount: Amount,
        previousAmount: Amount,
      }),
    )
    .max(300),
});

export type ReviewBriefRequest = z.infer<typeof ReviewBriefRequestSchema>;

export interface ReviewBriefResponse {
  result: ReviewBrief;
  usage: { model: string; promptTokens: number; completionTokens: number; totalTokens: number };
}
