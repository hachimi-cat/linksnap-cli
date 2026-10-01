import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The `linksnap auth login` session as the credential of every command: the generated
// `linksnap api …` ones, the hand-written ones and `auth whoami`. A real Session on a real
// credentials file; only the network (Huudis's discovery + token endpoints, the API) is
// faked, so the refresh is the SDK's own.

const ISSUER = 'https://huudis.test';
const API = 'https://linksnap.test/api/v1';
const paths = vi.hoisted(() => ({ credentials: '' }));

vi.mock('../../lib/config.js', () => ({
  resolveApiKey: (opts: { apiKey?: string }) => opts.apiKey ?? null, // nothing saved by `auth token`
  resolveApiUrl: (opts: { apiUrl?: string }) => opts.apiUrl ?? API,
  resolveProfile: (opts: { profile?: string }) => opts.profile ?? 'default',
  resolveHuudisIssuer: () => ISSUER,
  resolveHuudisClientId: () => 'linksnap-cli',
  getConfig: () => null,
  setConfig: vi.fn(),
  clearConfig: vi.fn(),
  getConfigPath: () => '/nonexistent/.linksnap/config.json',
  getCredentialsPath: () => paths.credentials,
  getConfigDir: () => '/nonexistent/.linksnap',
}));

interface Call { url: string; method: string; auth?: string; body?: string }
let calls: Call[];
/** Access tokens the API accepts; anything else gets 401. */
let accepted: Set<string>;
let refreshOk: boolean;
let logOutput: string[];
let errOutput: string[];
let exitCode: number | undefined;
let dir: string;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeNetwork(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  const headers = (init.headers ?? {}) as Record<string, string>;
  const auth = headers.Authorization ?? headers.authorization;
  calls.push({ url, method: init.method ?? 'GET', auth, body: init.body ? String(init.body) : undefined });
  if (url === `${ISSUER}/.well-known/openid-configuration`) {
    return Promise.resolve(json(200, {
      issuer: ISSUER,
      device_authorization_endpoint: `${ISSUER}/device`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks.json`,
    }));
  }
  if (url === `${ISSUER}/token`) {
    if (!refreshOk) return Promise.resolve(json(400, { error: 'invalid_grant', error_description: 'refresh token revoked' }));
    accepted.add('at-new');
    return Promise.resolve(json(200, { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600, token_type: 'Bearer' }));
  }
  if (url.startsWith(`${API}/`)) {
    const token = auth?.replace(/^Bearer /, '');
    if (!auth?.startsWith('ApiKey ') && !accepted.has(String(token))) {
      return Promise.resolve(json(401, { data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' }, meta: { requestId: 'r' } }));
    }
    const data = url.startsWith(`${API}/auth/me`)
      ? { user: { id: 'ws_person', email: 'person@example.test', huudisUserId: 'usr_1', role: 'merchant' } }
      : [{ id: 'l_1', slug: 'spring', url: 'https://example.com', totalClicks: 0, createdAt: '2026-10-01T00:00:00Z', tags: [] }];
    return Promise.resolve(json(200, { data, error: null, meta: { requestId: 'r' } }));
  }
  return Promise.resolve(json(404, { error: 'unexpected call' }));
}

function writeSession(expiresInSec: number): void {
  writeFileSync(
    paths.credentials,
    [
      '[default]',
      'access_token = at-old',
      'refresh_token = rt-old',
      `expires_at = ${Math.floor(Date.now() / 1000) + expiresInSec}`,
      `issuer = ${ISSUER}`,
      'client_id = linksnap-cli',
      'scope = openid profile email',
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
}

/** A fresh CLI per test: lib/credentials.ts keeps one Session per profile per process. */
async function run(args: string[]): Promise<void> {
  vi.resetModules();
  const { buildApiCommand } = await import('../../commands/api.generated.js');
  const { linksCommand } = await import('../../commands/links.js');
  const { authCommand } = await import('../../commands/auth.js');
  const program = new Command()
    .name('linksnap')
    .option('-j, --json', 'Output raw JSON')
    .option('-q, --quiet', 'Suppress all output except errors')
    .option('-v, --verbose', 'Show request/response details')
    .option('--api-key <key>', 'Override API key for this invocation')
    .option('--api-url <url>', 'Override API base URL')
    .option('--profile <name>', 'Credentials profile')
    .exitOverride()
    .addCommand(buildApiCommand())
    .addCommand(linksCommand)
    .addCommand(authCommand);
  await program.parseAsync(['node', 'linksnap', ...args]).catch(() => undefined);
}

const apiCalls = () => calls.filter((c) => c.url.startsWith(`${API}/`));
const refreshCalls = () => calls.filter((c) => c.url === `${ISSUER}/token`);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'linksnap-cli-session-'));
  paths.credentials = join(dir, 'credentials');
  calls = [];
  accepted = new Set(['at-old']);
  refreshOk = true;
  logOutput = [];
  errOutput = [];
  exitCode = undefined;
  vi.stubGlobal('fetch', vi.fn(fakeNetwork));
  vi.stubEnv('LINKSNAP_API_KEY', '');
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logOutput.push(args.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errOutput.push(args.map(String).join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    exitCode ??= Number(code ?? 0);
    throw new Error(`EXIT_${code}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('the `linksnap auth login` session as the credential', () => {
  it('a generated command sends the session’s access token', async () => {
    writeSession(3600);
    await run(['api', 'links', 'list']);
    expect(exitCode).toBe(0);
    expect(apiCalls()).toEqual([expect.objectContaining({ url: `${API}/links`, auth: 'Bearer at-old' })]);
    expect(refreshCalls()).toHaveLength(0);
  });

  it('refreshes a session about to expire before the call, and saves the new tokens', async () => {
    writeSession(60);
    await run(['api', 'links', 'list']);
    expect(exitCode).toBe(0);
    expect(refreshCalls()).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(refreshCalls()[0].body))).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'rt-old',
      client_id: 'linksnap-cli',
    });
    expect(apiCalls().map((c) => c.auth)).toEqual(['Bearer at-new']);
    const saved = readFileSync(paths.credentials, 'utf8');
    expect(saved).toContain('access_token = at-new');
    expect(saved).toContain('refresh_token = rt-new');
  });

  it('a token the server refuses is refreshed once and the call retried', async () => {
    writeSession(3600);
    accepted = new Set(); // revoked server-side before it expired
    await run(['api', 'links', 'list']);
    expect(exitCode).toBe(0);
    expect(refreshCalls()).toHaveLength(1);
    expect(apiCalls().map((c) => c.auth)).toEqual(['Bearer at-old', 'Bearer at-new']);
  });

  it('a hand-written command uses the session too', async () => {
    writeSession(3600);
    await run(['--json', 'links', 'list']);
    expect(exitCode).toBe(0);
    expect(apiCalls()[0]).toMatchObject({ url: `${API}/links`, auth: 'Bearer at-old' });
  });

  it('an API key given for the run wins over the session', async () => {
    writeSession(60);
    await run(['--api-key', 'lsk_live_k', 'api', 'links', 'list']);
    expect(exitCode).toBe(0);
    expect(apiCalls().map((c) => c.auth)).toEqual(['ApiKey lsk_live_k']);
    expect(refreshCalls()).toHaveLength(0);
  });

  it('an expired session that can no longer be refreshed asks to sign in (exit 2)', async () => {
    writeSession(-60);
    refreshOk = false;
    await run(['api', 'links', 'list']);
    expect(exitCode).toBe(2);
    expect(apiCalls()).toHaveLength(0);
    expect(errOutput.join('\n')).toContain('AUTH_REQUIRED');
  });

  it('`auth whoami` says who the session is, refreshing it first when stale', async () => {
    writeSession(60);
    await run(['--json', 'auth', 'whoami']);
    expect(exitCode).toBe(0);
    expect(refreshCalls()).toHaveLength(1);
    expect(apiCalls()).toEqual([expect.objectContaining({ url: `${API}/auth/me`, auth: 'Bearer at-new' })]);
    expect(JSON.parse(logOutput.join('\n'))).toMatchObject({
      authenticated: true,
      authMode: 'session',
      email: 'person@example.test',
      workspaceId: 'ws_person',
      issuer: ISSUER,
    });
  });
});
