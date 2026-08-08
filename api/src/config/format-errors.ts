import { type ZodError } from 'zod';

/**
 * Turns a validation failure into a report a developer can act on in one pass.
 *
 * Two rules govern this file, and both exist because of how the failure is
 * usually met — at 2am, mid-rehearsal, reading container logs.
 *
 * 1. EVERY issue is reported, not the first. A developer who fixes one key,
 *    restarts, and discovers a second missing key has learned the same lesson
 *    twice. Zod's safeParse collects them all; we just have to print them all.
 *
 * 2. NO value is ever printed — not the received one, not a truncated one, not
 *    a "did you mean". DATABASE_URL contains a password and three of these keys
 *    ARE private keys. A validation error is exactly the moment naive code
 *    echoes what it got. Key name and expected form only.
 */
export function formatConfigErrors(error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    return `  ${key}: ${issue.message}`;
  });

  const plural = lines.length === 1 ? 'problem' : 'problems';

  return [
    '',
    '✖ Configuration is invalid — the API will not start.',
    '',
    `  ${lines.length} ${plural} found in the environment:`,
    '',
    ...lines,
    '',
    '  Values are read from the repository-root .env (shared with ui/ and sc/).',
    '  Inside Docker they come from Compose `env_file: ../.env`.',
    '',
  ].join('\n');
}
