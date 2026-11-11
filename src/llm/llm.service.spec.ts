import { z } from 'zod';
import { LlmService } from './llm.service';
import { FAKE_RESPONDERS } from './fake.responders';

describe('LlmService', () => {
  const service = (maxConcurrency: number) =>
    new LlmService({
      get: () => ({
        provider: 'fake',
        model: 'fake',
        timeoutMs: 1000,
        maxRetries: 0,
        maxConcurrency,
      }),
    } as never);

  afterEach(() => {
    delete FAKE_RESPONDERS.slow;
    delete FAKE_RESPONDERS.bad;
  });

  it('returns validated data and token usage', async () => {
    FAKE_RESPONDERS.bad = () => ({ n: 1 });
    const out = await service(2).structured({
      name: 'bad',
      schema: z.object({ n: z.number() }),
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out.data).toEqual({ n: 1 });
    expect(out.usage).toMatchObject({ model: 'fake', totalTokens: expect.any(Number) });
  });

  it('refuses an answer that does not match the schema', async () => {
    FAKE_RESPONDERS.bad = () => ({ n: 'one' });
    await expect(
      service(2).structured({ name: 'bad', schema: z.object({ n: z.number() }), messages: [] }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it('turns work away at capacity instead of queueing it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    FAKE_RESPONDERS.slow = () => ({ ok: true });

    const llm = service(1);
    // Hold the only slot open until released.
    const provider = (
      llm as unknown as { provider: { structured: (...a: unknown[]) => Promise<unknown> } }
    ).provider;
    const real = provider.structured.bind(provider);
    provider.structured = async (...args) => {
      await gate;
      return real(...args);
    };

    const schema = z.object({ ok: z.boolean() });
    const first = llm.structured({ name: 'slow', schema, messages: [] });
    await expect(llm.structured({ name: 'slow', schema, messages: [] })).rejects.toMatchObject({
      status: 503,
    });

    release();
    await expect(first).resolves.toMatchObject({ data: { ok: true } });
    expect(llm.load.inFlight).toBe(0);
  });
});
