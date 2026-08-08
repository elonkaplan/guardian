/**
 * One error shape for every way a backend call can fail.
 *
 * The point of a single type is that no screen ever sees a raw TypeError from
 * fetch or a SyntaxError from JSON parsing. Eight screens each inventing their
 * own error handling is the thing this prevents.
 */

export type ApiErrorKind =
  /** The backend answered with a non-2xx status. */
  | 'http'
  /** fetch rejected — backend down, DNS failure, CORS. We never got an answer. */
  | 'network'
  /** The request exceeded its timeout. */
  | 'timeout'
  /** A 2xx response whose body was not the JSON we expected. */
  | 'parse';

export const LOCAL_ERROR_CODES = {
  network: 'NETWORK_ERROR',
  timeout: 'TIMEOUT',
  parse: 'PARSE_ERROR',
} as const;

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  /** Real HTTP status for 'http' and 'parse'; 0 when we never got a response. */
  readonly status: number;
  /** The backend's own error code when it supplied one, else a local constant. */
  readonly code: string;
  /** The parsed backend body, when there was one. */
  readonly details?: unknown;

  constructor(init: {
    kind: ApiErrorKind;
    status: number;
    code: string;
    message: string;
    details?: unknown;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    if (init.details !== undefined) {
      this.details = init.details;
    }
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * True when we never got a usable answer, as opposed to the backend deliberately
 * telling us no.
 *
 * This is the distinction screens actually need: "you can't do that" and
 * "something is wrong with the connection" call for completely different copy,
 * and deriving it from a status code in eight places is how it ends up
 * inconsistent.
 *
 * Note 'parse' counts as connectivity even though the server did respond — a
 * body we cannot read is, from a screen's point of view, the same broken pipe
 * as no body at all. Only 'http' means the backend understood us and refused.
 */
export function isConnectivityError(error: unknown): boolean {
  return isApiError(error) && error.kind !== 'http';
}
