import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Mock fetch globally before any module imports
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock config so resolveApiKey / resolveApiUrl don't touch the filesystem
vi.mock('../../../lib/config.js', () => ({
  resolveApiKey: (opts: { apiKey?: string }) => opts.apiKey ?? 'test-key-123',
  resolveApiUrl: (opts: { apiUrl?: string }) => opts.apiUrl ?? 'https://api.test.com/v1',
  resolveProfile: (opts: { profile?: string }) => opts.profile ?? 'default',
  resolveHuudisIssuer: () => 'https://huudis.test.com',
  resolveHuudisClientId: () => 'linksnap-cli',
  getConfig: () => ({ apiKey: 'test-key-123', apiUrl: 'https://api.test.com/v1' }),
  setConfig: vi.fn(),
  clearConfig: vi.fn(),
  getConfigPath: () => '/home/test/.linksnap/config.json',
  getCredentialsPath: () => '/home/test/.linksnap/credentials',
  getConfigDir: () => '/home/test/.linksnap',
}));

// Mock fs.readFileSync so we don't have to write a real file to disk.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((path: string) => {
      if (typeof path === 'string' && path.includes('missing')) {
        const err = new Error(`ENOENT: no such file '${path}'`) as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      // Fake 4-byte PNG-ish payload
      return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    }),
  };
});

import { qrCommand } from '../../../commands/qr.js';

function resetCommandOpts(cmd: Command): void {
  type CmdInternal = Command & { _optionValues?: Record<string, unknown>; _optionValueSources?: Record<string, string> };
  const internal = cmd as CmdInternal;
  if (internal._optionValues) internal._optionValues = {};
  if (internal._optionValueSources) internal._optionValueSources = {};
  for (const sub of cmd.commands) {
    resetCommandOpts(sub);
  }
}

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
    .exitOverride();
  program.addCommand(qrCommand);
  return program;
}

let logOutput: string[];
let errOutput: string[];
let exitCode: number | undefined;
let program: Command;

