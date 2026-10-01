import { Command } from 'commander';
import { apiRequest, ApiRequestError } from '../lib/api.js';
import { formatJson, formatKeyValue, formatTable, errorOutput } from '../lib/output.js';

function getGlobalOpts(cmd: Command) {
  return cmd.optsWithGlobals() as {
    json?: boolean; quiet?: boolean; verbose?: boolean;
    apiKey?: string; apiUrl?: string; profile?: string;
  };
}

function apiOpts(globalOpts: ReturnType<typeof getGlobalOpts>) {
  return { apiKey: globalOpts.apiKey, apiUrl: globalOpts.apiUrl, profile: globalOpts.profile, verbose: globalOpts.verbose };
}

function renderBar(count: number, max: number, width = 20): string {
  const filled = max > 0 ? Math.round((count / max) * width) : 0;
  return '\u2588'.repeat(filled);
}

export const statsCommand = new Command('stats')
  .description('Analytics commands');

// --- stats show ---
statsCommand
  .command('show <id-or-slug>')
  .description('Show click analytics for a link')
  .option('--from <date>', 'Start date (ISO 8601). Default: 30 days ago')
  .option('--to <date>', 'End date (ISO 8601). Default: today')
  .option('--breakdown <field>', 'Show single breakdown: day, country, device, browser, os, referrer')
  .action(async (idOrSlug: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const params: Record<string, string> = {};
      if (opts.from) params.from = opts.from;
      if (opts.to) params.to = opts.to;
      if (opts.breakdown) params.breakdown = opts.breakdown;

      const response = await apiRequest<Record<string, unknown>>(
        'GET', `links/${encodeURIComponent(idOrSlug)}/stats`,
        { ...apiOpts(globalOpts), params }
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const data = response.data;
        console.log(`  Stats for ${idOrSlug} (last 30 days)`);
        console.log('');
        console.log(`  Total clicks: ${data.totalClicks ?? 0}`);

        // Clicks by day
        const clicksByDay = data.clicksByDay as Array<{ date: string; count: number }> | undefined;
        if (clicksByDay && clicksByDay.length > 0) {
          const maxCount = Math.max(...clicksByDay.map(d => d.count));
          console.log('');
          console.log('  By day:');
          for (const day of clicksByDay.slice(-7)) {
            const bar = renderBar(day.count, maxCount);
            console.log(`    ${day.date}  ${bar}  ${day.count}`);
          }
        }

        // Country breakdown
        const byCountry = data.clicksByCountry as Array<{ country: string; count: number }> | undefined;
        if (byCountry && byCountry.length > 0) {
          const total = Number(data.totalClicks ?? 0);
          console.log('');
          console.log('  By country:');
          for (const item of byCountry.slice(0, 5)) {
            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
            console.log(`    ${item.country}  ${item.count} (${pct}%)`);
          }
        }

        // Device breakdown
        const byDevice = data.clicksByDevice as Array<{ device: string; count: number }> | undefined;
        if (byDevice && byDevice.length > 0) {
          console.log('');
          console.log('  By device:');
          for (const item of byDevice) {
            console.log(`    ${item.device}  ${item.count}`);
          }
        }

        // Referrer breakdown
        const byReferrer = data.clicksByReferrer as Array<{ referrer: string; count: number }> | undefined;
        if (byReferrer && byReferrer.length > 0) {
          console.log('');
          console.log('  By referrer:');
          for (const item of byReferrer.slice(0, 5)) {
            console.log(`    ${item.referrer}  ${item.count}`);
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

// --- stats export ---
statsCommand
  .command('export <id-or-slug>')
  .description('Export raw click events for a link (Pro/Business only)')
  .option('--format <format>', 'csv (default) or json', 'csv')
  .option('--from <date>', 'Start date. Default: 30 days ago')
  .option('--to <date>', 'End date. Default: today')
  .option('--output <path>', 'Write to file instead of stdout')
  .action(async (idOrSlug: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const params: Record<string, string> = { format: opts.format };
      if (opts.from) params.from = opts.from;
      if (opts.to) params.to = opts.to;

      const response = await apiRequest<unknown>(
        'GET', `links/${encodeURIComponent(idOrSlug)}/stats/export`,
        { ...apiOpts(globalOpts), params }
      );

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

// --- stats workspace ---
statsCommand
  .command('workspace')
  .description('Show workspace-level metrics')
  .option('--from <date>', 'Start date. Default: 30 days ago')
  .option('--to <date>', 'End date. Default: today')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const params: Record<string, string> = {};
      if (opts.from) params.from = opts.from;
      if (opts.to) params.to = opts.to;

      const response = await apiRequest<Record<string, unknown>>(
        'GET', 'workspace/stats',
        { ...apiOpts(globalOpts), params }
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const data = response.data;
        console.log('  Workspace stats (last 30 days)');
        console.log('');

        const links = data.links as Record<string, unknown> | undefined;
        if (links) {
          console.log(`  Links:   ${links.total ?? 0} total  (${links.active ?? 0} active, ${links.expired ?? 0} expired, ${links.archived ?? 0} archived)`);
        }
        console.log(`  Clicks:  ${data.totalClicks ?? 0} total`);

        const topLinks = data.topLinks as Array<Record<string, unknown>> | undefined;
        if (topLinks && topLinks.length > 0) {
          console.log('');
          console.log('  Top links:');
          topLinks.slice(0, 5).forEach((link, i) => {
            console.log(`    ${i + 1}. ${link.slug}  ${link.url}  ${link.totalClicks} clicks`);
          });
        }

        const quota = data.quota as Record<string, unknown> | undefined;
        if (quota) {
          console.log('');
          console.log(`  Quota:   ${quota.used ?? 0} / ${quota.limit ?? 0} links used (${quota.plan ?? 'Free'} plan)`);
          if (quota.resetsAt) {
            console.log(`           Resets ${String(quota.resetsAt).split('T')[0]}`);
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
