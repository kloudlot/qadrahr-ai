import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { AppConfig } from '../config/configuration';
import { IS_PUBLIC } from './public.decorator';

/**
 * Every route except health is for qadrahr-backend alone.
 *
 * A shared bearer token, compared in constant time. The backend is the only
 * caller and owns every decision about people — who they are, which tenant,
 * whether AI is allowed for them — so this service checks that the caller is
 * the backend, and that it said which tenant the work is for.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<AppConfig, true>,
  ) {
    this.expected = digest(config.get('serviceToken', { infer: true }));
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    // Hashed first so the comparison is over equal lengths — timingSafeEqual
    // throws on a length mismatch, and the throw itself would leak the length.
    if (!token || !timingSafeEqual(digest(token), this.expected)) {
      throw new UnauthorizedException('Invalid service token');
    }

    if (!request.headers['x-tenant-id']) {
      throw new UnauthorizedException('x-tenant-id is required');
    }

    return true;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
