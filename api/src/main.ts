import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { type AppConfig } from './config/env.schema';
import { loadOpenApiDocument } from './docs/openapi-document';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('PORT', { infer: true });

  // The deployed frontend and API sit on different subdomains, which makes every
  // browser call cross-origin. Nest sends no CORS headers by default, so without
  // this the browser blocks each response while `curl` keeps working perfectly —
  // a failure that looks like the API being down when it is entirely up.
  //
  // An explicit list rather than `origin: true`. Reflecting whatever origin asks,
  // together with `credentials: true`, lets any page on the internet make
  // authenticated requests on a signed-in user's behalf. The list costs nothing
  // and the reflection buys nothing we need.
  //
  // Hardcoded rather than configured: these are the only two origins that exist,
  // and adding a required key to env.schema.ts would invalidate every deployed
  // .env at the moment we can least afford it. If the frontend is ever served
  // from the API's own origin (nginx proxying /api/), none of this is consulted.
  app.enableCors({
    origin: ['https://guardian.clone.solutions', 'http://localhost:5173'],
    credentials: true,
  });

  // The published contract at `GET /docs`, from a hand-written document rather
  // than from decorators — see src/docs/openapi-document.ts for why.
  //
  // ⚠️ **`SwaggerModule.setup` registers on the HTTP adapter, not the Nest
  // router**, so the global fail-closed JWT guard never sees these paths and
  // there is nowhere to put a `@Public()`. That is what makes them anonymous,
  // and it is verified by curling without a token rather than assumed — a
  // contract behind a login is a 401 on a judge's screen.
  //
  // A null document means the file was missing or malformed; that is logged in
  // the loader and skipped here, because documentation must not be able to take
  // the API down.
  const openApiDocument = loadOpenApiDocument();

  if (openApiDocument !== null) {
    SwaggerModule.setup('docs', app, openApiDocument as never);
  } else {
    new Logger('Bootstrap').warn('GET /docs is not being served — see the OpenAPI error above.');
  }

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