beforeEach(() => {
  logOutput = [];
  errOutput = [];
  exitCode = undefined;
  mockFetch.mockReset();
  resetCommandOpts(qrCommand);
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

async function run(...args: string[]): Promise<void> {
  try {
    await program.parseAsync(['node', 'linksnap', ...args]);
  } catch (e) {
    if (e instanceof Error && !e.message.startsWith('EXIT_')) throw e;
  }
}

describe('qr upload-logo', () => {
  it('uploads file via multipart POST /qr-codes/upload-logo, then PATCHes the QR styleConfig', async () => {
    // 1) upload-logo response
    mockApiSuccess({ logoData: 'data:image/png;base64,iVBORw0KGgo=' });
    // 2) GET qr-codes/:id to fetch current styleConfig
    mockApiSuccess({ id: 'qr_abc', slug: 'demo', url: 'https://e.co', styleConfig: { foregroundColor: '#000' } });
    // 3) PATCH qr-codes/:id with merged styleConfig
    mockApiSuccess({ id: 'qr_abc', slug: 'demo', url: 'https://e.co', styleConfig: { foregroundColor: '#000', logoType: 'upload', logoData: 'data:image/png;base64,iVBORw0KGgo=' } });

    await run('qr', 'upload-logo', 'qr_abc', '/tmp/test-logo.png');

    expect(mockFetch).toHaveBeenCalledTimes(3);

    // --- Call 1: multipart upload ---
    const [uploadUrl, uploadInit] = mockFetch.mock.calls[0];
    expect(String(uploadUrl)).toBe('https://api.test.com/v1/qr-codes/upload-logo');
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.headers.Authorization).toBe('Bearer test-key-123');
    // No JSON Content-Type — fetch + FormData sets multipart boundary itself
    expect(uploadInit.headers['Content-Type']).toBeUndefined();
    // The body is a FormData with field name "logo" carrying the file content
    expect(uploadInit.body).toBeInstanceOf(FormData);
    const fd = uploadInit.body as FormData;
    const logoEntry = fd.get('logo');
    expect(logoEntry).toBeInstanceOf(Blob);
    const blob = logoEntry as Blob;
    expect(blob.type).toBe('image/png');
    // The file bytes from our fs mock should be in the blob
    const arr = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(arr)).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // --- Call 2: GET qr-codes/:id ---
    expect(String(mockFetch.mock.calls[1][0])).toContain('/qr-codes/qr_abc');
    expect(mockFetch.mock.calls[1][1].method).toBe('GET');

    // --- Call 3: PATCH qr-codes/:id with merged styleConfig ---
    expect(String(mockFetch.mock.calls[2][0])).toContain('/qr-codes/qr_abc');
    expect(mockFetch.mock.calls[2][1].method).toBe('PATCH');
    const patchBody = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(patchBody.styleConfig).toEqual({
      foregroundColor: '#000',
      logoType: 'upload',
      logoData: 'data:image/png;base64,iVBORw0KGgo=',
    });
  });

  it('detects MIME from .jpg extension', async () => {
    mockApiSuccess({ logoData: 'data:image/jpeg;base64,xxx' });
    mockApiSuccess({ id: 'qr_1', styleConfig: {} });
    mockApiSuccess({ id: 'qr_1', styleConfig: { logoType: 'upload', logoData: 'data:image/jpeg;base64,xxx' } });

    await run('qr', 'upload-logo', 'qr_1', '/tmp/photo.jpg');

    const fd = mockFetch.mock.calls[0][1].body as FormData;
    const blob = fd.get('logo') as Blob;
    expect(blob.type).toBe('image/jpeg');
  });

  it('detects MIME from .svg extension', async () => {
    mockApiSuccess({ logoData: 'data:image/svg+xml;base64,xxx' });
    mockApiSuccess({ id: 'qr_1', styleConfig: {} });
    mockApiSuccess({ id: 'qr_1', styleConfig: {} });

    await run('qr', 'upload-logo', 'qr_1', '/tmp/icon.svg');

    const fd = mockFetch.mock.calls[0][1].body as FormData;
    const blob = fd.get('logo') as Blob;
    expect(blob.type).toBe('image/svg+xml');
  });

  it('outputs JSON with --json', async () => {
    mockApiSuccess({ logoData: 'data:image/png;base64,xxx' });
    mockApiSuccess({ id: 'qr_1', styleConfig: {} });
    mockApiSuccess({ id: 'qr_1', slug: 'x', styleConfig: { logoType: 'upload', logoData: 'data:image/png;base64,xxx' } });

    await run('--json', 'qr', 'upload-logo', 'qr_1', '/tmp/logo.png');

    const parsed = JSON.parse(logOutput.join('\n'));
    expect(parsed.id).toBe('qr_1');
    expect(parsed.styleConfig.logoType).toBe('upload');
  });

  it('handles 403 (plan gate) with exit code 2', async () => {
    mockApiError(403, 'FORBIDDEN', 'QR logo is available on Pro and Business plans only');
    await run('qr', 'upload-logo', 'qr_1', '/tmp/logo.png');
    expect(exitCode).toBe(2);
    expect(errOutput.join('\n')).toContain('FORBIDDEN');
  });

  it('handles 422 (bad mime / oversize) with exit code 1', async () => {
    mockApiError(422, 'VALIDATION_ERROR', 'Only PNG, JPG, and SVG files are allowed');
    await run('qr', 'upload-logo', 'qr_1', '/tmp/logo.png');
    expect(exitCode).toBe(1);
    expect(errOutput.join('\n')).toContain('VALIDATION_ERROR');
  });

  it('reports FILE_NOT_FOUND when the local file is missing', async () => {
    await run('qr', 'upload-logo', 'qr_1', '/tmp/missing.png');
    expect(exitCode).toBe(1);
    expect(errOutput.join('\n')).toContain('FILE_NOT_FOUND');
    // No HTTP call should have been made
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles 401 (auth) on upload with exit code 2', async () => {
    mockApiError(401, 'AUTH_REQUIRED', 'Invalid API key');
    await run('qr', 'upload-logo', 'qr_1', '/tmp/logo.png');
    expect(exitCode).toBe(2);
  });
});
