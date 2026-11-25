/**
 * Canned answers for the fake provider, by output name.
 *
 * Deterministic but not constant: the score follows how many of the
 * posting's requirement words appear in the candidate text, so a test can
 * produce a strong or a weak candidate by what it writes in the CV.
 */

import { terms } from '../assistant/passages';

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
  /**
   * Cites the passages sharing a word with the question. A question with
   * "cite nothing real" in it cites a passage that was never shown, so a
   * test can see the service refuse an answer without a real citation.
   */
  policy_answer: (input) => {
    const question = between(input, '<<<EMPLOYEE_QUESTION>>>', '<<<END_EMPLOYEE_QUESTION>>>');
    if (/cite nothing real/i.test(question)) {
      return { answered: true, answer: 'Made up.', passages: ['P99-1'], confidence: 'high' };
    }
    const body = between(input, '<<<POLICY_PASSAGES>>>', '<<<END_POLICY_PASSAGES>>>');
    const asked = new Set(terms(question));
    // Two terms in common, so one shared everyday word doesn't count as an answer.
    const cited = [...body.matchAll(/\[(P\d+-\d+)\][^\n]*\n([^[]*)/g)]
      .filter(
        ([, , text]) =>
          new Set(terms(text)).size && terms(text).filter((t) => asked.has(t)).length >= 2,
      )
      .map(([, id]) => id);
    return cited.length
      ? {
          answered: true,
          answer: `Fake answer from ${cited.length} passage(s).`,
          passages: cited,
          confidence: 'high',
        }
      : {
          answered: false,
          answer: "The policies shown don't cover this. Please ask HR.",
          passages: [],
          confidence: 'low',
        };
  },
  /**
   * One priority per high finding, in order. "cite F999" in a finding's
   * message makes it also cite an id that doesn't exist, so a test can see
   * the service drop it.
   */
  payroll_review_brief: (input) => {
    const high = [...input.matchAll(/\[(F\d+)\] HIGH ([a-z_]+)/g)];
    const bogus = /cite F999/.test(input);
    return {
      summary: `Fake brief: ${high.length} high finding(s).`,
      priorities: [
        ...high.map(([, id, code]) => ({ findings: [id], action: `Check ${code} on ${id}.` })),
        ...(bogus ? [{ findings: ['F999'], action: 'Invented.' }] : []),
      ],
    };
  },
  job_description: (input) => {
    const title = input.match(/title: (.*)/)?.[1] ?? 'Role';
    return {
      title,
      summary: `Fake advert for ${title}.`,
      responsibilities: ['Do the work', 'Work with the team'],
      requirements: ['Relevant experience, or equivalent'],
      niceToHave: [],
    };
  },
  /** One question per requirement line, plus one off-limits question the service must drop. */
  interview_kit: (input) => {
    const requirements = between(input, 'Requirements:', '\u0000')
      .split('\n')
      .map((l) => l.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean);
    return {
      questions: [
        ...requirements.map((r) => ({
          question: `Tell me about a time you used ${r}.`,
          category: 'behavioural',
          assesses: r,
          lookFor: [`A concrete example of ${r}`],
        })),
        {
          question: 'Are you married, and do you plan to have children?',
          category: 'motivation',
          assesses: 'nothing lawful',
          lookFor: [],
        },
      ],
      criteria: [{ name: 'Fit to requirements', description: 'Meets the posting' }],
    };
  },
  candidate_probes: (input) => {
    const gaps = between(input, 'Gaps:\n', 'Flags to check:')
      .split('\n')
      .map((l) => l.replace(/^- /, '').trim())
      .filter((l) => l && l !== '(none)');
    return {
      probes: [
        ...gaps.map((g) => ({
          question: `Your CV doesn't mention ${g}. Where have you come close to it?`,
          explores: g,
          lookFor: ['A related example'],
        })),
        { question: 'How old are you?', explores: 'nothing lawful', lookFor: [] },
      ],
    };
  },
  /** Says what it was shown, so a test can see what reached it. */
  review_draft: (input) => {
    const goals = (input.match(/^G\d+\. /gm) ?? []).length;
    const feedback = (input.match(/^\((peer|upward)\)$/gm) ?? []).length;
    const self =
      /^Write as the employee/m.test(input) || input.includes('write their own self-review');
    return {
      strengths: `Fake strengths from ${goals} goal(s).`,
      developmentAreas: 'Fake development areas. [add an example]',
      overallComment: `Fake ${self ? 'self' : 'manager'} summary; ${feedback} feedback item(s).`,
      checks: goals ? [] : ['There are no goals to draw on.'],
    };
  },
};
