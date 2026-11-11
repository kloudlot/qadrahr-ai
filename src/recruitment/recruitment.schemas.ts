import { z } from 'zod';

/*
 * What the model must return. Every field is required and "absent" is an
 * explicit null — OpenAI's strict structured output needs that, and it means
 * a caller never has to tell "not found" from "forgot to answer".
 */

export const ScreeningRecommendation = z.enum(['interview', 'review', 'reject']);

export const ScreeningResultSchema = z.object({
  extracted: z
    .object({
      phone: z.string().nullable().describe('Phone number written in the CV, or null'),
      location: z.string().nullable().describe('City or location written in the CV, or null'),
      education: z
        .string()
        .nullable()
        .describe('One-sentence summary of the highest or most relevant education, or null'),
      experience: z
        .string()
        .nullable()
        .describe('One-sentence summary of relevant work experience, or null'),
      yearsOfExperience: z
        .number()
        .nullable()
        .describe('Total years of professional experience if it can be worked out, or null'),
      skills: z
        .array(z.string())
        .describe('Skills named in the CV, each a short label. Empty if none'),
    })
    .describe('Facts taken from the CV. Never guessed.'),
  evaluation: z.object({
    score: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe('How well the candidate fits the posting, 0-100'),
    recommendation: ScreeningRecommendation.describe(
      'interview: score above 75, strong fit. review: 50-75, partly meets it. reject: below 50, key requirements missing',
    ),
    summary: z.string().describe('Two or three sentences a recruiter can read in ten seconds'),
    strengths: z.array(z.string()).describe('Requirements the CV shows the candidate meets'),
    gaps: z.array(z.string()).describe('Requirements the CV does not show'),
    riskFlags: z
      .array(z.string())
      .describe(
        'Things a recruiter should check: unexplained gaps, inconsistent dates. Never age, gender, ethnicity, religion or other protected traits',
      ),
  }),
});

export type ScreeningResult = z.infer<typeof ScreeningResultSchema>;

export const MatchScoreSchema = z.object({
  matchScore: z.number().int().min(0).max(100),
  recommendation: z.enum(['Strong fit', 'Moderate fit', 'Weak fit']),
  hireDecision: z.enum(['Interview', 'Keep warm', 'Reject']),
  reasoning: z.object({
    strengths: z.array(z.string()),
    gaps: z.array(z.string()),
    riskFlags: z.array(z.string()),
  }),
});

export type MatchScore = z.infer<typeof MatchScoreSchema>;

/* ── Requests from the backend ─────────────────────────────────────────── */

export const PostingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20000).default(''),
  requirements: z.string().max(20000).nullish(),
  location: z.string().max(200).nullish(),
  workMode: z.string().max(50).nullish(),
  department: z.string().max(200).nullish(),
  designation: z.string().max(200).nullish(),
});

export type Posting = z.infer<typeof PostingSchema>;

export const ScreenRequestSchema = z.object({
  posting: PostingSchema,
  /** Used when there is no CV file — a cover letter, or text the backend already has. */
  cvText: z.string().max(200000).nullish(),
});

export const MatchRequestSchema = z.object({
  role: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(20000).default(''),
    skillsRequired: z.array(z.string().max(100)).max(100).default([]),
    location: z.string().max(200).nullish(),
    yearsOfExperience: z.number().min(0).max(60).nullish(),
  }),
  candidate: z.object({
    headline: z.string().max(500).nullish(),
    skills: z.array(z.string().max(100)).max(200).default([]),
    experience: z.string().max(20000).nullish(),
    education: z.string().max(5000).nullish(),
    location: z.string().max(200).nullish(),
  }),
});
