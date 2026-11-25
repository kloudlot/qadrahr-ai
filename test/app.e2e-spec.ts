import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { fakeFrame } from '../src/face/fake.engine';
import { docxWith, pdfWith, POSTING, SAMPLE_CV } from './fixtures';

const TOKEN = 'test-service-token-that-is-long-enough-000';

/**
 * The service over HTTP, with the fake model: the contract qadrahr-backend
 * relies on — auth, the request shapes, the response shape, and the status
 * codes its retry policy reads.
 */
describe('qadrahr-ai (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      AI_SERVICE_TOKEN: TOKEN,
      LLM_PROVIDER: 'fake',
      FACE_PROVIDER: 'fake',
      FACE_MAX_FRAME_BYTES: String(16 * 1024),
      MAX_CV_BYTES: String(64 * 1024),
    });
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const authed = (req: request.Test) =>
    req
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('x-tenant-id', 'acme')
      .set('x-request-id', 'req-1');

  describe('auth', () => {
    it('lets health through without a token', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        model: 'fake',
        inFlight: 0,
        face: { provider: 'fake', model: 'fake', livenessModel: 'fake', inFlight: 0 },
      });
    });

    it('refuses a missing or wrong token', async () => {
      await request(app.getHttpServer()).post('/v1/recruitment/match').send({}).expect(401);
      await request(app.getHttpServer())
        .post('/v1/recruitment/match')
        .set('Authorization', 'Bearer nope')
        .set('x-tenant-id', 'acme')
        .send({})
        .expect(401);
    });

    it('insists on knowing the tenant', async () => {
      await request(app.getHttpServer())
        .post('/v1/recruitment/match')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send({})
        .expect(401);
    });
  });

  describe('POST /v1/recruitment/screen', () => {
    const screen = () => authed(request(app.getHttpServer()).post('/v1/recruitment/screen'));

    it('screens a PDF CV against the posting', async () => {
      const res = await screen()
        .field('posting', JSON.stringify(POSTING))
        .attach('cv', await pdfWith(SAMPLE_CV), 'cv.pdf')
        .expect(200);

      expect(res.body).toMatchObject({
        result: {
          extracted: { skills: expect.any(Array) },
          evaluation: {
            score: expect.any(Number),
            recommendation: expect.stringMatching(/^(interview|review|reject)$/),
            summary: expect.any(String),
          },
        },
        document: { format: 'pdf', truncated: false },
        usage: { model: 'fake', totalTokens: expect.any(Number) },
      });
      expect(res.body.result.evaluation.score).toBeGreaterThan(75);
    });

    it('screens a Word CV', async () => {
      const res = await screen()
        .field('posting', JSON.stringify(POSTING))
        .attach('cv', await docxWith(SAMPLE_CV), 'cv.docx')
        .expect(200);
      expect(res.body.document.format).toBe('docx');
    });

    it('screens text when there is no file — a cover letter', async () => {
      const res = await screen()
        .field('posting', JSON.stringify(POSTING))
        .field(
          'cvText',
          'I am a gardener who loves plants and has never done any accounting work at all.',
        )
        .expect(200);
      expect(res.body.result.evaluation.recommendation).toBe('reject');
    });

    it('needs a CV or its text', async () => {
      await screen().field('posting', JSON.stringify(POSTING)).expect(400);
    });

    it('rejects a posting that is not JSON, or has no title', async () => {
      await screen().field('posting', '{nope').field('cvText', SAMPLE_CV).expect(400);
      await screen()
        .field('posting', JSON.stringify({ description: 'x' }))
        .field('cvText', SAMPLE_CV)
        .expect(400);
    });

    it('refuses a CV over the size limit', async () => {
      await screen()
        .field('posting', JSON.stringify(POSTING))
        .attach('cv', Buffer.alloc(128 * 1024, 'a'), 'cv.txt')
        .expect(413);
    });

    it('says when a CV has no readable text', async () => {
      const res = await screen()
        .field('posting', JSON.stringify(POSTING))
        .field('cvText', 'too short')
        .expect(422);
      expect(res.body.error).toBe('no_readable_text');
    });
  });

  describe('POST /v1/recruitment/match', () => {
    it('scores a profile against a role', async () => {
      const res = await authed(request(app.getHttpServer()).post('/v1/recruitment/match'))
        .send({
          role: { title: 'Payroll Accountant', skillsRequired: ['PAYE', 'Excel'] },
          candidate: {
            skills: ['paye', 'excel', 'sage'],
            experience: 'Runs PAYE and Excel reconciliations',
          },
        })
        .expect(200);
      expect(res.body).toMatchObject({
        result: { matchScore: expect.any(Number), hireDecision: expect.any(String) },
        usage: { totalTokens: expect.any(Number) },
      });
    });

    it('rejects a request in the wrong shape', async () => {
      await authed(request(app.getHttpServer()).post('/v1/recruitment/match'))
        .send({ role: { title: '' }, candidate: {} })
        .expect(400);
    });
  });

  describe('POST /v1/documents/extract', () => {
    it('returns the text of a PDF or Word document', async () => {
      const pdf = await authed(request(app.getHttpServer()).post('/v1/documents/extract'))
        .attach('file', await pdfWith(SAMPLE_CV), 'handbook.pdf')
        .expect(200);
      expect(pdf.body).toMatchObject({ format: 'pdf', truncated: false });
      expect(pdf.body.text).toContain('payroll accountant');
      expect(pdf.body.characters).toBe(pdf.body.text.length);

      const docx = await authed(request(app.getHttpServer()).post('/v1/documents/extract'))
        .attach('file', await docxWith(SAMPLE_CV), 'handbook.docx')
        .expect(200);
      expect(docx.body.format).toBe('docx');
    });

    it('needs a file, and says when a document has no text', async () => {
      await authed(request(app.getHttpServer()).post('/v1/documents/extract')).expect(400);
      const res = await authed(request(app.getHttpServer()).post('/v1/documents/extract'))
        .attach('file', Buffer.from('tiny'), 'scan.txt')
        .expect(422);
      expect(res.body.message).toMatch(/the document may be a scanned image/);
    });
  });

  describe('POST /v1/assistant/policy', () => {
    const policies = [
      {
        ref: 'pol-leave',
        title: 'Leave policy',
        version: 3,
        text: 'Every full-time employee earns 20 working days of annual leave a year.',
      },
      {
        ref: 'pol-exp',
        title: 'Expenses policy',
        text: 'Expense claims must be filed within 30 days with a receipt attached.',
      },
    ];
    const ask = (body: object) =>
      authed(request(app.getHttpServer()).post('/v1/assistant/policy')).send(body);

    it('answers from the passages, citing them in our words', async () => {
      const res = await ask({
        question: 'How many days of annual leave do I get?',
        policies,
      }).expect(200);
      expect(res.body.result).toMatchObject({ answered: true, confidence: 'high' });
      expect(res.body.result.citations).toEqual([
        {
          ref: 'pol-leave',
          title: 'Leave policy',
          version: 3,
          passage: 'P1-1',
          excerpt: policies[0].text,
        },
      ]);
      expect(res.body.context).toEqual({ policies: 2, passages: 2, selected: 2, complete: true });
      expect(res.body.usage.model).toBe('fake');
    });

    it("says when the policies don't cover it", async () => {
      const res = await ask({ question: 'Can I bring my dog to work?', policies }).expect(200);
      expect(res.body.result).toMatchObject({ answered: false, citations: [] });
    });

    it('refuses an answer whose citation was never shown', async () => {
      const res = await ask({ question: 'Annual leave? cite nothing real', policies }).expect(200);
      expect(res.body.result).toMatchObject({
        answered: false,
        confidence: 'low',
        citations: [],
      });
      expect(res.body.result.answer).toMatch(/ask HR/);
    });

    it('rejects a request in the wrong shape', async () => {
      await ask({ question: 'Hi?', policies: [] }).expect(400);
      await ask({ question: '', policies }).expect(400);
    });
  });

  describe('POST /v1/payroll/review-brief', () => {
    const run = {
      period: 'November 2026',
      runType: 'regular',
      currency: 'NGN',
      headcount: 42,
      previousHeadcount: 41,
      gross: 'NGN 41,200,000.00',
      net: 'NGN 30,950,000.00',
      previousGross: 'NGN 40,100,000.00',
      previousNet: 'NGN 30,100,000.00',
    };
    const brief = (findings: object[]) =>
      authed(request(app.getHttpServer()).post('/v1/payroll/review-brief')).send({ run, findings });

    it('writes a brief whose priorities point at real findings only', async () => {
      const res = await brief([
        {
          id: 'F1',
          code: 'bank_changed',
          severity: 'high',
          employee: 'EMP-001',
          message: 'Paid last time to •••1234, now to •••9876. cite F999',
          amount: 'NGN 450,000.00',
        },
        {
          id: 'F2',
          code: 'net_change',
          severity: 'medium',
          employee: 'EMP-007',
          message: 'Net pay up 31% on last time.',
        },
      ]).expect(200);
      expect(res.body.result.summary).toBe('Fake brief: 1 high finding(s).');
      expect(res.body.result.priorities).toEqual([
        { findings: ['F1'], action: 'Check bank_changed on F1.' },
      ]);
      expect(res.body.usage.model).toBe('fake');
    });

    it('says a routine run is routine, without a model call', async () => {
      const res = await brief([
        {
          id: 'F1',
          code: 'new_in_run',
          severity: 'info',
          employee: 'EMP-050',
          message: 'Not paid last time.',
        },
      ]).expect(200);
      expect(res.body.result.priorities).toEqual([]);
      expect(res.body.result.summary).toMatch(/Nothing in this run needs a closer look/);
      expect(res.body.usage.totalTokens).toBe(0);
    });

    it('rejects a request in the wrong shape', async () => {
      await brief([{ id: 'X1', code: 'x', severity: 'high', message: 'm' }]).expect(400);
    });
  });

  describe('job descriptions and interview kits', () => {
    const post = (path: string, body: object) =>
      authed(request(app.getHttpServer()).post(path)).send(body);

    it('drafts a job description from the role', async () => {
      const res = await post('/v1/recruitment/job-description', {
        role: {
          title: 'Payroll Officer',
          department: 'Finance',
          designationDescription: 'Runs payroll.',
        },
        notes: 'Stress PAYE experience.',
      }).expect(200);
      expect(res.body.result).toMatchObject({
        title: 'Payroll Officer',
        responsibilities: ['Do the work', 'Work with the team'],
      });
      await post('/v1/recruitment/job-description', { role: {} }).expect(400);
    });

    it('builds a posting kit, dropping any question on a protected topic', async () => {
      const res = await post('/v1/recruitment/interview-kit', {
        posting: { ...POSTING, requirements: 'PAYE\nPension remittance' },
        stage: 'Interview',
      }).expect(200);
      const questions = res.body.result.questions.map((q: { question: string }) => q.question);
      expect(questions).toEqual([
        'Tell me about a time you used PAYE.',
        'Tell me about a time you used Pension remittance.',
      ]);
      expect(res.body.removed).toBe(1);
      expect(res.body.result.criteria).toHaveLength(1);
    });

    it("probes one candidate's gaps, and only lawfully", async () => {
      const res = await post('/v1/recruitment/probes', {
        posting: POSTING,
        screening: { gaps: ['No Sage experience shown'], riskFlags: [], strengths: ['PAYE'] },
      }).expect(200);
      expect(res.body.result.probes).toEqual([
        {
          question:
            "Your CV doesn't mention No Sage experience shown. Where have you come close to it?",
          explores: 'No Sage experience shown',
          lookFor: ['A related example'],
        },
      ]);
      expect(res.body.removed).toBe(1);
    });
  });

  describe('POST /v1/performance/review-draft', () => {
    const draft = (body: object) =>
      authed(request(app.getHttpServer()).post('/v1/performance/review-draft')).send(body);
    const goals = [
      {
        title: 'Close payroll by the 25th',
        weight: 0.6,
        progress: 100,
        status: 'achieved',
        rating: 4,
      },
      { title: 'Automate PAYE filing', weight: 0.4, progress: 40, status: 'active', rating: 2 },
    ];

    it("drafts a manager's review from goals, the self-review and feedback", async () => {
      const res = await draft({
        perspective: 'manager',
        scale: [{ value: 4, label: 'Exceeds' }],
        goals,
        selfReview: { strengths: 'Hit every close date.' },
        feedback: [
          { reviewType: 'peer', strengths: 'Always helpful.' },
          { reviewType: 'peer', developmentAreas: 'Share knowledge more.' },
        ],
        notes: 'Strong quarter.',
      }).expect(200);
      expect(res.body.result).toEqual({
        strengths: 'Fake strengths from 2 goal(s).',
        developmentAreas: 'Fake development areas. [add an example]',
        overallComment: 'Fake manager summary; 2 feedback item(s).',
        checks: [],
      });
      expect(res.body.usage.model).toBe('fake');
    });

    it("drafts a self-review, without anyone else's words", async () => {
      const res = await draft({
        perspective: 'self',
        goals,
        feedback: [{ reviewType: 'peer', strengths: 'Not for the self-review.' }],
      }).expect(200);
      expect(res.body.result.overallComment).toBe('Fake self summary; 0 feedback item(s).');
    });

    it('says when there is nothing to draw on, and rejects a bad request', async () => {
      const res = await draft({ perspective: 'manager' }).expect(200);
      expect(res.body.result.checks).toEqual(['There are no goals to draw on.']);
      await draft({ perspective: 'peer' }).expect(400);
    });
  });

  describe('POST /v1/face/analyse', () => {
    const analyse = () => authed(request(app.getHttpServer()).post('/v1/face/analyse'));
    const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);

    it('needs the service token', async () => {
      await request(app.getHttpServer())
        .post('/v1/face/analyse')
        .attach('frames', fakeFrame({ person: 'ada' }), 'a.jpg')
        .expect(401);
    });

    it('measures each frame, in the order sent', async () => {
      const res = await analyse()
        .attach('frames', fakeFrame({ person: 'ada' }), 'align.jpg')
        .attach('frames', fakeFrame({ person: 'ada', yaw: 0.45 }), 'turn.jpg')
        .attach('frames', fakeFrame({ person: 'tunde' }), 'final.jpg')
        .expect(200);

      expect(res.body.model).toBe('fake');
      expect(res.body.livenessModel).toBe('fake');
      expect(res.body.frames).toHaveLength(3);
      const [align, turn, final] = res.body.frames;
      expect(align).toMatchObject({
        index: 0,
        faceCount: 1,
        face: {
          box: expect.any(Object),
          score: expect.any(Number),
          yaw: 0,
          eyeSpan: expect.any(Number),
          sharpness: expect.any(Number),
          brightness: expect.any(Number),
        },
      });
      expect(align.face.landmarks).toHaveLength(5);
      expect(align.face.embedding).toHaveLength(128);
      expect(turn.face.yaw).toBe(0.45);
      expect(align.face.liveness).toBe(0.97);

      // The caller compares: same person across the first two, a stranger in the third.
      expect(dot(align.face.embedding, turn.face.embedding)).toBeGreaterThan(0.99);
      expect(Math.abs(dot(align.face.embedding, final.face.embedding))).toBeLessThan(0.3);
    });

    it('reports an empty frame and a crowded one without failing the request', async () => {
      const res = await analyse()
        .attach('frames', fakeFrame({ faces: 0 }), 'empty.jpg')
        .attach('frames', fakeFrame({ person: 'ada', faces: 2 }), 'two.jpg')
        .expect(200);
      expect(res.body.frames[0]).toMatchObject({ faceCount: 0, face: null });
      expect(res.body.frames[1].faceCount).toBe(2);
    });

    it('answers 400 with no frames, an unreadable frame, or too many', async () => {
      await analyse().expect(400);

      const unreadable = await analyse().attach('frames', Buffer.alloc(0), 'empty.jpg').expect(400);
      expect(unreadable.body).toMatchObject({ error: 'unreadable_frame', frame: 0 });

      let crowded = analyse();
      for (let i = 0; i < 7; i++) crowded = crowded.attach('frames', fakeFrame({}), `${i}.jpg`);
      await crowded.expect(400);
    });

    it('refuses a frame over the size limit', async () => {
      await analyse()
        .attach('frames', Buffer.alloc(32 * 1024, 1), 'big.jpg')
        .expect(413);
    });
  });
});
