import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { setupSwagger } from './swagger.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.enableShutdownHooks();
  const apiPrefix = config.get<string>('apiPrefix');
  if (apiPrefix) {
    app.setGlobalPrefix(apiPrefix);
  }
  if (config.get<boolean>('swaggerEnabled')) {
    setupSwagger(app);
  }
  await app.listen(config.getOrThrow<number>('port'));
}

void bootstrap();
