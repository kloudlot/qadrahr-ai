import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.use(helmet());
  // No CORS: browsers never call this service. Only qadrahr-backend does.
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();

  const port = app.get(ConfigService<AppConfig, true>).get('port', { infer: true });
  await app.listen(port);
}

void bootstrap();
