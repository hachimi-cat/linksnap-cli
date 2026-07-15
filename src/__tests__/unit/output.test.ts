import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTable, formatJson, formatKeyValue, output, errorOutput } from '../../lib/output.js';

// Disable chalk colors for predictable test output
vi.mock('chalk', () => ({
  default: {
    dim: (s: string) => s,
  },
}));

describe('formatTable', () => {
  it('returns "No results." for empty data', () => {
    const result = formatTable([], [{ key: 'id', label: 'ID' }]);
    expect(result).toBe('  No results.');
  });

  it('renders header and rows', () => {
    const data = [
      { slug: 'docs', url: 'https://example.com', clicks: 42 },
      { slug: 'api', url: 'https://api.example.com', clicks: 7 },
    ];
    const columns = [
      { key: 'slug', label: 'SLUG' },
      { key: 'url', label: 'URL' },
      { key: 'clicks', label: 'CLICKS', align: 'right' as const },
    ];
    const result = formatTable(data, columns);
    const lines = result.split('\n');
    expect(lines.length).toBe(3); // header + 2 rows
    expect(lines[0]).toContain('SLUG');
    expect(lines[0]).toContain('URL');
    expect(lines[1]).toContain('docs');
    expect(lines[2]).toContain('api');
  });

  it('uses column format function', () => {
    const data = [{ count: 0 }];
    const columns = [
      { key: 'count', label: 'COUNT', format: (v: unknown) => String(v ?? 'N/A') },
    ];
    const result = formatTable(data, columns);
    expect(result).toContain('0');
  });

  it('renders dash for missing values', () => {
    const data = [{ slug: 'test' }];
    const columns = [
      { key: 'slug', label: 'SLUG' },
      { key: 'url', label: 'URL' },
    ];
    const result = formatTable(data, columns);
    expect(result).toContain('—');
  });
});

describe('formatJson', () => {
  it('returns pretty-printed JSON', () => {
    const result = formatJson({ id: '1', name: 'test' });
    expect(result).toBe(JSON.stringify({ id: '1', name: 'test' }, null, 2));
  });

  it('handles arrays', () => {
    const result = formatJson([1, 2, 3]);
    expect(result).toBe('[\n  1,\n  2,\n  3\n]');
  });
});

describe('formatKeyValue', () => {
  it('renders aligned key-value pairs', () => {
    const result = formatKeyValue([
      ['Name', 'My Workspace'],
      ['Plan', 'Pro'],
    ]);
    const lines = result.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain('Name');
    expect(lines[0]).toContain('My Workspace');
    expect(lines[1]).toContain('Plan');
    expect(lines[1]).toContain('Pro');
  });
});

describe('output', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('outputs nothing in quiet mode', () => {
    output('hello', { quiet: true });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('outputs JSON with --json flag', () => {
    output({ data: { id: '1' } }, { json: true });
    expect(logSpy).toHaveBeenCalledOnce();
    const outputStr = logSpy.mock.calls[0][0] as string;
    expect(JSON.parse(outputStr)).toEqual({ id: '1' });
  });

  it('extracts .data when outputting JSON', () => {
    output({ data: [1, 2, 3] }, { json: true });
    const outputStr = logSpy.mock.calls[0][0] as string;
    expect(JSON.parse(outputStr)).toEqual([1, 2, 3]);
  });

  it('outputs string directly in normal mode', () => {
    output('Hello world', {});
    expect(logSpy).toHaveBeenCalledWith('Hello world');
  });
});

describe('errorOutput', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('outputs JSON error with --json', () => {
    errorOutput({ code: 'NOT_FOUND', message: 'Link not found' }, { json: true });
    expect(errSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(parsed.error.code).toBe('NOT_FOUND');
    expect(parsed.error.message).toBe('Link not found');
  });

  it('outputs human-readable error without --json', () => {
    errorOutput({ code: 'NOT_FOUND', message: 'Link not found' }, {});
    expect(errSpy).toHaveBeenCalledTimes(2);
    expect(errSpy.mock.calls[0][0]).toBe('Error: NOT_FOUND');
    expect(errSpy.mock.calls[1][0]).toBe('       Link not found');
  });
});
