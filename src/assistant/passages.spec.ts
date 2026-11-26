import { selectPassages, terms, toPassages } from './passages';

const LEAVE = [
  'Annual leave. Every full-time employee earns 20 working days of annual leave a year.',
  'Unused leave of up to 5 days may be carried into the first quarter of the next year.',
].join('\n\n');

const EXPENSES = [
  'Expense claims must be filed within 30 days with a receipt attached.',
  'Travel by air needs the line manager’s approval before booking.',
].join('\n\n');

describe('toPassages', () => {
  it('numbers passages by policy and order, summary first', () => {
    const passages = toPassages([
      { ref: 'a', title: 'Leave', version: 2, summary: 'How leave works', text: LEAVE },
      { ref: 'b', title: 'Expenses', text: EXPENSES },
    ]);
    expect(passages.map((p) => p.id)).toEqual(['P1-1', 'P2-1']);
    expect(passages[0]).toMatchObject({ ref: 'a', title: 'Leave', version: 2 });
    expect(passages[0].text.startsWith('Summary: How leave works')).toBe(true);
    expect(passages[1].version).toBeNull();
  });

  it('cuts a long policy into passages of about a page, at sentences', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Rule ${i} says something specific.`).join(
      ' ',
    );
    const passages = toPassages([{ ref: 'x', title: 'Handbook', text: long }]);
    expect(passages.length).toBeGreaterThan(1);
    for (const p of passages) {
      expect(p.text.length).toBeLessThanOrEqual(1200);
      expect(p.text).toMatch(/\.$/);
    }
  });
});

describe('selectPassages', () => {
  const policies = [
    { ref: 'a', title: 'Leave policy', text: LEAVE },
    { ref: 'b', title: 'Expenses policy', text: EXPENSES },
  ];

  it('sends everything when it fits', () => {
    const all = toPassages(policies);
    expect(selectPassages(all, 'anything', 100_000)).toEqual({ passages: all, complete: true });
  });

  it('over budget, picks what matches the question — synonyms included', () => {
    // Filler after each policy, so the policies no longer fit whole.
    const all = toPassages([
      { ref: 'a', title: 'Leave policy', text: `${LEAVE}\n\n${'x '.repeat(700)}` },
      { ref: 'b', title: 'Expenses policy', text: `${EXPENSES}\n\n${'y '.repeat(700)}` },
    ]);
    // "time off" is how people say leave.
    const picked = selectPassages(all, 'How much time off do I get?', 1500);
    expect(picked.complete).toBe(false);
    expect(new Set(picked.passages.map((p) => p.ref))).toEqual(new Set(['a']));
    expect(picked.passages[0].text).toContain('20 working days');

    const receipts = selectPassages(all, 'Do I need a receipt for my claim?', 1500);
    expect(new Set(receipts.passages.map((p) => p.ref))).toEqual(new Set(['b']));
    expect(receipts.passages[0].text).toContain('within 30 days');
  });

  it('chooses nothing when nothing matches', () => {
    const all = toPassages(policies).map((p) => ({ ...p, text: p.text + ' z'.repeat(400) }));
    expect(selectPassages(all, 'quantum chromodynamics', 200).passages).toEqual([]);
  });
});

describe('terms', () => {
  it('drops stopwords and folds simple endings', () => {
    expect(terms('What are the rules for carrying leaves?')).toEqual(['rule', 'carry', 'leave']);
  });
});
