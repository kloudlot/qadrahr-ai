import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * As with the model errors, the status is the retry policy: the backend
 * retries 5xx later and treats 4xx as "this input will never work".
 */
export class FaceBusyException extends HttpException {
  constructor(readonly retryAfterSeconds = 2) {
    super(
      {
        statusCode: 503,
        error: 'face_busy',
        message: 'The face engine is at capacity. Retry shortly.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class FaceDisabledException extends HttpException {
  constructor() {
    super(
      {
        statusCode: 503,
        error: 'face_disabled',
        message: 'The face engine is not enabled on this service.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class FaceUnreadableFrameException extends HttpException {
  constructor(index: number) {
    super(
      {
        statusCode: 400,
        error: 'unreadable_frame',
        message: `frames[${index}] is not an image this service can read.`,
        frame: index,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
