import { resolve } from 'path';

import * as dotenv from 'dotenv';

import { envSchema } from './env.schema';
import { formatConfigErrors } from './format-errors';

/**
 * Validates the environment in its own process, before the app starts.
 *
 * This exists because of `nest start --watch`. The watcher is the whole point
 * of the bind-mounted source in Compose, but it swallows the child's exit code:
 * a config failure prints, the child dies, and the watcher sits there waiting
 * for a file change. The container stays UP — alive and permanently broken —
 * which defeats the non-zero exit that Compose, `docker compose run`, and any
 * shell `&&` depend on to know the service failed.
 *
 * So the check runs first, in a plain process that can exit(1) honestly. The
 * config module still validates again at boot; this is the outer gate, not a
 * replacement for it.
 */
// Resolved from the working directory, not from __dirname, and deliberately so:
// npm scripts always run with cwd = `api/`, so this is exactly the `../.env` that
// ConfigModule is configured with — one mental model, and it does not silently
// change meaning if this file moves between `src/` and `src/config/`.
//
// (An earlier __dirname-relative version had precisely that bug: correct from
// `src/`, one directory short from `src/config/`. Docker hid it, because Compose
// injects the values directly and dotenv finding nothing is harmless there. Only
// the host run failed — with every key reported missing at once.)
dotenv.config({ path: resolve(process.cwd(), '../.env') });

const result = envSchema.safeParse(process.env);

if (!result.success) {
  process.stderr.write(formatConfigErrors(result.error));
  process.exit(1);
}
