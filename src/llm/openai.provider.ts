import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, type AIMessage } from '@langchain/core/messages';
import type { z } from 'zod';
import type { LlmProvider, StructuredRequest, StructuredResult } from './llm.types';
import {
  LlmInvalidOutputException,
  LlmTimeoutException,
  LlmUnavailableException,
} from './llm.errors';

/**
 * OpenAI through LangChain, with structured output.
 *
 * `withStructuredOutput` rather than "return only JSON" and a regex: the
 * model is constrained to the schema, and the answer is parsed and checked
 * by zod before anyone sees it. `includeRaw` keeps the message alongside the
 * parsed value, which is where the token counts are.
 */
export class OpenAiProvider implements LlmProvider {
  private readonly chat: ChatOpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    options: { timeoutMs: number; maxRetries: number },
  ) {
    this.chat = new ChatOpenAI({
      apiKey,
      model,
      temperature: 0,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
  }

  async structured<S extends z.ZodTypeAny>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>> {
    const runnable = this.chat.withStructuredOutput(request.schema, {
      name: request.name,
      includeRaw: true,
    });

    let result: { raw: AIMessage; parsed: unknown };
    try {
      result = (await runnable.invoke(
        request.messages.map((m) =>
          m.role === 'system' ? new SystemMessage(m.content) : new HumanMessage(m.content),
        ),
      )) as { raw: AIMessage; parsed: unknown };
    } catch (error) {
      throw translate(error, request.name);
    }

    const parsed = request.schema.safeParse(result.parsed);
    if (!parsed.success) throw new LlmInvalidOutputException(request.name);

    const usage = result.raw?.usage_metadata;
    return {
      data: parsed.data,
      usage: {
        model: this.model,
        promptTokens: usage?.input_tokens ?? 0,
        completionTokens: usage?.output_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
    };
  }
}

function translate(error: unknown, name: string): Error {
  const e = error as { name?: string; message?: string; status?: number; code?: string };
  if (
    e?.name === 'TimeoutError' ||
    e?.code === 'ETIMEDOUT' ||
    /timed? ?out/i.test(e?.message ?? '')
  ) {
    return new LlmTimeoutException();
  }
  if (e?.name === 'OutputParserException' || e?.name === 'ZodError') {
    return new LlmInvalidOutputException(name);
  }
  // Rate limits, outages, a revoked key: all "not now" from the caller's side,
  // and all worth an operator's attention in the logs.
  return new LlmUnavailableException(`OpenAI: ${e?.message ?? 'request failed'}`);
}
