import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { type AppConfig } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('PORT', { infer: true });

  await app.listen(port);

  new Logger('Bootstrap').log(`Guardian API listening on port ${port}`);
}

bootstrap().catch((error: unknown) => {
  // Config validation failures land here. The formatted, key-by-key report is
  // already on stderr by this point (see src/config/format-errors.ts); this is
  // the exit path that makes the failure visible to Compose and to the shell.
  if (!(error instanceof Error && error.message === 'Configuration validation failed')) {
    process.stderr.write(`\nFailed to start: ${String(error)}\n`);
  }

  process.exit(1);
});
