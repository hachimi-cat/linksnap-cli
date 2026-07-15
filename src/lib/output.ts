import chalk from 'chalk';

export interface Column {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'right';
  format?: (value: unknown) => string;
}

export function formatTable(data: Record<string, unknown>[], columns: Column[]): string {
  if (data.length === 0) return '  No results.';

  const widths = columns.map((col) => {
    const values = data.map((row) => {
      const val = col.format ? col.format(row[col.key]) : String(row[col.key] ?? '—');
      return val.length;
    });
    return Math.max(col.label.length, ...values);
  });

  const header = columns
    .map((col, i) => chalk.dim(col.label.padEnd(widths[i])))
    .join('  ');

  const rows = data.map((row) =>
    columns
      .map((col, i) => {
        const val = col.format ? col.format(row[col.key]) : String(row[col.key] ?? '—');
        return col.align === 'right' ? val.padStart(widths[i]) : val.padEnd(widths[i]);
      })
      .join('  ')
  );

  return ['  ' + header, ...rows.map((r) => '  ' + r)].join('\n');
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatKeyValue(pairs: [string, string][]): string {
  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
  return pairs
    .map(([key, value]) => `  ${chalk.dim(key.padEnd(maxKeyLen))}  ${value}`)
    .join('\n');
}

export function output(data: unknown, opts: { json?: boolean; quiet?: boolean }): void {
  if (opts.quiet) return;

  if (opts.json) {
    const jsonData = typeof data === 'object' && data !== null && 'data' in data
      ? (data as { data: unknown }).data
      : data;
    console.log(formatJson(jsonData));
    return;
  }

  if (typeof data === 'string') {
    console.log(data);
  }
}

export function errorOutput(
  error: { code: string; message: string },
  opts: { json?: boolean }
): void {
  if (opts.json) {
    console.error(JSON.stringify({ error }, null, 2));
  } else {
    console.error(`Error: ${error.code}`);
    console.error(`       ${error.message}`);
  }
}
