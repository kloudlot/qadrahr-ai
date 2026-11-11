import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Failures the caller should retry, with the status that says so. The
 * backend treats 5xx as "try again later" and 4xx as "this input will never
 * work", so the choice of status here is the retry policy.
 */
export class LlmBusyException extends HttpException {
  constructor(readonly retryAfterSeconds = 5) {
    super(
      {
        statusCode: 503,
        error: 'llm_busy',
        message: 'The AI service is at capacity. Retry shortly.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class LlmUnavailableException extends HttpException {
  constructor(message: string) {
    super({ statusCode: 502, error: 'llm_unavailable', message }, HttpStatus.BAD_GATEWAY);
  }
}

export class LlmTimeoutException extends HttpException {
  constructor() {
    super(
      { statusCode: 504, error: 'llm_timeout', message: 'The model did not answer in time.' },
      HttpStatus.GATEWAY_TIMEOUT,
    );
  }
}

export class LlmInvalidOutputException extends HttpException {
  constructor(name: string) {
    super(
      {
        statusCode: 502,
        error: 'llm_invalid_output',
        message: `The model's ${name} answer did not match the schema.`,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
