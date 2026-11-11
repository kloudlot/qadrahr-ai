/**
 * Canned answers for the fake provider, by output name.
 *
 * Deterministic but not constant: the score follows how many of the
 * posting's requirement words appear in the candidate text, so a test can
 * produce a strong or a weak candidate by what it writes in the CV.
 */

const between = (text: string, start: string, end: string) => {
  const i = text.indexOf(start);
  if (i < 0) return '';
  const j = text.indexOf(end, i + start.length);
  return text.slice(i + start.length, j < 0 ? undefined : j);
};

const words = (text: string) => [
  ...new Set(text.toLowerCase().match(/[a-z][a-z0-9.+#]{3,}/g) ?? []),
];

function overlap(input: string): { score: number; hits: string[]; misses: string[] } {
  const requirements =
    between(input, 'Requirements:', 'CANDIDATE') || between(input, 'ROLE', 'CANDIDATE');
  const candidate = between(
    input,
    '<<<CANDIDATE_DOCUMENT>>>',
    '<<<END_CANDIDATE_DOCUMENT>>>',
  ).toLowerCase();
  const wanted = words(requirements).slice(0, 20);
  const hits = wanted.filter((w) => candidate.includes(w));
  const misses = wanted.filter((w) => !candidate.includes(w));
  const score = wanted.length ? Math.round((hits.length / wanted.length) * 100) : 50;
  return { score, hits, misses };
}

export const FAKE_RESPONDERS: Record<string, (input: string) => unknown> = {
  cv_screening: (input) => {
    const { score, hits, misses } = overlap(input);
    const cv = between(input, '<<<CANDIDATE_DOCUMENT>>>', '<<<END_CANDIDATE_DOCUMENT>>>');
    return {
      extracted: {
        phone: cv.match(/\+?\d[\d\s-]{7,}\d/)?.[0] ?? null,
        location: null,
        education: null,
        experience: null,
        yearsOfExperience: null,
        skills: hits,
      },
      evaluation: {
        score,
        recommendation: score > 75 ? 'interview' : score >= 50 ? 'review' : 'reject',
        summary: `Fake screening: ${hits.length} of ${hits.length + misses.length} requirement terms found.`,
        strengths: hits.map((h) => `Mentions ${h}`),
        gaps: misses.map((m) => `No mention of ${m}`),
        riskFlags: [],
      },
    };
  },
  match_score: (input) => {
    const { score, hits, misses } = overlap(input);
    return {
      matchScore: score,
      recommendation: score > 75 ? 'Strong fit' : score >= 50 ? 'Moderate fit' : 'Weak fit',
      hireDecision: score > 75 ? 'Interview' : score >= 50 ? 'Keep warm' : 'Reject',
      reasoning: { strengths: hits, gaps: misses, riskFlags: [] },
    };
  },
};
