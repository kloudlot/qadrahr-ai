import { join } from 'path';

export interface AppConfig {
  env: string;
  port: number;
  /**
   * The shared secret qadrahr-backend presents. This service has no users of
   * its own: the backend authenticates people, decides who may use AI, and
   * calls here with this token.
   */
  serviceToken: string;
  llm: {
    /** `fake` answers deterministically without a network call — tests and keyless local runs. */
    provider: 'openai' | 'fake';
    openaiApiKey?: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
    /** Model calls in flight at once. Beyond it, callers get 503 and retry. */
    maxConcurrency: number;
  };
  face: {
    /**
     * `onnx` runs the real models. `fake` needs none — tests, and laptops the
     * ONNX runtime has no build for. `off` leaves the endpoint answering 503.
     */
    provider: 'onnx' | 'fake' | 'off';
    /** Where the two .onnx files are (`npm run face:models` fetches them). */
    modelDir: string;
    /** CPU threads one inference may use. */
    threads: number;
    /** Requests analysed at once. Beyond it, callers get 503 and retry. */
    maxConcurrency: number;
  };
  limits: {
    /** Largest CV accepted, in bytes. */
    maxCvBytes: number;
    /** CV text beyond this is cut before it reaches the model — bounds the tokens. */
    maxCvChars: number;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4100', 10),
  serviceToken: process.env.AI_SERVICE_TOKEN as string,
  llm: {
    provider: (process.env.LLM_PROVIDER || 'openai') as 'openai' | 'fake',
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES || '2', 10),
    maxConcurrency: parseInt(process.env.AI_MAX_CONCURRENCY || '8', 10),
  },
  face: {
    provider: (process.env.FACE_PROVIDER || 'off') as 'onnx' | 'fake' | 'off',
    modelDir: process.env.FACE_MODEL_DIR || join(process.cwd(), 'models'),
    threads: parseInt(process.env.FACE_THREADS || '2', 10),
    maxConcurrency: parseInt(process.env.FACE_MAX_CONCURRENCY || '2', 10),
  },
  limits: {
    maxCvBytes: parseInt(process.env.MAX_CV_BYTES || String(10 * 1024 * 1024), 10),
    maxCvChars: parseInt(process.env.MAX_CV_CHARS || '30000', 10),
  },
});
