import type { z } from 'zod';
import type { LlmProvider, StructuredRequest, StructuredResult } from './llm.types';
import { LlmInvalidOutputException } from './llm.errors';

type Responder = (input: string) => unknown;

/**
 * A model that answers without a network call, for tests and for running
 * the service locally without an OpenAI key.
 *
 * Answers are built per output name from the prompt text, so a test can
 * steer the result through its input (a CV that names a required skill
 * scores higher). Every answer is still checked against the schema, like a
 * real one.
 */
export class FakeProvider implements LlmProvider {
  readonly model = 'fake';

  constructor(private readonly responders: Record<string, Responder>) {}

  async structured<S extends z.ZodTypeAny>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>> {
    const input = request.messages.map((m) => m.content).join('\n');
    const responder = this.responders[request.name];
    const parsed = request.schema.safeParse(responder ? responder(input) : undefined);
    if (!parsed.success) throw new LlmInvalidOutputException(request.name);

    const promptTokens = Math.ceil(input.length / 4);
    const completionTokens = Math.ceil(JSON.stringify(parsed.data).length / 4);
    return {
      data: parsed.data,
      usage: {
        model: this.model,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }
}
