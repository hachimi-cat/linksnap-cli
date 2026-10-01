import { LinkSnapClient, Session } from '@forjio/linksnap-node';
import { resolveApiUrl } from './config.js';
import { ApiRequestError } from './api.js';
import { newSession, resolveCredential } from './credentials.js';

export { newSession };

/**
 * The legacy CLI stores `apiUrl` like `https://linksnap.forjio.com/api/v1`,
 * but the @forjio/linksnap-node SDK prepends `/api/v1/...` itself, so for the
 * SDK we want just the origin. This trims a trailing `/api/v1` (with or
 * without a trailing slash) so both styles work transparently.
 */
export function sdkBaseUrl(apiUrl: string): string {
  return apiUrl.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
}

export interface ClientOptions {
  apiKey?: string;
  apiUrl?: string;
  profile?: string;
  verbose?: boolean;
}

export interface ClientHandle {
  client: LinkSnapClient;
  /** How auth was resolved — "session" or "apiKey". */
  authMode: 'session' | 'apiKey';
  /** Active session, when authMode === "session". */
  session?: Session;
}

/**
 * Build a LinkSnapClient with this run's credential (lib/credentials.ts): an API key
 * given for the run, else the profile's Huudis session (refreshed when stale — the SDK
 * client also refreshes on a 401), else the saved API key.
 *
 * Throws ApiRequestError with AUTH_REQUIRED if there is none.
 */
export async function getClient(opts: ClientOptions = {}): Promise<ClientHandle> {
  const baseUrl = sdkBaseUrl(resolveApiUrl(opts));
  const cred = await resolveCredential(opts);
  if (cred?.kind === 'session') {
    return { client: new LinkSnapClient({ baseUrl, session: cred.session }), authMode: 'session', session: cred.session };
  }
  if (cred?.kind === 'apiKey') {
    return { client: new LinkSnapClient({ baseUrl, apiKey: cred.key }), authMode: 'apiKey' };
  }
  throw new ApiRequestError(401, {
    code: 'AUTH_REQUIRED',
    message:
      'Not authenticated. Run `linksnap auth login` (Huudis device flow) or `linksnap auth token <key>` (API key) first.',
  });
}

/**
 * Translate any thrown error from the LinkSnap SDK into our existing
 * ApiRequestError shape so the rest of the CLI's error-handling pipeline
 * keeps working unchanged.
 */
export function toApiRequestError(err: unknown): ApiRequestError {
  if (err instanceof ApiRequestError) return err;

  // @forjio/sdk ApiError has shape { status, code, message } or similar.
  const anyErr = err as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };

  const statusCode = anyErr.status ?? anyErr.statusCode ?? 0;
  const code = anyErr.code ?? (statusCode ? 'API_ERROR' : 'UNKNOWN_ERROR');
  const message = anyErr.message ?? 'Unknown error';

  return new ApiRequestError(statusCode || 500, { code, message, details: anyErr.details });
}
