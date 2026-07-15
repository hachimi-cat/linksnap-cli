import { resolveApiKey, resolveApiUrl } from './config.js';

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

export async function apiRequest<T = unknown>(
  method: string,
  path: string,
  opts: ApiClientOptions & { body?: unknown; params?: Record<string, string> } = {}
): Promise<ApiResponse<T>> {
  const baseUrl = resolveApiUrl(opts);
  const apiKey = resolveApiKey(opts);

  if (!apiKey) {
    throw new ApiRequestError(401, {
      code: 'AUTH_REQUIRED',
      message: 'Not authenticated. Run `linksnap auth login` or `linksnap auth token <key>` first.',
    });
  }

  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');

  if (opts.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const start = Date.now();

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const elapsed = Date.now() - start;

  if (opts.verbose) {
    console.error(`${method} ${url.toString()} → ${response.status} (${elapsed}ms)`);
  }

  if (!response.ok) {
    let error: ApiError;
    try {
      const body = (await response.json()) as { error?: ApiError };
      error = body.error ?? { code: 'UNKNOWN_ERROR', message: response.statusText };
    } catch {
      error = { code: 'UNKNOWN_ERROR', message: response.statusText };
    }
    throw new ApiRequestError(response.status, error);
  }

  const body = (await response.json()) as ApiResponse<T>;
  return body;
}

export async function apiDownload(
  method: string,
  path: string,
  opts: ApiClientOptions & { params?: Record<string, string> } = {}
): Promise<Buffer> {
  const baseUrl = resolveApiUrl(opts);
  const apiKey = resolveApiKey(opts);

  if (!apiKey) {
    throw new ApiRequestError(401, {
      code: 'AUTH_REQUIRED',
      message: 'Not authenticated. Run `linksnap auth login` or `linksnap auth token <key>` first.',
    });
  }

  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');

  if (opts.params) {
    for (const [key, value] of Object.entries(opts.params)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };

  const start = Date.now();

  const response = await fetch(url.toString(), {
    method,
    headers,
  });

  const elapsed = Date.now() - start;

  if (opts.verbose) {
    console.error(`${method} ${url.toString()} → ${response.status} (${elapsed}ms)`);
  }

  if (!response.ok) {
    let error: ApiError;
    try {
      const body = (await response.json()) as { error?: ApiError };
      error = body.error ?? { code: 'UNKNOWN_ERROR', message: response.statusText };
    } catch {
      error = { code: 'UNKNOWN_ERROR', message: response.statusText };
    }
    throw new ApiRequestError(response.status, error);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
