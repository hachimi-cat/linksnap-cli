import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { apiRequest, ApiRequestError } from '../lib/api.js';
import { formatTable, formatKeyValue, formatJson, output, errorOutput } from '../lib/output.js';

function getGlobalOpts(cmd: Command) {
  return cmd.optsWithGlobals() as {
    json?: boolean; quiet?: boolean; verbose?: boolean;
    apiKey?: string; apiUrl?: string;
  };
}

function apiOpts(globalOpts: ReturnType<typeof getGlobalOpts>) {
  return { apiKey: globalOpts.apiKey, apiUrl: globalOpts.apiUrl, verbose: globalOpts.verbose };
}

function parseDuration(input: string): string | undefined {
  if (input === 'none') return 'none';
  // ISO 8601 datetime pass-through
  if (input.includes('T') || /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  // Duration shorthand: 30m, 24h, 7d
  const match = input.match(/^(\d+)(m|h|d)$/);
  if (!match) return input;
  const num = parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();
  if (unit === 'm') now.setMinutes(now.getMinutes() + num);
  else if (unit === 'h') now.setHours(now.getHours() + num);
  else if (unit === 'd') now.setDate(now.getDate() + num);
  return now.toISOString();
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

function formatLinkDetail(link: Record<string, unknown>): string {
  const tags = Array.isArray(link.tags) ? (link.tags as string[]).join(', ') : '—';
  const expires = link.expiresAt ? String(link.expiresAt).replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC') : '—';
  return formatKeyValue([
    ['Short URL', String(link.shortUrl ?? '')],
    ['Slug', String(link.slug ?? '')],
    ['Destination', String(link.url ?? '')],
    ['Status', String(link.status ?? '')],
    ['Clicks', String(link.totalClicks ?? 0)],
    ['Expires', expires],
    ['Max clicks', link.maxClicks ? String(link.maxClicks) : '—'],
    ['Tags', tags],
    ['Created', String(link.createdAt ?? '').replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC')],
    ['Updated', String(link.updatedAt ?? '').replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC')],
    ['ID', String(link.id ?? '')],
  ]);
}

export const linksCommand = new Command('links')
  .description('Link management commands');

// --- links create ---
linksCommand
  .command('create <url>')
  .description('Create a shortened URL')
  .option('--slug <slug>', 'Custom slug (3-50 chars)')
  .option('--expires <duration>', 'Expiry: ISO 8601 or duration shorthand (7d, 24h, 30m)')
  .option('--max-clicks <n>', 'Deactivate after N clicks', parseInt)
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (url: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const body: Record<string, unknown> = { url };
      if (opts.slug) body.slug = opts.slug;
      if (opts.expires) {
        const parsed = parseDuration(opts.expires);
        body.expiresAt = parsed;
      }
      if (opts.maxClicks !== undefined) body.maxClicks = opts.maxClicks;
      if (opts.tags) body.tags = opts.tags.split(',').map((t: string) => t.trim());

      const response = await apiRequest<Record<string, unknown>>('POST', 'links', {
        ...apiOpts(globalOpts),
        body,
      });

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(formatLinkDetail(response.data));
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

// --- links list ---
linksCommand
  .command('list')
  .description('List links in the current workspace')
  .option('--tag <tag>', 'Filter by tag (repeat for AND logic)', (val: string, prev: string[]) => prev.concat(val), [] as string[])
  .option('--status <status>', 'Filter: active, expired, archived')
  .option('--search <q>', 'Search slug, destination URL, and tags')
  .option('--sort <field>', 'Sort: createdAt (default), totalClicks, slug, updatedAt')
  .option('--order <order>', 'desc (default) or asc')
  .option('--limit <n>', 'Items per page (default 20, max 100)', parseInt)
  .option('--cursor <cursor>', 'Pagination cursor from previous response')
  .option('--all', 'Fetch all pages (auto-paginate)')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const params: Record<string, string> = {};
      if (opts.tag && opts.tag.length > 0) params.tag = opts.tag.join(',');
      if (opts.status) params.status = opts.status;
      if (opts.search) params.search = opts.search;
      if (opts.sort) params.sort = opts.sort;
      if (opts.order) params.order = opts.order;
      if (opts.limit) params.limit = String(opts.limit);
      if (opts.cursor) params.cursor = opts.cursor;

      if (opts.all) {
        // Auto-paginate: fetch all pages
        const allData: Record<string, unknown>[] = [];
        let cursor: string | undefined = opts.cursor;
        let hasMore = true;

        while (hasMore) {
          const pageParams = { ...params };
          if (cursor) pageParams.cursor = cursor;

          const response = await apiRequest<Record<string, unknown>[]>('GET', 'links', {
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
          console.log(formatLinksTable(allData));
          console.log('');
          console.log(`  ${allData.length} links total.`);
        }
      } else {
        const response = await apiRequest<Record<string, unknown>[]>('GET', 'links', {
          ...apiOpts(globalOpts),
          params,
        });

        if (globalOpts.json) {
          console.log(formatJson({ data: response.data, meta: response.meta }));
        } else if (!globalOpts.quiet) {
          console.log(formatLinksTable(response.data));
          if (response.meta?.hasMore) {
            console.log('');
            console.log(`  Showing ${response.data.length} of ${response.meta.total ?? '?'} links. Next cursor: ${response.meta.cursor}`);
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

function formatLinksTable(data: Record<string, unknown>[]): string {
  return formatTable(data, [
    { key: 'slug', label: 'SLUG', width: 12 },
    { key: 'url', label: 'DESTINATION', width: 45 },
    { key: 'totalClicks', label: 'CLICKS', align: 'right', format: (v) => String(v ?? 0) },
    { key: 'status', label: 'STATUS' },
    {
      key: 'expiresAt', label: 'EXPIRES',
      format: (v) => v ? String(v).split('T')[0] : '—',
    },
  ]);
}

// --- links get ---
linksCommand
  .command('get <id-or-slug>')
  .description('Get a single link by ID or slug')
  .action(async (idOrSlug: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>>('GET', `links/${encodeURIComponent(idOrSlug)}`, apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(formatLinkDetail(response.data));
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

// --- links update ---
linksCommand
  .command('update <id-or-slug>')
  .description('Update a link\'s properties')
  .option('--url <url>', 'New destination URL')
  .option('--slug <new-slug>', 'New slug')
  .option('--expires <duration>', 'New expiry (use "none" to remove)')
  .option('--max-clicks <n>', 'New click limit (use 0 to remove)', parseInt)
  .option('--tags <tags>', 'Replace tag list (comma-separated)')
  .option('--status <status>', 'active or archived')
  .action(async (idOrSlug: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const body: Record<string, unknown> = {};
      if (opts.url) body.url = opts.url;
      if (opts.slug) body.slug = opts.slug;
      if (opts.expires !== undefined) {
        if (opts.expires === 'none') {
          body.expiresAt = null;
        } else {
          body.expiresAt = parseDuration(opts.expires);
        }
      }
      if (opts.maxClicks !== undefined) body.maxClicks = opts.maxClicks === 0 ? null : opts.maxClicks;
      if (opts.tags) body.tags = opts.tags.split(',').map((t: string) => t.trim());
      if (opts.status) body.status = opts.status;

      const response = await apiRequest<Record<string, unknown>>('PATCH', `links/${encodeURIComponent(idOrSlug)}`, {
        ...apiOpts(globalOpts),
        body,
      });

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(formatLinkDetail(response.data));
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

// --- links delete ---
linksCommand
  .command('delete <id-or-slug>')
  .description('Permanently delete a link and all its click data')
  .option('--force', 'Skip confirmation prompt')
  .action(async (idOrSlug: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      if (!opts.force) {
        const confirmed = await confirm(`Delete link "${idOrSlug}"? This is irreversible.`);
        if (!confirmed) {
          if (!globalOpts.quiet) console.log('  Aborted.');
          process.exit(0);
        }
      }

      await apiRequest('DELETE', `links/${encodeURIComponent(idOrSlug)}`, apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson({ deleted: idOrSlug }));
      } else if (!globalOpts.quiet) {
        console.log(`  Deleted ${idOrSlug}`);
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

// --- links bulk ---
linksCommand
  .command('bulk <action> [ids...]')
  .description('Perform bulk operations: delete, archive, unarchive, tag, untag')
  .option('--tag <tag>', 'Tag name (required for tag/untag actions)')
  .option('--force', 'Skip confirmation for destructive actions')
  .option('--ids-file <path>', 'Read IDs from file (one per line)')
  .action(async (action: string, ids: string[], opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const validActions = ['delete', 'archive', 'unarchive', 'tag', 'untag'];
      if (!validActions.includes(action)) {
        errorOutput({ code: 'INVALID_ACTION', message: `Action must be one of: ${validActions.join(', ')}` }, globalOpts);
        process.exit(1);
      }

      let allIds = [...ids];
      if (opts.idsFile) {
        const fileContent = readFileSync(opts.idsFile, 'utf-8');
        allIds.push(...fileContent.split('\n').map(l => l.trim()).filter(Boolean));
      }

      if (allIds.length === 0) {
        errorOutput({ code: 'NO_IDS', message: 'No link IDs provided. Pass IDs as arguments or use --ids-file.' }, globalOpts);
        process.exit(1);
      }

      if ((action === 'tag' || action === 'untag') && !opts.tag) {
        errorOutput({ code: 'MISSING_TAG', message: `--tag is required for the ${action} action.` }, globalOpts);
        process.exit(1);
      }

      if ((action === 'delete') && !opts.force) {
        const confirmed = await confirm(`Bulk ${action} ${allIds.length} links? This is irreversible.`);
        if (!confirmed) {
          if (!globalOpts.quiet) console.log('  Aborted.');
          process.exit(0);
        }
      }

      const body: Record<string, unknown> = { action, ids: allIds };
      if (opts.tag) body.tag = opts.tag;

      const response = await apiRequest<{ results: Array<{ id: string; slug?: string; status: string; error?: string }> }>(
        'POST', 'links/bulk', { ...apiOpts(globalOpts), body }
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const results = response.data.results ?? [];
        let succeeded = 0;
        let failed = 0;
        console.log(`  Bulk ${action}: ${allIds.length} links`);
        for (const r of results) {
          if (r.status === 'success') {
            console.log(`  ✓ ${r.id}  ${r.slug ?? ''}`);
            succeeded++;
          } else {
            console.log(`  ✗ ${r.id}  ${r.error ?? 'FAILED'}`);
            failed++;
          }
        }
        console.log('');
        console.log(`  Result: ${succeeded} succeeded, ${failed} failed`);
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

// --- links export ---
linksCommand
  .command('export')
  .description('Export all links in the workspace')
  .option('--format <format>', 'csv (default) or json', 'csv')
  .option('--output <path>', 'Write to file instead of stdout')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const params: Record<string, string> = { format: opts.format };
      const response = await apiRequest<unknown>('GET', 'links/export', {
        ...apiOpts(globalOpts),
        params,
      });

      const data = response.data;
      const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      if (opts.output) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(opts.output, content, 'utf-8');
        if (!globalOpts.quiet) console.log(`  Exported to ${opts.output}`);
      } else {
        console.log(content);
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

// --- links import ---
linksCommand
  .command('import <csv-file>')
  .description('Import links from a CSV file (Pro/Business only)')
  .option('--dry-run', 'Validate CSV without importing')
  .action(async (csvFile: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const csvContent = readFileSync(csvFile, 'utf-8');

      const body: Record<string, unknown> = { csv: csvContent };
      if (opts.dryRun) body.dryRun = true;

      const response = await apiRequest<{
        imported: number;
        skipped: number;
        errors?: Array<{ row: number; message: string }>;
      }>('POST', 'links/import', {
        ...apiOpts(globalOpts),
        body,
      });

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const d = response.data;
        console.log(`  Importing from ${csvFile}...`);
        console.log('');
        console.log(`  ✓  ${d.imported} links imported`);
        if (d.skipped > 0) {
          console.log(`  ⚠   ${d.skipped} skipped`);
          if (d.errors) {
            for (const e of d.errors) {
              console.log(`    Row ${e.row}: ${e.message}`);
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
