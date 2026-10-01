/**
 * Which credential a command sends — every command, the generated `linksnap api …` ones
 * included — in this order:
 *
 *   1. an API key given for this run: --api-key, or $LINKSNAP_API_KEY;
 *   2. the profile's Huudis sign-in from `linksnap auth login` (~/.linksnap/credentials),
 *      refreshed first when it is about to expire;
 *   3. the API key saved by `linksnap auth token` (~/.linksnap/config.json).
 */
import { existsSync } from 'node:fs';
import { Session } from '@forjio/linksnap-node';
import { getCredentialsPath, resolveApiKey, resolveProfile } from './config.js';

export type Credential = { kind: 'apiKey'; key: string } | { kind: 'session'; session: Session };

/** Construct a Session bound to ~/.linksnap/credentials. */
export function newSession(profile: string = 'default'): Session {
  return new Session({
    brand: 'linksnap',
    profile,
    credentialsPath: getCredentialsPath(),
  });
}

// One Session per profile for the life of the process: Session.refresh is single-flight
// per instance, and Huudis revokes the whole token family when a refresh token is used
// twice — so two calls in one command must never refresh separately.
const loaded = new Map<string, Session>();

/**
 * The profile's stored sign-in, loaded and refreshed when it expires within five
 * minutes. Null when there is none, or when it has expired and can no longer be
 * refreshed (the refresh token was revoked or has lapsed: sign in again).
 */
export async function loadSession(profile: string): Promise<Session | null> {
  let session = loaded.get(profile);
  if (!session) {
    if (!existsSync(getCredentialsPath())) return null;
    const fresh = newSession(profile);
    try {
      await fresh.load();
    } catch {
      return null; // no such profile in the file
    }
    loaded.set(profile, fresh);
    session = fresh;
  }
  if (session.willExpireSoon()) {
    try {
      await session.refresh();
    } catch {
      if (session.isExpired()) return null;
      // Still valid for a few minutes: use it, and refresh next time.
    }
  }
  return session;
}

/** Refresh after the server refused the access token; false when that is not possible. */
export async function refreshSession(session: Session): Promise<boolean> {
  try {
    await session.refresh();
    return true;
  } catch {
    return false;
  }
}

export async function resolveCredential(opts: { apiKey?: string; profile?: string }): Promise<Credential | null> {
  const explicit = opts.apiKey || process.env.LINKSNAP_API_KEY;
  if (explicit) return { kind: 'apiKey', key: explicit };
  const session = await loadSession(resolveProfile(opts));
  if (session) return { kind: 'session', session };
  const saved = resolveApiKey(opts);
  return saved ? { kind: 'apiKey', key: saved } : null;
}
