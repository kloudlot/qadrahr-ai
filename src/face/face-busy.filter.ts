import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { FaceBusyException } from './face.errors';

/** Adds Retry-After to the "at capacity" answer, as the model's filter does. */
@Catch(FaceBusyException)
export class FaceBusyFilter implements ExceptionFilter {
  catch(exception: FaceBusyException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response
      .status(exception.getStatus())
      .setHeader('Retry-After', String(exception.retryAfterSeconds))
      .json(exception.getResponse());
  }
}
