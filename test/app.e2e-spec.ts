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
        face: { provider: 'fake', model: 'fake', inFlight: 0 },
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
