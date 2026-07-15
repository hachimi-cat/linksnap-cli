import { existsSync } from 'node:fs';
import { LinkSnapClient, Session } from '@forjio/linksnap-node';
import {
  resolveApiKey,
  resolveApiUrl,
  resolveProfile,
  getCredentialsPath,
} from './config.js';
import { ApiRequestError } from './api.js';

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
 * Build a LinkSnapClient. Prefer a Huudis session when one exists in
 * ~/.linksnap/credentials for the active profile; fall back to API key.
 *
 * Throws ApiRequestError with AUTH_REQUIRED if neither auth is available.
 */
export async function getClient(opts: ClientOptions = {}): Promise<ClientHandle> {
  const baseUrl = sdkBaseUrl(resolveApiUrl(opts));
  const profile = resolveProfile(opts);
  const credentialsPath = getCredentialsPath();

  // Prefer Session if a credentials file exists and the profile is present.
  if (existsSync(credentialsPath)) {
    const session = newSession(profile);
    try {
      await session.load();
      // Single-flight refresh if expiring soon (or expired).
      if (session.willExpireSoon()) {
        await session.refresh();
      }
      const client = new LinkSnapClient({ baseUrl, session });
      return { client, authMode: 'session', session };
    } catch {
      // Profile didn't exist in credentials file, or refresh failed.
      // Fall through to API key path.
    }
  }

  const apiKey = resolveApiKey(opts);
  if (apiKey) {
    const client = new LinkSnapClient({ baseUrl, apiKey });
    return { client, authMode: 'apiKey' };
  }

  throw new ApiRequestError(401, {
    code: 'AUTH_REQUIRED',
    message:
      'Not authenticated. Run `linksnap auth login` (Huudis device flow) or `linksnap auth token <key>` (API key) first.',
  });
}

/** Construct a Session bound to ~/.linksnap/credentials. */
export function newSession(profile: string = 'default'): Session {
  return new Session({
    brand: 'linksnap',
    profile,
    credentialsPath: getCredentialsPath(),
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
