/**
 * Application configuration, validated once at module load.
 *
 * This module is imported first by main.tsx so that a misconfigured start fails
 * immediately and loudly, rather than issuing requests against the dev server's
 * own origin and producing a screenful of confusing 404s.
 *
 * Only VITE_-prefixed variables reach the browser. That prefix rule is the
 * guardrail keeping operator secrets out of the bundle — never read process.env
 * here, and never add `define:` entries to vite.config.ts to work around it.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function requireApiUrl(): string {
  const raw = import.meta.env.VITE_API_URL;

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ConfigError(
      'VITE_API_URL is not set. Copy .env.example to .env.local and set it to the ' +
        'Guardian API base URL (e.g. http://localhost:3000), then restart the dev server.',
    );
  }

  const trimmed = raw.trim();

  try {
    new URL(trimmed);
  } catch {
    throw new ConfigError(
      `VITE_API_URL is not a valid URL: "${trimmed}". Expected something like http://localhost:3000`,
    );
  }

  // Strip a trailing slash so callers can pass paths beginning with "/" without
  // producing a double slash.
  return trimmed.replace(/\/+$/, '');
}

export const config = {
  apiUrl: requireApiUrl(),
} as const;
