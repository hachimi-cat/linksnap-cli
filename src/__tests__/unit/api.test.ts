import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, ApiRequestError } from '../../lib/api.js';

// Mock config module
vi.mock('../../lib/config.js', () => ({
  resolveApiKey: (opts: { apiKey?: string }) => opts.apiKey ?? 'test-key-123',
  resolveApiUrl: (opts: { apiUrl?: string }) => opts.apiUrl ?? 'https://api.test.com/v1',
  resolveProfile: (opts: { profile?: string }) => opts.profile ?? 'default',
  // No `linksnap auth login` session here: lib/credentials.ts falls through to the key.
  getCredentialsPath: () => '/nonexistent/.linksnap/credentials',
}));

describe('ApiRequestError', () => {
  it('maps 401 to exit code 2', () => {
    const err = new ApiRequestError(401, { code: 'AUTH_REQUIRED', message: 'Not authenticated' });
    expect(err.exitCode).toBe(2);
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe('AUTH_REQUIRED');
  });

  it('maps 403 to exit code 2', () => {
    const err = new ApiRequestError(403, { code: 'FORBIDDEN', message: 'Forbidden' });
    expect(err.exitCode).toBe(2);
  });

  it('maps 429 to exit code 3', () => {
    const err = new ApiRequestError(429, { code: 'RATE_LIMIT', message: 'Too many requests' });
    expect(err.exitCode).toBe(3);
  });

  it('maps QUOTA_EXCEEDED to exit code 4', () => {
    const err = new ApiRequestError(400, { code: 'QUOTA_EXCEEDED', message: 'Quota exceeded' });
    expect(err.exitCode).toBe(4);
  });

  it('maps other errors to exit code 1', () => {
    const err = new ApiRequestError(500, { code: 'INTERNAL_ERROR', message: 'Server error' });
    expect(err.exitCode).toBe(1);
  });

  it('stores details', () => {
    const details = { currentUsage: 50, limit: 50 };
    const err = new ApiRequestError(400, { code: 'QUOTA_EXCEEDED', message: 'Quota exceeded', details });
    expect(err.details).toEqual(details);
  });
});

describe('apiRequest', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends GET with correct URL, method, and headers', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: '1' } }),
    });

    await apiRequest('GET', 'links', { apiKey: 'my-key' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.test.com/v1/links');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer my-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.body).toBeUndefined();
  });

  it('sends a LinkSnap API key as `ApiKey <key>`, which the server reads', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { id: '1' } }),
    });
    await apiRequest('GET', 'links', { apiKey: 'lsk_live_abc' });
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('ApiKey lsk_live_abc');
  });

  it('sends POST with JSON body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { id: '1' } }),
    });

    await apiRequest('POST', 'links', { apiKey: 'k', body: { url: 'https://example.com' } });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com' });
  });

  it('appends query params', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    await apiRequest('GET', 'links', { apiKey: 'k', params: { status: 'active', limit: '10' } });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('status')).toBe('active');
    expect(parsed.searchParams.get('limit')).toBe('10');
  });

  it('skips empty and undefined params', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });

    await apiRequest('GET', 'links', { apiKey: 'k', params: { status: '', cursor: undefined as unknown as string } });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.searchParams.has('status')).toBe(false);
  });

  it('returns data and meta', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: '1' }], meta: { total: 42, hasMore: true, cursor: 'abc' } }),
    });

    const result = await apiRequest('GET', 'links', { apiKey: 'k' });
    expect(result.data).toEqual([{ id: '1' }]);
    expect(result.meta?.total).toBe(42);
    expect(result.meta?.hasMore).toBe(true);
    expect(result.meta?.cursor).toBe('abc');
  });

  it('throws ApiRequestError on 401', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: { code: 'AUTH_REQUIRED', message: 'Invalid API key' } }),
    });

    await expect(apiRequest('GET', 'links', { apiKey: 'bad-key' })).rejects.toThrow(ApiRequestError);

    try {
      await apiRequest('GET', 'links', { apiKey: 'bad-key' });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      const apiErr = err as ApiRequestError;
      expect(apiErr.statusCode).toBe(401);
      expect(apiErr.errorCode).toBe('AUTH_REQUIRED');
      expect(apiErr.exitCode).toBe(2);
    }
  });

  it('throws ApiRequestError on 429', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: () => Promise.resolve({ error: { code: 'RATE_LIMIT', message: 'Rate limit exceeded' } }),
    });

    try {
      await apiRequest('GET', 'links', { apiKey: 'k' });
    } catch (err) {
      const apiErr = err as ApiRequestError;
      expect(apiErr.exitCode).toBe(3);
    }
  });

  it('handles non-JSON error responses gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.reject(new Error('not json')),
    });

    try {
      await apiRequest('GET', 'links', { apiKey: 'k' });
    } catch (err) {
      const apiErr = err as ApiRequestError;
      expect(apiErr.statusCode).toBe(502);
      expect(apiErr.errorCode).toBe('UNKNOWN_ERROR');
      expect(apiErr.message).toBe('Bad Gateway');
    }
  });

  it('throws AUTH_REQUIRED when no API key is resolved', async () => {
    // Re-mock to return null
    const configMod = await import('../../lib/config.js');
    const origResolve = configMod.resolveApiKey;
    vi.spyOn(configMod, 'resolveApiKey').mockReturnValue(null);

    try {
      await apiRequest('GET', 'links', {});
    } catch (err) {
      const apiErr = err as ApiRequestError;
      expect(apiErr.errorCode).toBe('AUTH_REQUIRED');
      expect(apiErr.exitCode).toBe(2);
    }

    vi.mocked(configMod.resolveApiKey).mockRestore();
  });

  it('logs to stderr in verbose mode', async () => {
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    });

    await apiRequest('GET', 'links', { apiKey: 'k', verbose: true });

    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy.mock.calls[0][0]).toMatch(/^GET.*links.*→ (undefined|\d+)/);
    stderrSpy.mockRestore();
  });
});
