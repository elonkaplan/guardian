import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { warnAboutPlaceholders } from './detect-placeholders';
import { envSchema, type AppConfig } from './env.schema';
import { formatConfigErrors } from './format-errors';

/**
 * Parses and validates the environment exactly once, at boot, before the
 * first request. Anything that fails here stops the process — no consumer
 * downstream ever sees a missing or malformed value.
 */
export function validate(raw: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    // stderr directly, not the Nest logger: this runs during module
    // initialization, before the logger exists. Writing here is what
    // guarantees the report survives Nest's own exception rendering.
    process.stderr.write(formatConfigErrors(result.error));
    throw new Error('Configuration validation failed');
  }

  // Right here, not in main.ts: this is the moment the values are known good
  // and typed, so the placeholder scan needs no second parse. It also means the
  // warning lands before the app starts rather than after it is already up.
  warnAboutPlaceholders(result.data);

  return result.data;
}

/**
 * `envFilePath: '../.env'` is the single source of configuration, shared with
 * `ui/` and `sc/`.
 *
 * Outside Docker the process cwd is `api/`, so `../.env` resolves to the
 * repository root. Inside Docker there is no `../.env` at all — Compose supplies
 * the values through `env_file`, so they are already in `process.env` and
 * ConfigModule simply skips the missing file. One setting, both run modes.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env',
      validate,
    }),
  ],
})
export class AppConfigModule {}
