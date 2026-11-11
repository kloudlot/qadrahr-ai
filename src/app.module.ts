import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { ServiceTokenGuard } from './auth/service-token.guard';
import { HealthController } from './health/health.controller';
import { LlmBusyFilter } from './llm/busy.filter';
import { LlmModule } from './llm/llm.module';
import { RecruitmentModule } from './recruitment/recruitment.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validationSchema }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        // The backend's request id, so one screening can be followed across both services.
        genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
        customProps: (req) => ({ tenantId: req.headers['x-tenant-id'] }),
        // Headers carry the service token; bodies carry CVs. Neither is logged.
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    LlmModule,
    RecruitmentModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ServiceTokenGuard },
    { provide: APP_FILTER, useClass: LlmBusyFilter },
  ],
})
export class AppModule {}
