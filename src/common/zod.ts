import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Parses input against a schema, or 400 with every problem listed. */
export function parseOr400<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new BadRequestException({
    statusCode: 400,
    error: 'invalid_request',
    message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
  });
}
