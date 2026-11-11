import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Reachable without the service token. Health checks only. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
