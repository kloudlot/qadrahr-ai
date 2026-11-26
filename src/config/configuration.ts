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
    /**
     * Presentation-attack detection on every frame with a face: `minifasnet`
     * (two MiniFASNet models, averaged) or `off`. Only used by the `onnx` provider.
     */
    liveness: 'minifasnet' | 'off';
  };
  limits: {
    /** Largest CV accepted, in bytes. */
    maxCvBytes: number;
    /** CV text beyond this is cut before it reaches the model — bounds the tokens. */
    maxCvChars: number;
    /** Largest document (a policy, a handbook) accepted for text extraction. */
    maxDocumentBytes: number;
    /** Document text kept, at most. A long handbook is cut here. */
    maxDocumentChars: number;
    /**
     * Policy text one assistant answer may show the model. Under it, every
     * policy goes in whole; over it, the passages most like the question.
     */
    maxPolicyContextChars: number;
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
    liveness: (process.env.FACE_LIVENESS || 'minifasnet') as 'minifasnet' | 'off',
  },
  limits: {
    maxCvBytes: parseInt(process.env.MAX_CV_BYTES || String(10 * 1024 * 1024), 10),
    maxCvChars: parseInt(process.env.MAX_CV_CHARS || '30000', 10),
    maxDocumentBytes: parseInt(process.env.MAX_DOCUMENT_BYTES || String(25 * 1024 * 1024), 10),
    maxDocumentChars: parseInt(process.env.MAX_DOCUMENT_CHARS || '400000', 10),
    maxPolicyContextChars: parseInt(process.env.MAX_POLICY_CONTEXT_CHARS || '60000', 10),
  },
});
