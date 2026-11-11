import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { LlmBusyException } from './llm.errors';

/** Adds Retry-After to the "at capacity" answer, so a caller knows when to come back. */
@Catch(LlmBusyException)
export class LlmBusyFilter implements ExceptionFilter {
  catch(exception: LlmBusyException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(exception.getStatus())
      .setHeader('Retry-After', String(exception.retryAfterSeconds))
      .json(exception.getResponse());
  }
}
