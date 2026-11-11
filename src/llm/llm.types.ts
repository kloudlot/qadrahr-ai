import type { z } from 'zod';

export interface Usage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Message {
  role: 'system' | 'user';
  content: string;
}

export interface StructuredRequest<S extends z.ZodTypeAny> {
  /** Names the output for the model and in logs, e.g. `cv_screening`. */
  name: string;
  schema: S;
  messages: Message[];
}

export interface StructuredResult<T> {
  data: T;
  usage: Usage;
}

/** What a model provider must do. OpenAI in production, a fake in tests. */
export interface LlmProvider {
  readonly model: string;
  structured<S extends z.ZodTypeAny>(
    request: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>>;
}
