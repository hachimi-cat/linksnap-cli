import { resolveApiUrl } from './config.js';
import { resolveCredential, refreshSession, type Credential } from './credentials.js';

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiRequestError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: Record<string, unknown>;

  constructor(statusCode: number, error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.errorCode = error.code;
    this.details = error.details;
  }

  get exitCode(): number {
    if (this.statusCode === 401 || this.statusCode === 403) return 2;
    if (this.statusCode === 429) return 3;
    if (this.errorCode === 'QUOTA_EXCEEDED') return 4;
    return 1;
  }
}

export interface ApiClientOptions {
  apiKey?: string;
  apiUrl?: string;
  /** The `linksnap auth login` profile (default: $LINKSNAP_PROFILE or "default"). */
  profile?: string;
  verbose?: boolean;
}

export interface ApiResponse<T = unknown> {
  data: T;
  meta?: {
    cursor?: string;
    hasMore?: boolean;
    total?: number;
  };
}

/** A LinkSnap API key (`lsk_live_…` / `lsk_test_…`) goes as `ApiKey <key>`, which is
 *  what the server reads; any other token (a Huudis access token) as `Bearer <token>`. */
export function authorizationHeader(token: string): string {
  return token.startsWith('lsk_') ? `ApiKey ${token}` : `Bearer ${token}`;
}

const NOT_AUTHENTICATED: ApiError = {
  code: 'AUTH_REQUIRED',
  message: 'Not authenticated. Run `linksnap auth login` or `linksnap auth token <key>` first.',
};

function credentialHeader(cred: Credential): string {
  return cred.kind === 'apiKey' ? authorizationHeader(cred.key) : `Bearer ${cred.session.data!.accessToken}`;
}

/** The Authorization header for this run's credential (lib/credentials.ts), for a caller
 *  that makes its own request (a multipart upload). */
export async function resolveAuthorization(opts: { apiKey?: string; profile?: string }): Promise<string> {
  const cred = await resolveCredential(opts);
  if (!cred) throw new ApiRequestError(401, NOT_AUTHENTICATED);
  return credentialHeader(cred);
}

/** Send with this run's credential. A signed-in session whose access token the server
 *  refuses is refreshed once and the request retried, as the SDKs do. */
async function send(
  method: string,
  url: URL,
  opts: ApiClientOptions,
  init: { headers?: Record<string, string>; body?: string | FormData },
): Promise<Response> {
  const cred = await resolveCredential(opts);
  if (!cred) throw new ApiRequestError(401, NOT_AUTHENTICATED);
  const attempt = async (): Promise<Response> => {
    const start = Date.now();
    const response = await fetch(url.toString(), {
      method,
      headers: { Authorization: credentialHeader(cred), ...init.headers },
      body: init.body,
    });
    if (opts.verbose) {
      console.error(`${method} ${url.toString()} → ${response.status} (${Date.now() - start}ms)`);
    }
    return response;
  };
  const response = await attempt();
  if (response.status === 401 && cred.kind === 'session' && (await refreshSession(cred.session))) {
    return attempt();
  }
  return response;
}

function requestUrl(path: string, opts: ApiClientOptions & { params?: Record<string, string> }): URL {
  const baseUrl = resolveApiUrl(opts);
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  if (opts.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }
  return url;
}

async function failure(response: Response): Promise<ApiRequestError> {
  let error: ApiError;
  try {
    const body = (await response.json()) as { error?: ApiError };
    error = body.error ?? { code: 'UNKNOWN_ERROR', message: response.statusText };
  } catch {
    error = { code: 'UNKNOWN_ERROR', message: response.statusText };
  }
  return new ApiRequestError(response.status, error);
}

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  opts: ApiClientOptions & { body?: unknown; params?: Record<string, string> } = {}
): Promise<ApiResponse<T>> {
  const response = await send(method, requestUrl(path, opts), opts, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as ApiResponse<T>;
}

/** A multipart upload (the generated commands' file routes): the FormData as the body —
 *  fetch writes it and its Content-Type, with the boundary — and this run's credential. */
export async function apiForm<T = unknown>(
  method: string,
  path: string,
  opts: ApiClientOptions & { form: FormData; params?: Record<string, string> },
): Promise<ApiResponse<T>> {
  const response = await send(method, requestUrl(path, opts), opts, {
    headers: { Accept: 'application/json' },
    body: opts.form,
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as ApiResponse<T>;
}

export async function apiDownload(
  method: string,
  path: string,
  opts: ApiClientOptions & { params?: Record<string, string> } = {}
): Promise<Buffer> {
  const response = await send(method, requestUrl(path, opts), opts, {});
  if (!response.ok) throw await failure(response);
  return Buffer.from(await response.arrayBuffer());
}
