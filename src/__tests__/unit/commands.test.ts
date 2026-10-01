import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock fetch globally before any module imports
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock config to always return a test key
vi.mock('../../lib/config.js', () => ({
  resolveApiKey: (opts: { apiKey?: string }) => opts.apiKey ?? 'test-key-123',
  resolveApiUrl: (opts: { apiUrl?: string }) => opts.apiUrl ?? 'https://api.test.com/v1',
  resolveProfile: (opts: { profile?: string }) => opts.profile ?? 'default',
  resolveHuudisIssuer: () => 'https://huudis.test.com',
  resolveHuudisClientId: () => 'linksnap-cli',
  getConfig: () => ({ apiKey: 'test-key-123', apiUrl: 'https://api.test.com/v1' }),
  setConfig: vi.fn().mockReturnValue({ apiKey: 'test-key-123', apiUrl: 'https://api.test.com/v1' }),
  clearConfig: vi.fn(),
  getConfigPath: () => '/home/test/.linksnap/config.json',
  getCredentialsPath: () => '/home/test/.linksnap/credentials',
  getConfigDir: () => '/home/test/.linksnap',
}));

// Mock @forjio/sdk's device-flow APIs so `auth login` doesn't hit the network.
const mockStartDeviceFlow = vi.fn();
const mockPollDeviceToken = vi.fn();

vi.mock('@forjio/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@forjio/sdk')>();
  return {
    ...actual,
    startDeviceFlow: (...args: unknown[]) => mockStartDeviceFlow(...args),
    pollDeviceToken: (...args: unknown[]) => mockPollDeviceToken(...args),
  };
});

// Mock the open package — keep auth login from launching a browser.
vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

// Mock @forjio/linksnap-node's Session so we don't touch the real filesystem.
// LinkSnapClient itself stays real — it calls fetch which is mocked at the
// global level — and our credentials path doesn't exist in the test sandbox,
// so getClient() naturally falls back to the API-key path.
vi.mock('@forjio/linksnap-node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@forjio/linksnap-node')>();
  class FakeSession {
    private data: Record<string, unknown> | undefined;
    constructor(_opts: unknown) {}
    async load() {
      if (!this.data) {
        const err = new Error('no profile') as Error & { code?: string };
        err.code = 'ENOENT';
        throw err;
      }
      return this.data;
    }
    async save(d: Record<string, unknown>) {
      this.data = d;
    }
    async clear() {
      this.data = undefined;
    }
    isExpired() {
      return false;
    }
    willExpireSoon() {
      return false;
    }
    async refresh() {}
    get profile() {
      return 'default';
    }
  }
  return {
    ...actual,
    Session: FakeSession as unknown as typeof actual.Session,
  };
});

// Import commands
import { authCommand } from '../../commands/auth.js';
import { linksCommand } from '../../commands/links.js';
import { statsCommand } from '../../commands/stats.js';
import { tagsCommand } from '../../commands/tags.js';
import { billingCommand } from '../../commands/billing.js';
import { keysCommand } from '../../commands/keys.js';
import { workspaceCommand } from '../../commands/workspace.js';
import { healthCommand } from '../../commands/health.js';

// Build a program with global options, mirroring index.ts
function createProgram(): Command {
  const program = new Command();
  program
    .name('linksnap')
    .option('-j, --json', 'Output raw JSON')
    .option('-q, --quiet', 'Suppress all output except errors')
    .option('-v, --verbose', 'Show request/response details')
    .option('--api-key <key>', 'Override API key for this invocation')
    .option('--api-url <url>', 'Override API base URL')
    .option('--profile <name>', 'Credentials profile')
    .option('--no-color', 'Disable colored output')
    .exitOverride(); // Don't call process.exit on parse errors

  program.addCommand(authCommand);
  program.addCommand(linksCommand);
  program.addCommand(statsCommand);
  program.addCommand(tagsCommand);
  program.addCommand(billingCommand);
  program.addCommand(keysCommand);
  program.addCommand(workspaceCommand);
  program.addCommand(healthCommand);

  return program;
}

// Capture console output
let logOutput: string[];
let errOutput: string[];
let exitCode: number | undefined;
let program: Command;

function resetCommandOpts(cmd: Command): void {
  // Commander persists parsed option values on the Command instance across
  // parses. Reset them so each test starts clean. Walk into subcommands too.
  type CmdInternal = Command & { _optionValues?: Record<string, unknown>; _optionValueSources?: Record<string, string> };
  const internal = cmd as CmdInternal;
  if (internal._optionValues) internal._optionValues = {};
  if (internal._optionValueSources) internal._optionValueSources = {};
  for (const sub of cmd.commands) {
    resetCommandOpts(sub);
  }
}

