import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { z } from 'zod';
import { AppConfig } from '../config/configuration';
import { FakeProvider } from './fake.provider';
import { FAKE_RESPONDERS } from './fake.responders';
import { LlmBusyException } from './llm.errors';
import type { LlmProvider, StructuredRequest, StructuredResult } from './llm.types';
import { OpenAiProvider } from './openai.provider';

/**
 * The one way features reach a model.
 *
 * Also the service's backpressure: past `AI_MAX_CONCURRENCY` calls in flight,
 * a new one is refused with 503 rather than queued. The backend's job queue
 * already retries with backoff; a second queue in here would only hide how
 * far behind the work is and hold memory while it waits.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly provider: LlmProvider;
  private readonly maxConcurrency: number;
  private inFlight = 0;

  constructor(config: ConfigService<AppConfig, true>) {
    const llm = config.get('llm', { infer: true });
    this.maxConcurrency = llm.maxConcurrency;
    this.provider =
      llm.provider === 'fake'
        ? new FakeProvider(FAKE_RESPONDERS)
        : new OpenAiProvider(llm.openaiApiKey as string, llm.model, {
            timeoutMs: llm.timeoutMs,
            maxRetries: llm.maxRetries,
          });
    this.logger.log(
      `Model: ${this.provider.model} (provider ${llm.provider}), up to ${this.maxConcurrency} at once`,
    );
  }

  get model(): string {
    return this.provider.model;
  }

  get load(): { inFlight: number; capacity: number } {
    return { inFlight: this.inFlight, capacity: this.maxConcurrency };
  }

  async structured<S extends z.ZodTypeAny>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>> {
    if (this.inFlight >= this.maxConcurrency) throw new LlmBusyException();

    this.inFlight += 1;
    const started = Date.now();
    try {
      const result = await this.provider.structured(request);
      // Sizes and timings only. Never the prompt or the answer — they hold CVs.
      this.logger.log(
        `${request.name}: ${result.usage.totalTokens} tokens in ${Date.now() - started} ms`,
      );
      return result;
    } finally {
      this.inFlight -= 1;
    }
  }
}
