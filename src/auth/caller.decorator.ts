import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface Caller {
  tenantId: string;
  requestId?: string;
}

/** Which tenant the backend says this work is for. Used for logs, never for data access. */
export const CallerContext = createParamDecorator((_: unknown, ctx: ExecutionContext): Caller => {
  const request = ctx.switchToHttp().getRequest<Request>();
  const header = (name: string) => {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  return { tenantId: header('x-tenant-id') ?? '', requestId: header('x-request-id') };
});
