import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { fakeFrame } from './fake.engine';
import { FaceBusyException, FaceDisabledException } from './face.errors';
import { FaceService } from './face.service';
import { cosine } from './geometry';

const serviceWith = async (face: Partial<AppConfig['face']>) => {
  const settings: AppConfig['face'] = {
    provider: 'fake',
    modelDir: '',
    threads: 1,
    maxConcurrency: 2,
    ...face,
  };
  const config = { get: () => settings } as unknown as ConfigService<AppConfig, true>;
  const service = new FaceService(config);
  await service.onModuleInit();
  return service;
};

describe('FaceService', () => {
  it('answers 503 when the engine is off', async () => {
    const service = await serviceWith({ provider: 'off' });
    expect(service.status).toMatchObject({ provider: 'off', model: null });
    await expect(service.analyse([fakeFrame({})])).rejects.toBeInstanceOf(FaceDisabledException);
  });

  it('analyses frames in the order sent', async () => {
    const service = await serviceWith({});
    const { model, frames } = await service.analyse([
      fakeFrame({ person: 'ada' }),
      fakeFrame({ faces: 0 }),
      fakeFrame({ person: 'ada', yaw: 0.4, faces: 2 }),
    ]);

    expect(model).toBe('fake');
    expect(frames.map((f) => [f.index, f.faceCount])).toEqual([
      [0, 1],
      [1, 0],
      [2, 2],
    ]);
    expect(frames[1].face).toBeNull();
    expect(frames[2].face?.yaw).toBe(0.4);
    expect(frames[0].face?.embedding).toHaveLength(128);
  });

  it('refuses past its capacity rather than queueing, and recovers', async () => {
    const service = await serviceWith({ maxConcurrency: 1 });
    const first = service.analyse([fakeFrame({ person: 'ada' })]);
    await expect(service.analyse([fakeFrame({ person: 'ada' })])).rejects.toBeInstanceOf(
      FaceBusyException,
    );
    await first;
    expect(service.status.inFlight).toBe(0);
    await expect(service.analyse([fakeFrame({ person: 'ada' })])).resolves.toBeDefined();
  });

  it('frees its slot when a frame cannot be read', async () => {
    const service = await serviceWith({ maxConcurrency: 1 });
    await expect(service.analyse([Buffer.alloc(0)])).rejects.toMatchObject({ status: 400 });
    expect(service.status.inFlight).toBe(0);
  });

  describe('the fake engine', () => {
    const embeddingOf = async (service: FaceService, frame: Buffer) =>
      (await service.analyse([frame])).frames[0].face!.embedding;

    it('gives one person one embedding, and strangers unrelated ones', async () => {
      const service = await serviceWith({});
      const ada = await embeddingOf(service, fakeFrame({ person: 'ada' }));
      const adaAgain = await embeddingOf(service, fakeFrame({ person: 'ada', yaw: 0.3 }));
      const tunde = await embeddingOf(service, fakeFrame({ person: 'tunde' }));

      expect(cosine(ada, adaAgain)).toBeCloseTo(1, 6);
      expect(Math.abs(cosine(ada, tunde))).toBeLessThan(0.3);
    });

    it('lets a test stage a weaker match with drift', async () => {
      const service = await serviceWith({});
      const ada = await embeddingOf(service, fakeFrame({ person: 'ada' }));
      const drifted = await embeddingOf(service, fakeFrame({ person: 'ada', drift: 0.5 }));
      const similarity = cosine(ada, drifted);
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(0.9);
    });

    it('treats unmarked bytes as a face of their own', async () => {
      const service = await serviceWith({});
      const photo = Buffer.from('not really a jpeg');
      const same = cosine(await embeddingOf(service, photo), await embeddingOf(service, photo));
      const other = cosine(
        await embeddingOf(service, photo),
        await embeddingOf(service, Buffer.from('another file')),
      );
      expect(same).toBeCloseTo(1, 6);
      expect(Math.abs(other)).toBeLessThan(0.3);
    });
  });
});
