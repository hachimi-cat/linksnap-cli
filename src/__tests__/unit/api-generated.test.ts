import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// `linksnap api <area> <action>`: every feature route, generated from the API spec.
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

vi.mock('../../lib/config.js', () => ({
  resolveApiKey: (opts: { apiKey?: string }) => opts.apiKey ?? 'lsk_live_test',
  resolveApiUrl: (opts: { apiUrl?: string }) => opts.apiUrl ?? 'https://linksnap.test/api/v1',
}));

import { buildApiCommand, API_ROUTES } from '../../commands/api.generated.js';

// The program's global options, as in index.ts.
function createProgram(): Command {
  return new Command()
    .name('linksnap')
    .option('-j, --json', 'Output raw JSON')
    .option('-q, --quiet', 'Suppress all output except errors')
    .option('-v, --verbose', 'Show request/response details')
    .option('--api-key <key>', 'Override API key for this invocation')
    .option('--api-url <url>', 'Override API base URL')
    .option('--profile <name>', 'Credentials profile')
    .exitOverride()
    .addCommand(buildApiCommand());
}

let logOutput: string[];
let errOutput: string[];
let exitCode: number | undefined;

beforeEach(() => {
  logOutput = [];
  errOutput = [];
  exitCode = undefined;
  mockFetch.mockReset();
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logOutput.push(args.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errOutput.push(args.map(String).join(' ')); });
  // The real process.exit ends the process; record the first code and stop here.
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    exitCode ??= Number(code ?? 0);
    throw new Error(`EXIT_${code}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function reply(data: unknown, meta: Record<string, unknown> = { requestId: 'r' }) {
  const envelope = { data, error: null, meta };
  mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(envelope) });
}

async function run(args: string[]): Promise<void> {
  await createProgram().parseAsync(['node', 'linksnap', ...args]).catch(() => undefined);
}

const call = (i = 0) => ({
  url: mockFetch.mock.calls[i][0] as string,
  method: mockFetch.mock.calls[i][1].method as string,
  auth: mockFetch.mock.calls[i][1].headers.Authorization as string,
  body: mockFetch.mock.calls[i][1].body ? JSON.parse(mockFetch.mock.calls[i][1].body) : undefined,
});

describe('linksnap api', () => {
  it('has a command for every feature route', () => {
    const count = API_ROUTES.reduce((n, a) => n + a.routes.length, 0);
    expect(count).toBeGreaterThanOrEqual(50);
    expect(API_ROUTES.map((a) => a.area)).toEqual(expect.arrayContaining(['links', 'qr-codes', 'domains', 'workspaces']));
  });

  it('creates a link from flags, with the CLI credentials', async () => {
    reply({ id: 'l_1', slug: 'spring' });
    // The backend validates no schema, so the spec has no field types: a flag is sent as
    // text, and a list goes in --body-json (flags given alongside override it).
    await run(['api', 'links', 'create', '--body-json', '{"tags":["promo"],"slug":"x"}', '--url', 'https://example.com', '--slug', 'spring']);
    expect(exitCode).toBe(0);
    expect(call()).toEqual({
      url: 'https://linksnap.test/api/v1/links',
      method: 'POST',
      // lib/api.ts's own header, as every other command sends it: the key as the server reads it.
      auth: 'ApiKey lsk_live_test',
      body: { url: 'https://example.com', slug: 'spring', tags: ['promo'] },
    });
    expect(JSON.parse(logOutput.join('\n'))).toEqual({ id: 'l_1', slug: 'spring' });
  });

  it('puts path parameters in the path and query fields in the query, and keeps a list cursor', async () => {
    reply({ id: 'l_1' });
    await run(['api', 'links', 'get', 'a b']);
    expect(call(0).url).toBe('https://linksnap.test/api/v1/links/a%20b');
    expect(call(0).body).toBeUndefined();

    logOutput = [];
    exitCode = undefined;
    reply([{ id: 'l_1' }], { requestId: 'r', cursor: 'c2', hasMore: true });
    await run(['api', 'links', 'list', '--limit', '5', '--tag', 'promo']);
    expect(exitCode).toBe(0);
    const listed = new URL(call(1).url);
    expect(listed.pathname).toBe('/api/v1/links');
    expect(Object.fromEntries(listed.searchParams)).toEqual({ limit: '5', tag: 'promo' });
    expect(JSON.parse(logOutput.join('\n')).meta).toMatchObject({ cursor: 'c2', hasMore: true });
  });

  it('reports the API refusal with the CLI exit codes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked API key' } }),
    });
    await run(['api', 'tags', 'list']);
    expect(exitCode).toBe(2);
    expect(errOutput.join('\n')).toContain('UNAUTHORIZED');
  });

  it('refuses a body that is not valid JSON before calling', async () => {
    await run(['api', 'qr-codes', 'create', '--body-json', '{not json']);
    expect(exitCode).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
