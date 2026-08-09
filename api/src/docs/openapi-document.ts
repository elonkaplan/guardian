import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { load } from 'js-yaml';

/**
 * Loads `docs/openapi.yaml` — the published API contract — for `GET /docs`.
 *
 * ## ⚠️ The contract is data, not code, and it is loaded like data
 *
 * Nothing in `src/` describes the API's shape. The document is hand-written from
 * responses captured off the running API (spec 012, FR-005), because the
 * alternative — decorating every DTO across eleven finished features so
 * `@nestjs/swagger` can generate it — is a change to verified code for a
 * documentation benefit, four days before the demo.
 *
 * The consequence is that this file reads a path, and paths in containers are
 * where this kind of thing goes wrong.
 *
 * ## Why `process.cwd()` and not `__dirname`
 *
 * `__dirname` is `/app/dist/docs` at runtime under `start:prod` and `/app/src/docs`
 * under `ts-node`, so a relative hop out of it differs between the two. The
 * process is started from `/app` in both (`WORKDIR /app`, and `npm start` from the
 * repo root on a host), so the working directory is the one stable anchor.
 *
 * ## Three places had to agree for this to resolve
 *
 * 1. `.dockerignore` excludes `docs/` and `*.md` — it carries a `!docs/openapi.yaml`
 *    negation so the file is in the image at all.
 * 2. `docker-compose.yml` bind-mounts only `./src` — it carries a second mount for
 *    this file, so editing the contract does not need a rebuild.
 * 3. `nest build` copies no non-TS assets, which is why the document lives at
 *    `docs/openapi.yaml` and is read from the source tree rather than from `dist/`.
 *
 * Miss any one and `GET /docs` works perfectly on a host and 404s in the
 * container — which is where the demo runs, and the reason the verification for
 * this feature curls the container rather than localhost.
 *
 * ## Why this returns `null` instead of throwing
 *
 * A typo in a YAML file must never be able to stop the API booting. The contract
 * is documentation: losing `/docs` costs a judge a page, losing the API costs the
 * demo. So a missing or unparseable document is logged loudly and the caller
 * skips mounting Swagger — every other route serves normally.
 */
export function loadOpenApiDocument(): Record<string, unknown> | null {
  const path = join(process.cwd(), 'docs', 'openapi.yaml');
  const logger = new Logger('OpenAPI');

  let raw: string;

  try {
    raw = readFileSync(path, 'utf8');
  } catch (err: unknown) {
    logger.error(
      `Contract not found at ${path} — GET /docs will not be served. ` +
        `In a container this usually means the .dockerignore negation or the ` +
        `compose bind-mount is missing. (${String(err)})`,
    );
    return null;
  }

  let parsed: unknown;

  try {
    parsed = load(raw);
  } catch (err: unknown) {
    logger.error(
      `Contract at ${path} is not valid YAML — GET /docs will not be served. ` +
        `(${String(err)})`,
    );
    return null;
  }

  // `load` returns `undefined` for an empty file and a scalar for a file holding
  // one — neither is a document, and SwaggerModule would fail obscurely on both.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    logger.error(
      `Contract at ${path} did not parse to an object — GET /docs will not be served.`,
    );
    return null;
  }

  return parsed as Record<string, unknown>;
}
