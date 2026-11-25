/**
 * Policy text cut into passages, and the passages most like a question.
 *
 * No embeddings and no vector store. An organisation's policies are
 * usually small enough to show the model whole, and then nothing is
 * chosen at all. Past the budget, passages are ranked by the question's
 * words (BM25), with a short list of HR synonyms so "time off" finds the
 * leave policy. Good enough to start with; the model is told to say when
 * what it was shown doesn't answer the question, and it can't cite what it
 * wasn't shown.
 */

export interface PolicySource {
  ref: string;
  title: string;
  version?: number | null;
  summary?: string | null;
  text: string;
}

export interface Passage {
  /** `P<policy>-<n>`, both from 1: what the model cites. */
  id: string;
  ref: string;
  title: string;
  version: number | null;
  /** Position in the policy, so chosen passages read in order. */
  policyIndex: number;
  order: number;
  text: string;
}

/** About a page's paragraph or two: small enough to rank, big enough to read alone. */
const PASSAGE_CHARS = 1200;

export function toPassages(policies: PolicySource[]): Passage[] {
  const passages: Passage[] = [];
  policies.forEach((policy, policyIndex) => {
    const body = [policy.summary?.trim() && `Summary: ${policy.summary.trim()}`, policy.text]
      .filter(Boolean)
      .join('\n\n');
    chunk(body).forEach((text, order) =>
      passages.push({
        id: `P${policyIndex + 1}-${order + 1}`,
        ref: policy.ref,
        title: policy.title,
        version: policy.version ?? null,
        policyIndex,
        order,
        text,
      }),
    );
  });
  return passages;
}

/** Paragraphs packed into passages; a paragraph longer than one is cut at sentences. */
function chunk(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .flatMap((p) => (p.length > PASSAGE_CHARS ? sentences(p) : [p]));

  const out: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > PASSAGE_CHARS) {
      out.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  if (current) out.push(current);
  return out;
}

function sentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const out: string[] = [];
  let current = '';
  for (const part of parts) {
    // A "sentence" longer than a passage (a table flattened to one line) is cut hard.
    for (let i = 0; i < part.length; i += PASSAGE_CHARS) {
      const piece = part.slice(i, i + PASSAGE_CHARS);
      if (current && current.length + piece.length > PASSAGE_CHARS) {
        out.push(current.trim());
        current = '';
      }
      current += piece;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export interface Selection {
  passages: Passage[];
  /** True when every passage went in: nothing was left out by ranking. */
  complete: boolean;
}

/**
 * Everything, when it fits the budget. Otherwise the best-matching
 * passages up to it, back in document order.
 */
export function selectPassages(
  passages: Passage[],
  question: string,
  budgetChars: number,
): Selection {
  const total = passages.reduce((sum, p) => sum + p.text.length, 0);
  if (total <= budgetChars) return { passages, complete: true };

  const scores = bm25(passages, expand(terms(question)));
  const ranked = passages
    .map((passage, i) => ({ passage, score: scores[i] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen: Passage[] = [];
  let used = 0;
  for (const { passage } of ranked) {
    if (used + passage.text.length > budgetChars) continue;
    chosen.push(passage);
    used += passage.text.length;
  }

  chosen.sort((a, b) => a.policyIndex - b.policyIndex || a.order - b.order);
  return { passages: chosen, complete: false };
}

const STOPWORDS = new Set(
  (
    'the and for are but not you your yours our can could would should will shall what when where ' +
    'which who whom whose why how does did doing have has had was were been being this that these ' +
    'those there their them they from with into about after before than then also just only very ' +
    'any all each other some such may might must per its it’s i’m im ive dont cant am is be to of in ' +
    'on at by or an as if so do my me we us a get got want need'
  ).split(/\s+/),
);

/** Lower-cased words of three letters or more, without stopwords, roughly stemmed. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);
}

function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Words people use for the same HR idea. Each group finds the others. */
const SYNONYMS: string[][] = [
  ['leave', 'holiday', 'vacation', 'annual', 'time off', 'pto', 'absence'],
  ['sick', 'illness', 'medical', 'unwell', 'doctor', 'hospital'],
  ['maternity', 'paternity', 'parental', 'pregnancy', 'pregnant', 'baby', 'adoption'],
  ['pay', 'salary', 'wage', 'compensation', 'remuneration', 'payroll', 'payslip'],
  ['remote', 'home', 'hybrid', 'wfh', 'telework', 'flexible'],
  ['expense', 'reimbursement', 'claim', 'receipt', 'allowance', 'per diem'],
  ['harassment', 'bullying', 'misconduct', 'discrimination', 'grievance', 'complaint'],
  ['resign', 'resignation', 'notice', 'quit', 'exit', 'termination'],
  ['overtime', 'hours', 'shift', 'working time', 'weekend'],
  ['probation', 'confirmation', 'trial'],
  ['dress', 'attire', 'uniform', 'clothing'],
  ['travel', 'trip', 'flight', 'hotel', 'accommodation'],
  ['training', 'learning', 'course', 'certification', 'development'],
  ['loan', 'advance', 'borrow'],
  ['disciplinary', 'warning', 'sanction', 'suspension', 'query'],
];

const SYNONYM_INDEX = new Map<string, string[]>();
for (const group of SYNONYMS) {
  const stems = group.flatMap((phrase) => terms(phrase));
  for (const s of stems)
    SYNONYM_INDEX.set(s, [...new Set([...(SYNONYM_INDEX.get(s) ?? []), ...stems])]);
}

function expand(queryTerms: string[]): Map<string, number> {
  // The question's own words count fully; a synonym counts half.
  const weights = new Map<string, number>();
  for (const term of queryTerms) {
    weights.set(term, 1);
    for (const synonym of SYNONYM_INDEX.get(term) ?? []) {
      if (!weights.has(synonym)) weights.set(synonym, 0.5);
    }
  }
  return weights;
}

function bm25(passages: Passage[], query: Map<string, number>): number[] {
  const k1 = 1.2;
  const b = 0.75;
  // A passage is found by its policy's title too.
  const docs = passages.map((p) => terms(`${p.title} ${p.text}`));
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(docs.length, 1);

  const df = new Map<string, number>();
  for (const doc of docs) for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);

  return docs.map((doc) => {
    const tf = new Map<string, number>();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const [term, weight] of query) {
      const f = tf.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += weight * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / avg)));
    }
    return score;
  });
}