beforeEach(() => {
  logOutput = [];
  errOutput = [];
  exitCode = undefined;
  mockFetch.mockReset();

  // Wipe any commander option state left over from earlier tests
  // (the imported `authCommand` / `linksCommand` / etc. are module-level
  // singletons, so their parsed values survive across runs).
  [authCommand, linksCommand, statsCommand, tagsCommand, billingCommand, keysCommand, workspaceCommand, healthCommand].forEach(resetCommandOpts);

  program = createProgram();

  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logOutput.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errOutput.push(args.map(String).join(' '));
  });
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    exitCode = Number(code ?? 0);
    throw new Error(`EXIT_${code}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockApiSuccess(data: unknown, meta?: unknown) {
  // The Forjio SDK ApiClient uses res.text() + JSON.parse and requires the
  // full envelope { data, error, meta }. The legacy api.ts uses res.json() and
  // accepts { data, meta }. Provide both shapes from one mock.
  const envelope = { data, error: null, meta: meta ?? null };
  const body = JSON.stringify(envelope);
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(envelope),
  });
}

function mockApiError(status: number, code: string, message: string) {
  const envelope = { data: null, error: { code, message }, meta: null };
  const body = JSON.stringify(envelope);
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: message,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(envelope),
  });
}

function getCallUrl(): string {
  return mockFetch.mock.calls[0][0];
}

function getCallMethod(): string {
  return mockFetch.mock.calls[0][1].method;
}

function getCallBody(): unknown {
  const body = mockFetch.mock.calls[0][1].body;
  return body ? JSON.parse(body) : undefined;
}

function getCallAuth(): string {
  const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
  return headers.Authorization ?? headers.authorization;
}

async function run(...args: string[]): Promise<void> {
  try {
    await program.parseAsync(['node', 'linksnap', ...args]);
  } catch (e) {
    // Swallow EXIT errors from our mock
    if (e instanceof Error && !e.message.startsWith('EXIT_')) throw e;
  }
}

// =====================================================
// AUTH COMMANDS
// =====================================================
describe('auth commands', () => {
  describe('auth login (Huudis device flow)', () => {
    beforeEach(() => {
      mockStartDeviceFlow.mockReset();
      mockPollDeviceToken.mockReset();
    });

    it('prints user code and verification URI then polls for tokens', async () => {
      mockStartDeviceFlow.mockResolvedValueOnce({
        deviceCode: 'dev-1',
        userCode: 'WXYZ-1234',
        verificationUri: 'https://huudis.test.com/device',
        expiresIn: 600,
        interval: 5,
      });
      mockPollDeviceToken.mockResolvedValueOnce({
        accessToken: 'eyJ-access',
        refreshToken: 'eyJ-refresh',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        tokenType: 'Bearer',
        scope: 'openid profile email',
      });

      await run('auth', 'login', '--no-browser');

      expect(mockStartDeviceFlow).toHaveBeenCalledOnce();
      const startArg = mockStartDeviceFlow.mock.calls[0][0];
      expect(startArg.clientId).toBe('linksnap-cli');
      expect(startArg.issuer).toBe('https://huudis.test.com');
      expect(startArg.scope).toContain('openid');

      expect(mockPollDeviceToken).toHaveBeenCalledOnce();
      expect(mockPollDeviceToken.mock.calls[0][0].deviceCode).toBe('dev-1');

      const out = logOutput.join('\n');
      expect(out).toContain('WXYZ-1234');
      expect(out).toContain('https://huudis.test.com/device');
    });

    it('outputs JSON with --json', async () => {
      mockStartDeviceFlow.mockResolvedValueOnce({
        deviceCode: 'dev-2',
        userCode: 'AAAA-BBBB',
        verificationUri: 'https://huudis.test.com/device',
        expiresIn: 600,
        interval: 5,
      });
      mockPollDeviceToken.mockResolvedValueOnce({
        accessToken: 'tok',
        refreshToken: 'r',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        tokenType: 'Bearer',
      });

      await run('--json', 'auth', 'login', '--no-browser');
      const parsed = logOutput
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<Record<string, unknown>>;
      expect(parsed.some((p) => p.status === 'device_flow_started')).toBe(true);
      expect(parsed.some((p) => p.status === 'authenticated')).toBe(true);
    });

    it('exits non-zero when startDeviceFlow rejects', async () => {
      mockStartDeviceFlow.mockRejectedValueOnce(new Error('discovery failed'));
      await run('auth', 'login', '--no-browser');
      expect(exitCode).not.toBe(0);
      expect(errOutput.join('\n')).toContain('discovery failed');
    });
  });

  describe('auth token', () => {
    // On its workspace: /auth/me is who a signed-in person is, and refuses a key (401).
    it('verifies the key on its workspace (/api/v1/workspaces/current), sending it the way the server reads keys', async () => {
      mockApiSuccess({ id: 'ws_1', name: 'Acme', plan: 'pro' });
      await run('auth', 'token', 'lsk_live_abc123');
      expect(getCallUrl()).toContain('/api/v1/workspaces/current');
      expect(getCallMethod()).toBe('GET');
      expect(getCallAuth()).toBe('ApiKey lsk_live_abc123');
      expect(logOutput.join('\n')).toContain('workspace "Acme" (pro plan)');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ id: 'ws_1', name: 'Acme', plan: 'pro' });
      await run('--json', 'auth', 'token', 'lsk_live_abc123');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.status).toBe('authenticated');
      expect(parsed.name).toBe('Acme');
      expect(parsed.profile).toBeDefined();
    });

    it('saves key even on API error', async () => {
      mockApiError(500, 'INTERNAL', 'Server error');
      const { setConfig } = await import('../../lib/config.js');
      await run('auth', 'token', 'lsk_live_abc123');
      expect(setConfig).toHaveBeenCalledWith({ apiKey: 'lsk_live_abc123' });
    });
  });

  describe('auth status', () => {
    it('shows authenticated status with key hint (API-key fallback)', async () => {
      await run('auth', 'status');
      const out = logOutput.join('\n');
      expect(out).toContain('...');
    });

    it('outputs JSON with --json (API-key mode)', async () => {
      await run('--json', 'auth', 'status');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.authenticated).toBe(true);
      expect(parsed.authMode).toBe('apiKey');
      expect(parsed.keyHint).toBeDefined();
      expect(parsed.configPath).toBeDefined();
    });
  });

  describe('auth whoami', () => {
    it('is registered as an alias for status', () => {
      const sub = authCommand.commands.find((c) => c.name() === 'whoami');
      expect(sub).toBeDefined();
    });
  });

  describe('auth logout', () => {
    it('calls clearConfig', async () => {
      const { clearConfig } = await import('../../lib/config.js');
      vi.mocked(clearConfig).mockClear();
      await run('auth', 'logout');
      expect(clearConfig).toHaveBeenCalled();
    });

    it('outputs JSON with --json', async () => {
      await run('--json', 'auth', 'logout');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.status).toBe('logged_out');
    });
  });

  describe('auth update-profile', () => {
    it('sends PATCH /api/v1/auth/me with name and email', async () => {
      mockApiSuccess({ name: 'Adi', email: 'adi@test.com' });
      await run('auth', 'update-profile', '--name', 'Adi', '--email', 'adi@test.com');
      expect(getCallMethod()).toBe('PATCH');
      expect(getCallUrl()).toContain('/api/v1/auth/me');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.name).toBe('Adi');
      expect(body.email).toBe('adi@test.com');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ name: 'Adi', email: 'adi@test.com' });
      await run('--json', 'auth', 'update-profile', '--name', 'Adi');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.name).toBe('Adi');
    });

    it('errors when neither --name nor --email provided', async () => {
      await run('auth', 'update-profile');
      expect(exitCode).toBe(1);
      expect(errOutput.join('\n')).toContain('MISSING_FIELDS');
    });
  });
});

// =====================================================
// LINKS COMMANDS
// =====================================================
describe('links commands', () => {
  describe('links create', () => {
    it('sends POST /links with url in body', async () => {
      mockApiSuccess({ id: '1', slug: 'test', url: 'https://example.com', shortUrl: 'https://lnk.to/test', status: 'active', totalClicks: 0 });
      await run('links', 'create', 'https://example.com');
      expect(getCallMethod()).toBe('POST');
      expect(getCallUrl()).toContain('links');
      expect(getCallBody()).toEqual({ url: 'https://example.com' });
    });

    it('includes slug and tags in body', async () => {
      mockApiSuccess({ id: '1', slug: 'my-link', url: 'https://example.com' });
      await run('links', 'create', 'https://example.com', '--slug', 'my-link', '--tags', 'docs,api');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.slug).toBe('my-link');
      expect(body.tags).toEqual(['docs', 'api']);
    });

    it('parses duration shorthand for --expires', async () => {
      mockApiSuccess({ id: '1' });
      await run('links', 'create', 'https://example.com', '--expires', '7d');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('includes max-clicks as number', async () => {
      mockApiSuccess({ id: '1' });
      await run('links', 'create', 'https://example.com', '--max-clicks', '100');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.maxClicks).toBe(100);
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ id: '1', slug: 'test', url: 'https://example.com' });
      await run('--json', 'links', 'create', 'https://example.com');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.id).toBe('1');
      expect(parsed.slug).toBe('test');
    });

    it('handles 429 error with exit code 3', async () => {
      mockApiError(429, 'RATE_LIMIT', 'Too many requests');
      await run('links', 'create', 'https://example.com');
      expect(exitCode).toBe(3);
      expect(errOutput.join('\n')).toContain('RATE_LIMIT');
    });

    it('handles 401 error with exit code 2', async () => {
      mockApiError(401, 'AUTH_REQUIRED', 'Invalid API key');
      await run('links', 'create', 'https://example.com');
      expect(exitCode).toBe(2);
    });

    it('handles quota exceeded error with exit code 4', async () => {
      mockApiError(400, 'QUOTA_EXCEEDED', 'Link quota exceeded');
      await run('links', 'create', 'https://example.com');
      expect(exitCode).toBe(4);
    });
  });

  describe('links list', () => {
    it('sends GET /links', async () => {
      mockApiSuccess([], { total: 0, hasMore: false });
      await run('links', 'list');
      expect(getCallMethod()).toBe('GET');
      expect(getCallUrl()).toContain('links');
    });

    it('passes filter params', async () => {
      mockApiSuccess([], { total: 0 });
      await run('links', 'list', '--status', 'active', '--search', 'docs', '--sort', 'totalClicks', '--order', 'asc', '--limit', '50');
      const url = new URL(getCallUrl());
      expect(url.searchParams.get('status')).toBe('active');
      expect(url.searchParams.get('search')).toBe('docs');
      expect(url.searchParams.get('sort')).toBe('totalClicks');
      expect(url.searchParams.get('order')).toBe('asc');
      expect(url.searchParams.get('limit')).toBe('50');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess([{ id: '1', slug: 'test' }], { total: 1, hasMore: false });
      await run('--json', 'links', 'list');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.data).toHaveLength(1);
    });

    it('auto-paginates with --all', async () => {
      mockApiSuccess([{ id: '1', slug: 'a' }], { cursor: 'c1', hasMore: true });
      mockApiSuccess([{ id: '2', slug: 'b' }], { hasMore: false });
      await run('--json', 'links', 'list', '--all');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed).toHaveLength(2);
    });

    it('renders table output', async () => {
      mockApiSuccess([{ slug: 'test', url: 'https://example.com', totalClicks: 42, status: 'active' }], { total: 1, hasMore: false });
      await run('links', 'list');
      const out = logOutput.join('\n');
      expect(out).toContain('SLUG');
      expect(out).toContain('test');
    });
  });

  describe('links get', () => {
    it('sends GET /links/:id', async () => {
      mockApiSuccess({ id: '1', slug: 'test', url: 'https://example.com', status: 'active', totalClicks: 42 });
      await run('links', 'get', 'test');
      expect(getCallMethod()).toBe('GET');
      expect(getCallUrl()).toContain('links/test');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ id: '1', slug: 'test', url: 'https://example.com' });
      await run('--json', 'links', 'get', 'test');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.id).toBe('1');
    });

    it('encodes special characters in ID', async () => {
      mockApiSuccess({ id: 'a/b' });
      await run('links', 'get', 'a/b');
      expect(getCallUrl()).toContain('links/a%2Fb');
    });
  });

  describe('links update', () => {
    it('sends PATCH /links/:id with updated fields', async () => {
      mockApiSuccess({ id: '1', slug: 'new-slug', url: 'https://new.url' });
      await run('links', 'update', 'test', '--slug', 'new-slug', '--url', 'https://new.url');
      expect(getCallMethod()).toBe('PATCH');
      expect(getCallUrl()).toContain('links/test');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.slug).toBe('new-slug');
      expect(body.url).toBe('https://new.url');
    });

    it('sets expiresAt to null for --expires none', async () => {
      mockApiSuccess({ id: '1' });
      await run('links', 'update', 'test', '--expires', 'none');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.expiresAt).toBeNull();
    });

    it('sets maxClicks to null for --max-clicks 0', async () => {
      mockApiSuccess({ id: '1' });
      await run('links', 'update', 'test', '--max-clicks', '0');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.maxClicks).toBeNull();
    });

    it('replaces tags', async () => {
      mockApiSuccess({ id: '1' });
      await run('links', 'update', 'test', '--tags', 'new-tag,second');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.tags).toEqual(['new-tag', 'second']);
    });
  });

  describe('links delete', () => {
    it('sends DELETE /links/:id with --force', async () => {
      mockApiSuccess({ deleted: true });
      await run('links', 'delete', 'test', '--force');
      expect(getCallMethod()).toBe('DELETE');
      expect(getCallUrl()).toContain('links/test');
    });

    it('outputs JSON with --json and --force', async () => {
      mockApiSuccess({ deleted: true });
      await run('--json', 'links', 'delete', 'test', '--force');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.deleted).toBe('test');
    });

    it('aborts without --force in non-TTY', async () => {
      // confirm() returns false in non-TTY → command aborts before API call
      // Add a safety mock in case control flow continues past process.exit
      mockApiSuccess({ deleted: true });
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
      await run('links', 'delete', 'test');
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
      expect(exitCode).toBe(0);
    });
  });

  describe('links bulk', () => {
    it('sends POST /links/bulk with action and ids', async () => {
      mockApiSuccess({ results: [{ id: '1', status: 'success' }, { id: '2', status: 'success' }] });
      await run('links', 'bulk', 'archive', 'id1', 'id2');
      expect(getCallMethod()).toBe('POST');
      expect(getCallUrl()).toContain('links/bulk');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.action).toBe('archive');
      expect(body.ids).toEqual(['id1', 'id2']);
    });

    it('rejects invalid action', async () => {
      await run('links', 'bulk', 'destroy', 'id1');
      expect(exitCode).toBe(1);
      expect(errOutput.join('\n')).toContain('INVALID_ACTION');
    });

    it('requires --tag for tag/untag actions', async () => {
      await run('links', 'bulk', 'tag', 'id1');
      expect(exitCode).toBe(1);
      expect(errOutput.join('\n')).toContain('MISSING_TAG');
    });

    it('errors when no IDs provided', async () => {
      await run('links', 'bulk', 'archive');
      expect(exitCode).toBe(1);
      expect(errOutput.join('\n')).toContain('NO_IDS');
    });

    it('includes tag in body for tag action', async () => {
      mockApiSuccess({ results: [{ id: '1', status: 'success' }] });
      await run('links', 'bulk', 'tag', 'id1', '--tag', 'important');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.action).toBe('tag');
      expect(body.tag).toBe('important');
    });
  });

  describe('links export', () => {
    it('sends GET /links/export with format param', async () => {
      mockApiSuccess('slug,url,clicks\ntest,https://example.com,42');
      await run('links', 'export', '--format', 'json');
      expect(getCallMethod()).toBe('GET');
      const url = new URL(getCallUrl());
      expect(url.searchParams.get('format')).toBe('json');
    });
  });
});

// =====================================================
// STATS COMMANDS
// =====================================================
describe('stats commands', () => {
  describe('stats show', () => {
    it('sends GET /links/:id/stats', async () => {
      mockApiSuccess({ totalClicks: 42, clicksByDay: [] });
      await run('stats', 'show', 'my-link');
      expect(getCallMethod()).toBe('GET');
      expect(getCallUrl()).toContain('links/my-link/stats');
    });

    it('passes --from, --to, --breakdown params', async () => {
      mockApiSuccess({ totalClicks: 0 });
      await run('stats', 'show', 'my-link', '--from', '2026-01-01', '--to', '2026-01-31', '--breakdown', 'country');
      const url = new URL(getCallUrl());
      expect(url.searchParams.get('from')).toBe('2026-01-01');
      expect(url.searchParams.get('to')).toBe('2026-01-31');
      expect(url.searchParams.get('breakdown')).toBe('country');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ totalClicks: 42, clicksByDay: [{ date: '2026-01-15', count: 5 }] });
      await run('--json', 'stats', 'show', 'my-link');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.totalClicks).toBe(42);
    });

    it('renders total clicks and bar chart', async () => {
      mockApiSuccess({
        totalClicks: 10,
        clicksByDay: [
          { date: '2026-01-15', count: 5 },
          { date: '2026-01-16', count: 10 },
        ],
      });
      await run('stats', 'show', 'my-link');
      const out = logOutput.join('\n');
      expect(out).toContain('Total clicks: 10');
      expect(out).toContain('By day:');
      expect(out).toContain('2026-01-15');
    });

    it('handles API error with correct exit code', async () => {
      mockApiError(401, 'AUTH_REQUIRED', 'Invalid API key');
      await run('stats', 'show', 'my-link');
      expect(exitCode).toBe(2);
    });
  });

  describe('stats export', () => {
    it('sends GET /links/:id/stats/export', async () => {
      mockApiSuccess('date,clicks\n2026-01-15,5');
      await run('stats', 'export', 'my-link');
      expect(getCallUrl()).toContain('links/my-link/stats/export');
    });

    it('passes format, from, to params', async () => {
      mockApiSuccess('[]');
      await run('stats', 'export', 'my-link', '--format', 'json', '--from', '2026-01-01', '--to', '2026-01-31');
      const url = new URL(getCallUrl());
      expect(url.searchParams.get('format')).toBe('json');
      expect(url.searchParams.get('from')).toBe('2026-01-01');
    });
  });

  describe('stats workspace', () => {
    it('sends GET /workspace/stats', async () => {
      mockApiSuccess({ links: { total: 10, active: 8, expired: 1, archived: 1 }, totalClicks: 100 });
      await run('stats', 'workspace');
      expect(getCallUrl()).toContain('workspace/stats');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ links: { total: 10 }, totalClicks: 100, topLinks: [] });
      await run('--json', 'stats', 'workspace');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.totalClicks).toBe(100);
    });
  });
});

// =====================================================
// TAGS COMMANDS
// =====================================================
describe('tags commands', () => {
  describe('tags list', () => {
    it('sends GET /tags', async () => {
      mockApiSuccess([{ name: 'docs', count: 5 }, { name: 'api', count: 3 }]);
      await run('tags', 'list');
      expect(getCallMethod()).toBe('GET');
      expect(getCallUrl()).toContain('tags');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess([{ name: 'docs', count: 5 }]);
      await run('--json', 'tags', 'list');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('docs');
    });

    it('renders table with TAG and LINKS columns', async () => {
      mockApiSuccess([{ name: 'docs', count: 5 }]);
      await run('tags', 'list');
      const out = logOutput.join('\n');
      expect(out).toContain('TAG');
      expect(out).toContain('docs');
    });

    it('handles API error', async () => {
      mockApiError(401, 'AUTH_REQUIRED', 'Not authenticated');
      await run('tags', 'list');
      expect(exitCode).toBe(2);
    });
  });
});

// =====================================================
// BILLING COMMANDS
// =====================================================
describe('billing commands', () => {
  describe('billing plan', () => {
    it('sends GET /billing/plan', async () => {
      mockApiSuccess({ plan: 'Free', linksUsed: 5, linksLimit: 25 });
      await run('billing', 'plan');
      expect(getCallUrl()).toContain('billing/plan');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ plan: 'Pro', linksUsed: 10, linksLimit: 1000 });
      await run('--json', 'billing', 'plan');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.plan).toBe('Pro');
    });

    it('shows usage percentage', async () => {
      mockApiSuccess({ plan: 'Free', linksUsed: 20, linksLimit: 25 });
      await run('billing', 'plan');
      const out = logOutput.join('\n');
      expect(out).toContain('80%');
    });
  });

  describe('billing upgrade', () => {
    it('sends POST /billing/checkout', async () => {
      mockApiSuccess({ url: 'https://checkout.stripe.com/pay/cs_123', plan: 'Pro', price: '$9/mo' });
      await run('billing', 'upgrade', '--plan', 'pro');
      expect(getCallMethod()).toBe('POST');
      expect(getCallUrl()).toContain('billing/checkout');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ url: 'https://checkout.stripe.com/pay/cs_123', plan: 'Pro', price: '$9/mo' });
      await run('--json', 'billing', 'upgrade');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.url).toContain('stripe.com');
    });
  });

  describe('billing cancel', () => {
    it('sends POST /billing/cancel with --force', async () => {
      mockApiSuccess({ message: 'Cancelled', activeUntil: '2026-04-01' });
      await run('billing', 'cancel', '--force');
      expect(getCallMethod()).toBe('POST');
      expect(getCallUrl()).toContain('billing/cancel');
    });

    it('aborts without --force in non-TTY', async () => {
      mockApiSuccess({ message: 'Cancelled', activeUntil: '2026-04-01' });
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
      await run('billing', 'cancel');
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
      expect(exitCode).toBe(0);
    });
  });

  describe('billing history', () => {
    it('sends GET /billing/history', async () => {
      mockApiSuccess([{ date: '2026-01-01T00:00:00Z', plan: 'Pro', amount: '$9.00', status: 'paid' }]);
      await run('billing', 'history');
      expect(getCallUrl()).toContain('billing/history');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess([{ date: '2026-01-01T00:00:00Z', plan: 'Pro', amount: '$9.00', status: 'paid' }]);
      await run('--json', 'billing', 'history');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].plan).toBe('Pro');
    });
  });

  describe('billing invoices', () => {
    it('sends GET /api/v1/billing/invoices (no limit)', async () => {
      mockApiSuccess([{ id: 'inv_1', date: '2026-01-01T00:00:00Z', amount: '$9.00', status: 'paid' }]);
      await run('billing', 'invoices');
      expect(getCallMethod()).toBe('GET');
      expect(getCallUrl()).toContain('/api/v1/billing/invoices');
    });

    it('passes --limit as query param', async () => {
      mockApiSuccess([]);
      await run('billing', 'invoices', '--limit', '5');
      const url = new URL(getCallUrl());
      expect(url.searchParams.get('limit')).toBe('5');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess([{ id: 'inv_1', amount: '$9.00' }]);
      await run('--json', 'billing', 'invoices');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed[0].id).toBe('inv_1');
    });
  });

  describe('billing downgrade', () => {
    it('sends POST /api/v1/billing/downgrade with the plan the server reads', async () => {
      mockApiSuccess({ message: 'Downgrade scheduled', activeUntil: '2026-02-01' });
      await run('billing', 'downgrade', 'free');
      expect(getCallMethod()).toBe('POST');
      expect(getCallUrl()).toContain('/api/v1/billing/downgrade');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.plan).toBe('free');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ message: 'ok', planId: 'free' });
      await run('--json', 'billing', 'downgrade', 'free');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.message).toBe('ok');
    });
  });
});

// =====================================================
// KEYS COMMANDS
// =====================================================
describe('keys commands', () => {
  describe('keys list', () => {
    it('sends GET /auth/api-keys', async () => {
      mockApiSuccess([{ name: 'ci-key', keyHint: '...abc123', lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z' }]);
      await run('keys', 'list');
      expect(getCallUrl()).toContain('auth/api-keys');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess([{ name: 'ci-key', keyHint: '...abc123' }]);
      await run('--json', 'keys', 'list');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed[0].name).toBe('ci-key');
    });
  });

  describe('keys create', () => {
    it('sends POST /auth/api-keys with name', async () => {
      mockApiSuccess({ key: 'lsk_live_new_key_full', name: 'deploy', id: 'key-1' });
      await run('keys', 'create', 'deploy');
      expect(getCallMethod()).toBe('POST');
      expect(getCallUrl()).toContain('auth/api-keys');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.name).toBe('deploy');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ key: 'lsk_live_new', name: 'deploy', id: 'key-1' });
      await run('--json', 'keys', 'create', 'deploy');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.key).toBe('lsk_live_new');
    });

    it('shows warning to save key immediately', async () => {
      mockApiSuccess({ key: 'lsk_live_xyz', name: 'ci', id: '1' });
      await run('keys', 'create', 'ci');
      const out = logOutput.join('\n');
      expect(out).toContain('Save this key now');
    });
  });

  describe('keys revoke', () => {
    it('sends DELETE /auth/api-keys/:id with --force', async () => {
      mockApiSuccess({ revoked: true });
      await run('keys', 'revoke', 'key-1', '--force');
      expect(getCallMethod()).toBe('DELETE');
      expect(getCallUrl()).toContain('auth/api-keys/key-1');
    });

    it('outputs JSON with --json and --force', async () => {
      mockApiSuccess({ revoked: true });
      await run('--json', 'keys', 'revoke', 'key-1', '--force');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.revoked).toBe('key-1');
    });

    it('aborts without --force in non-TTY', async () => {
      mockApiSuccess({ revoked: true });
      const origIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
      await run('keys', 'revoke', 'key-1');
      Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, configurable: true });
      expect(exitCode).toBe(0);
    });
  });
});

// =====================================================
// WORKSPACE COMMANDS
// =====================================================
describe('workspace commands', () => {
  describe('workspace show', () => {
    it('sends GET /workspace', async () => {
      mockApiSuccess({ name: 'My Team', slug: 'my-team', plan: 'Pro', memberCount: 3, id: 'ws-1' });
      await run('workspace', 'show');
      expect(getCallUrl()).toContain('workspace');
      expect(getCallMethod()).toBe('GET');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ name: 'My Team', slug: 'my-team', plan: 'Pro' });
      await run('--json', 'workspace', 'show');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.name).toBe('My Team');
    });

    it('renders key-value output', async () => {
      mockApiSuccess({ name: 'My Team', slug: 'my-team', plan: 'Pro', memberCount: 3, createdAt: '2026-01-01T00:00:00Z', id: 'ws-1' });
      await run('workspace', 'show');
      const out = logOutput.join('\n');
      expect(out).toContain('My Team');
      expect(out).toContain('Pro');
    });
  });

  describe('workspace rename', () => {
    it('sends PATCH /workspace with name', async () => {
      mockApiSuccess({ name: 'New Name', slug: 'new-name' });
      await run('workspace', 'rename', 'New Name');
      expect(getCallMethod()).toBe('PATCH');
      expect(getCallUrl()).toContain('workspace');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.name).toBe('New Name');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ name: 'New Name', slug: 'new-name' });
      await run('--json', 'workspace', 'rename', 'New Name');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.name).toBe('New Name');
    });
  });

  describe('workspace members list', () => {
    it('sends GET /api/v1/workspaces/current/members', async () => {
      mockApiSuccess([
        { id: 'm1', email: 'a@test.com', name: 'Alice', role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
      ]);
      await run('workspace', 'members', 'list');
      expect(getCallMethod()).toBe('GET');
      expect(getCallUrl()).toContain('/api/v1/workspaces/current/members');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess([{ id: 'm1', email: 'a@test.com' }]);
      await run('--json', 'workspace', 'members', 'list');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed[0].id).toBe('m1');
    });
  });

  describe('workspace members add', () => {
    it('sends POST /api/v1/workspaces/current/members with email', async () => {
      mockApiSuccess({ id: 'm1', email: 'new@test.com', role: 'member' });
      await run('workspace', 'members', 'add', 'new@test.com');
      expect(getCallMethod()).toBe('POST');
      expect(getCallUrl()).toContain('/api/v1/workspaces/current/members');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.email).toBe('new@test.com');
    });

    it('includes --role in body', async () => {
      mockApiSuccess({ id: 'm2', email: 'a@b.com', role: 'admin' });
      await run('workspace', 'members', 'add', 'a@b.com', '--role', 'admin');
      const body = getCallBody() as Record<string, unknown>;
      expect(body.role).toBe('admin');
    });
  });

  describe('workspace members remove', () => {
    it('sends DELETE /api/v1/workspaces/current/members/:id', async () => {
      mockApiSuccess({ removed: true });
      await run('workspace', 'members', 'remove', 'm1');
      expect(getCallMethod()).toBe('DELETE');
      expect(getCallUrl()).toContain('/api/v1/workspaces/current/members/m1');
    });

    it('outputs JSON with --json', async () => {
      mockApiSuccess({ removed: true });
      await run('--json', 'workspace', 'members', 'remove', 'm1');
      const parsed = JSON.parse(logOutput.join('\n'));
      expect(parsed.removed).toBe('m1');
    });
  });
});

// =====================================================
// HEALTH COMMAND
// =====================================================
describe('health command', () => {
  it('sends GET /health without Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { status: 'healthy', version: '1.0.0', database: 'connected', redis: 'connected', uptime: '5d' } }),
    });
    await run('health');
    expect(getCallUrl()).toContain('health');
    // Health uses direct fetch — no Authorization header
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it('outputs JSON with --json', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { status: 'healthy', version: '1.0.0' } }),
    });
    await run('--json', 'health');
    const parsed = JSON.parse(logOutput.join('\n'));
    expect(parsed.status).toBe('healthy');
  });

  it('renders key-value output with API status, version', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { status: 'healthy', version: '1.0.0', database: 'connected', redis: 'connected', uptime: '5d' } }),
    });
    await run('health');
    const out = logOutput.join('\n');
    expect(out).toContain('healthy');
    expect(out).toContain('1.0.0');
  });

  it('handles non-ok response with exit code 1', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });
    await run('health');
    expect(exitCode).toBe(1);
    expect(errOutput.join('\n')).toContain('503');
  });

  it('handles connection error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await run('health');
    expect(exitCode).toBe(1);
    expect(errOutput.join('\n')).toContain('ECONNREFUSED');
  });
});
