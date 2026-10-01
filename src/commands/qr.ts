import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { apiRequest, apiDownload, ApiRequestError, authorizationHeader } from '../lib/api.js';
import { resolveApiKey, resolveApiUrl } from '../lib/config.js';
import { formatTable, formatKeyValue, formatJson, errorOutput } from '../lib/output.js';

function getGlobalOpts(cmd: Command) {
  return cmd.optsWithGlobals() as {
    json?: boolean; quiet?: boolean; verbose?: boolean;
    apiKey?: string; apiUrl?: string;
  };
}

function apiOpts(globalOpts: ReturnType<typeof getGlobalOpts>) {
  return { apiKey: globalOpts.apiKey, apiUrl: globalOpts.apiUrl, verbose: globalOpts.verbose };
}

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`  ${message} [y/N]: `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

function formatQrDetail(qr: Record<string, unknown>): string {
  return formatKeyValue([
    ['Scan URL', String(qr.scanUrl ?? '')],
    ['URL', String(qr.url ?? '')],
    ['Title', String(qr.title ?? '—')],
    ['Slug', String(qr.slug ?? '')],
    ['Watermark', String(qr.watermark ?? '—')],
    ['Total Scans', String(qr.totalScans ?? 0)],
    ['Created', String(qr.createdAt ?? '').replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC')],
    ['ID', String(qr.id ?? '')],
  ]);
}

function formatQrTable(data: Record<string, unknown>[]): string {
  return formatTable(data, [
    { key: 'slug', label: 'SLUG', width: 12 },
    { key: 'url', label: 'URL', width: 45 },
    { key: 'totalScans', label: 'SCANS', align: 'right', format: (v) => String(v ?? 0) },
    { key: 'title', label: 'TITLE', format: (v) => String(v ?? '—') },
    {
      key: 'createdAt', label: 'CREATED',
      format: (v) => v ? String(v).split('T')[0] : '—',
    },
  ]);
}

export const qrCommand = new Command('qr')
  .description('QR code management commands');

// --- qr create ---
qrCommand
  .command('create <url>')
  .description('Create a QR code')
  .option('--title <title>', 'QR code title')
  .option('--color <hex>', 'Foreground color (hex)')
  .option('--bg-color <hex>', 'Background color (hex)')
  .option('--pattern <pattern>', 'Pattern: square, dots, rounded, classy')
  .option('--corners <corners>', 'Corners: square, rounded, dots')
  .option('--frame <frame>', 'Frame: none, border, rounded-border, badge')
  .option('--link-id <id>', 'Associate with an existing link')
  .action(async (url: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const body: Record<string, unknown> = { url };
      if (opts.title) body.title = opts.title;
      if (opts.linkId) body.linkId = opts.linkId;

      const styleConfig: Record<string, string> = { errorCorrection: 'H' };
      if (opts.color) styleConfig.foregroundColor = opts.color;
      if (opts.bgColor) styleConfig.backgroundColor = opts.bgColor;
      if (opts.pattern) styleConfig.pattern = opts.pattern;
      if (opts.corners) styleConfig.corners = opts.corners;
      if (opts.frame) styleConfig.frame = opts.frame;
      body.styleConfig = styleConfig;

      const response = await apiRequest<Record<string, unknown>>('POST', 'qr-codes', {
        ...apiOpts(globalOpts),
        body,
      });

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(formatQrDetail(response.data));
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        errorOutput({ code: err.errorCode, message: err.message }, globalOpts);
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

// --- qr list ---
qrCommand
  .command('list')
  .description('List QR codes in the current workspace')
  .option('--search <q>', 'Search by slug or URL')
  .option('--limit <n>', 'Items per page (default 20, max 100)', parseInt)
  .option('--cursor <cursor>', 'Pagination cursor from previous response')
  .option('--all', 'Fetch all pages (auto-paginate)')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const params: Record<string, string> = {};
      if (opts.search) params.search = opts.search;
      if (opts.limit) params.limit = String(opts.limit);
      if (opts.cursor) params.cursor = opts.cursor;

      if (opts.all) {
        const allData: Record<string, unknown>[] = [];
        let cursor: string | undefined = opts.cursor;
        let hasMore = true;

        while (hasMore) {
          const pageParams = { ...params };
          if (cursor) pageParams.cursor = cursor;

          const response = await apiRequest<Record<string, unknown>[]>('GET', 'qr-codes', {
            ...apiOpts(globalOpts),
            params: pageParams,
          });

          allData.push(...response.data);
          cursor = response.meta?.cursor;
          hasMore = response.meta?.hasMore ?? false;
        }

        if (globalOpts.json) {
          console.log(formatJson(allData));
        } else if (!globalOpts.quiet) {
          console.log(formatQrTable(allData));
          console.log('');
          console.log(`  ${allData.length} QR codes total.`);
        }
      } else {
        const response = await apiRequest<Record<string, unknown>[]>('GET', 'qr-codes', {
          ...apiOpts(globalOpts),
          params,
        });

        if (globalOpts.json) {
          console.log(formatJson({ data: response.data, meta: response.meta }));
        } else if (!globalOpts.quiet) {
          console.log(formatQrTable(response.data));
          if (response.meta?.hasMore) {
            console.log('');
            console.log(`  Showing ${response.data.length} of ${response.meta.total ?? '?'} QR codes. Next cursor: ${response.meta.cursor}`);
          }
        }
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        errorOutput({ code: err.errorCode, message: err.message }, globalOpts);
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

// --- qr get ---
qrCommand
  .command('get <id>')
  .description('Get a single QR code by ID')
  .action(async (id: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>>('GET', `qr-codes/${encodeURIComponent(id)}`, apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(formatQrDetail(response.data));
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        errorOutput({ code: err.errorCode, message: err.message }, globalOpts);
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

// --- qr download ---
qrCommand
  .command('download <id>')
  .description('Download QR code image')
  .option('--format <format>', 'Image format: png or svg', 'png')
  .option('-o, --output <path>', 'Output file path')
  .action(async (id: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      // First get QR details for the slug (used in default filename)
      const qrResponse = await apiRequest<Record<string, unknown>>('GET', `qr-codes/${encodeURIComponent(id)}`, apiOpts(globalOpts));
      const slug = String(qrResponse.data.slug ?? id);
      const outputPath = opts.output ?? `qr-${slug}.${opts.format}`;

      const buffer = await apiDownload('GET', `qr-codes/${encodeURIComponent(id)}/download`, {
        ...apiOpts(globalOpts),
        params: { format: opts.format },
      });

      const { writeFileSync } = await import('node:fs');
      writeFileSync(outputPath, buffer);

      if (!globalOpts.quiet) {
        console.log(`  Downloaded to ${outputPath}`);
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        errorOutput({ code: err.errorCode, message: err.message }, globalOpts);
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

// --- qr stats ---
qrCommand
  .command('stats <id>')
  .description('Show QR scan analytics')
  .option('--from <date>', 'Start date (ISO 8601)')
  .option('--to <date>', 'End date (ISO 8601)')
  .option('--breakdown <field>', 'Breakdown: day, country, device, browser, os, referrer')
  .action(async (id: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const params: Record<string, string> = {};
      if (opts.from) params.from = opts.from;
      if (opts.to) params.to = opts.to;
      if (opts.breakdown) params.breakdown = opts.breakdown;

      const response = await apiRequest<Record<string, unknown>>(
        'GET', `qr-codes/${encodeURIComponent(id)}/stats`,
        { ...apiOpts(globalOpts), params }
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const data = response.data;

        if (opts.breakdown) {
          const items = data[opts.breakdown] as Array<Record<string, unknown>> | undefined;
          if (items && items.length > 0) {
            const labelKey = Object.keys(items[0]).find(k => k !== 'count') ?? 'label';
            console.log(formatTable(items, [
              { key: labelKey, label: labelKey.toUpperCase(), width: 20 },
              { key: 'count', label: 'SCANS', align: 'right', format: (v) => String(v ?? 0) },
            ]));
          } else {
            console.log('  No data for this breakdown.');
          }
        } else {
          console.log(`  QR scan stats for ${id}`);
          console.log('');
          console.log(`  Total scans: ${data.totalScans ?? 0}`);

          const byCountry = data.scansByCountry as Array<{ country: string; count: number }> | undefined;
          if (byCountry && byCountry.length > 0) {
            const total = Number(data.totalScans ?? 0);
            console.log('');
            console.log('  Top countries:');
            for (const item of byCountry.slice(0, 5)) {
              const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
              console.log(`    ${item.country}  ${item.count} (${pct}%)`);
            }
          }

          const byDevice = data.scansByDevice as Array<{ device: string; count: number }> | undefined;
          if (byDevice && byDevice.length > 0) {
            console.log('');
            console.log('  Top devices:');
            for (const item of byDevice.slice(0, 5)) {
              console.log(`    ${item.device}  ${item.count}`);
            }
          }
        }
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        errorOutput({ code: err.errorCode, message: err.message }, globalOpts);
        process.exit(err.exitCode);
      }
      throw err;
    }
  });

// --- qr upload-logo ---
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function detectMime(file: string): string {
  const ext = extname(file).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

qrCommand
  .command('upload-logo <id> <file>')
  .description('Upload a center logo image (PNG/JPG/SVG) onto a QR code (Pro/Business only)')
  .action(async (id: string, file: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      // Read file from disk and detect MIME from extension.
      const buffer = readFileSync(file);
      const mime = detectMime(file);
      const filename = basename(file);

      // Resolve API URL + key directly — multipart bypasses the JSON-only
      // SDK ApiClient and the hand-rolled apiRequest helper.
      const baseUrl = resolveApiUrl({ apiUrl: globalOpts.apiUrl });
      const apiKey = resolveApiKey({ apiKey: globalOpts.apiKey });
      if (!apiKey) {
        throw new ApiRequestError(401, {
          code: 'AUTH_REQUIRED',
          message: 'Not authenticated. Run `linksnap auth login` or `linksnap auth token <key>` first.',
        });
      }
      const uploadUrl = new URL('qr-codes/upload-logo', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString();

      // Native FormData + Blob. The backend's multer config expects the field
      // named "logo" (see backend/src/routes/qr-codes.ts).
      const form = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mime });
      form.append('logo', blob, filename);

      const start = Date.now();
      const uploadResp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: authorizationHeader(apiKey), Accept: 'application/json' },
        body: form,
      });
      if (globalOpts.verbose) {
        console.error(`POST ${uploadUrl} -> ${uploadResp.status} (${Date.now() - start}ms)`);
      }
      if (!uploadResp.ok) {
        let errBody: { error?: { code: string; message: string } } = {};
        try { errBody = await uploadResp.json() as typeof errBody; } catch { /* noop */ }
        throw new ApiRequestError(uploadResp.status, errBody.error ?? {
          code: 'UNKNOWN_ERROR', message: uploadResp.statusText,
        });
      }
      const uploadBody = (await uploadResp.json()) as { data: { logoData: string } };
      const logoData = uploadBody.data.logoData;

      // Fetch the current QR to preserve existing styleConfig fields, then
      // PATCH with the new logo embedded.
      const current = await apiRequest<Record<string, unknown>>(
        'GET', `qr-codes/${encodeURIComponent(id)}`, apiOpts(globalOpts),
      );
      const existingStyle = (current.data.styleConfig as Record<string, unknown> | undefined) ?? {};
      const nextStyle = { ...existingStyle, logoType: 'upload', logoData };

      const patched = await apiRequest<Record<string, unknown>>(
        'PATCH', `qr-codes/${encodeURIComponent(id)}`,
        { ...apiOpts(globalOpts), body: { styleConfig: nextStyle } },
      );

      if (globalOpts.json) {
        console.log(formatJson(patched.data));
      } else if (!globalOpts.quiet) {
        console.log(`  Uploaded ${filename} (${buffer.length} bytes, ${mime}) to QR ${id}`);
        console.log(formatQrDetail(patched.data));
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        errorOutput({ code: err.errorCode, message: err.message }, globalOpts);
        process.exit(err.exitCode);
      }
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        errorOutput({ code: 'FILE_NOT_FOUND', message: `File not found: ${file}` }, globalOpts);
        process.exit(1);
      }
      throw err;
    }
  });

// --- qr delete ---
qrCommand
  .command('delete <id>')
  .description('Permanently delete a QR code')
  .option('--force', 'Skip confirmation prompt')
  .action(async (id: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      if (!opts.force) {
        const confirmed = await confirm(`Delete QR code "${id}"? This is irreversible.`);
        if (!confirmed) {
          if (!globalOpts.quiet) console.log('  Aborted.');
          process.exit(0);
        }
      }

      await apiRequest('DELETE', `qr-codes/${encodeURIComponent(id)}`, apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson({ deleted: id }));
      } else if (!globalOpts.quiet) {
        console.log(`  Deleted ${id}`);
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        errorOutput({ code: err.errorCode, message: err.message }, globalOpts);
        process.exit(err.exitCode);
      }
      throw err;
    }
  });
