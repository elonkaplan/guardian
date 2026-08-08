import { config } from '../config';
import { ApiError, LOCAL_ERROR_CODES } from './errors';
import { UNAUTHENTICATED_EVENT, clearToken, readToken } from './session';

/**
 * The only way out of the app.
 *
 * No screen calls fetch directly. A feature that needs a new endpoint adds a
 * typed wrapper next to this file and inherits the base URL, the credential,
 * the timeout, and error normalisation for free.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

interface RequestOptions extends Omit<RequestInit, 'body' | 'method'> {
  timeoutMs?: number;
}

/** Shapes a backend error body might plausibly take. We accept any of them. */
interface BackendErrorBody {
  code?: unknown;
  error?: unknown;
  message?: unknown;
}

function buildUrl(path: string): string {
  return `${config.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function buildHeaders(hasBody: boolean, provided: HeadersInit | undefined): Headers {
  const headers = new Headers(provided);
  headers.set('Accept', 'application/json');
  if (hasBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = readToken();
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

function resolveSignal(callerSignal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout;
}

/** fetch rejected, so we never got an answer. Sort out why. */
function toTransportError(cause: unknown, timeoutMs: number): ApiError {
  const name = cause instanceof Error ? cause.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new ApiError({
      kind: 'timeout',
      status: 0,
      code: LOCAL_ERROR_CODES.timeout,
      message: `The request took longer than ${timeoutMs / 1000} seconds and was given up on.`,
      details: cause,
    });
  }
  return new ApiError({
    kind: 'network',
    status: 0,
    code: LOCAL_ERROR_CODES.network,
    message: `Could not reach the Guardian API at ${config.apiUrl}. Is it running?`,
    details: cause,
  });
}

/** Read a failed response's body without ever letting the read itself throw. */
async function describeFailure(response: Response): Promise<{ code: string; message: string; details: unknown }> {
  const fallbackCode = `HTTP_${response.status}`;
  let details: unknown;

  try {
    const text = await response.text();
    if (text.trim() !== '') {
      try {
        details = JSON.parse(text) as unknown;
      } catch {
        details = text;
      }
    }
  } catch {
    // Body already consumed or unreadable — the status alone will have to do.
  }

  if (details !== null && typeof details === 'object') {
    const body = details as BackendErrorBody;
    const code = typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : fallbackCode;
    const message =
      typeof body.message === 'string' && body.message.trim() !== ''
        ? body.message
        : `${response.status} ${response.statusText}`.trim();
    return { code, message, details };
  }

  if (typeof details === 'string' && details.trim() !== '') {
    return { code: fallbackCode, message: details.slice(0, 300), details };
  }

  return {
    code: fallbackCode,
    message: `${response.status} ${response.statusText}`.trim() || `Request failed with status ${response.status}`,
    details,
  };
}

function handleUnauthenticated(): void {
  clearToken();
  window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, headers, ...rest } = options;
  const hasBody = body !== undefined;

  let response: Response;
  try {
    response = await fetch(buildUrl(path), {
      ...rest,
      method,
      headers: buildHeaders(hasBody, headers),
      signal: resolveSignal(signal, timeoutMs),
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    throw toTransportError(cause, timeoutMs);
  }

  if (!response.ok) {
    // 401 means our credential is gone or stale. Clear it and let the shell
    // navigate — before rejecting, so the redirect isn't racing the caller's
    // own error handling.
    if (response.status === 401) {
      handleUnauthenticated();
    }
    const { code, message, details } = await describeFailure(response);
    throw new ApiError({ kind: 'http', status: response.status, code, message, details });
  }

  // 204, or any empty body, is a legitimate success with nothing to parse.
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (text.trim() === '') {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ApiError({
      kind: 'parse',
      status: response.status,
      code: LOCAL_ERROR_CODES.parse,
      message: 'The API returned a response that was not valid JSON.',
      details: cause,
    });
  }
}

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export function apiPost<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('POST', path, body, options);
}

export function apiPatch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PATCH', path, body, options);
}

export interface HealthResult {
  reachable: boolean;
  status: number;
  /** Present when unreachable. */
  message?: string;
}

/**
 * Is the backend there?
 *
 * Any HTTP response counts as reachable — including 404 and 500. `/health` is
 * named in this feature's acceptance criteria and in the bootstrap checklist,
 * but it does not appear in api-design §3's endpoint tables, so the check must
 * not depend on that route existing. "The server answered" is what we actually
 * want to know: the base URL is right and the API is up.
 */
export async function checkHealth(options?: RequestOptions): Promise<HealthResult> {
  try {
    await apiGet<unknown>('/health', { timeoutMs: 5_000, ...options });
    return { reachable: true, status: 200 };
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'http') {
      return { reachable: true, status: error.status };
    }
    if (error instanceof ApiError && error.kind === 'parse') {
      // It answered, just not with JSON. Still reachable.
      return { reachable: true, status: error.status };
    }
    return {
      reachable: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
