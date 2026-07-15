import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { apiRequest, ApiRequestError } from '../lib/api.js';
import { getClient, toApiRequestError } from '../lib/client.js';
import { formatJson, formatKeyValue, formatTable, errorOutput } from '../lib/output.js';

function getGlobalOpts(cmd: Command) {
  return cmd.optsWithGlobals() as {
    json?: boolean; quiet?: boolean; verbose?: boolean;
    apiKey?: string; apiUrl?: string; profile?: string;
  };
}

function apiOpts(globalOpts: ReturnType<typeof getGlobalOpts>) {
  return { apiKey: globalOpts.apiKey, apiUrl: globalOpts.apiUrl, verbose: globalOpts.verbose };
}

function clientOpts(globalOpts: ReturnType<typeof getGlobalOpts>) {
  return {
    apiKey: globalOpts.apiKey,
    apiUrl: globalOpts.apiUrl,
    profile: globalOpts.profile,
    verbose: globalOpts.verbose,
  };
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

export const billingCommand = new Command('billing')
  .description('Plan & billing commands');

// --- billing plan ---
billingCommand
  .command('plan')
  .description('Show current plan and usage')
  .action(async (_opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>>('GET', 'billing/plan', apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const d = response.data;
        const used = Number(d.linksUsed ?? 0);
        const limit = Number(d.linksLimit ?? 0);
        const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;

        console.log(formatKeyValue([
          ['Plan', String(d.plan ?? 'Free')],
          ['Links used', `${used} / ${limit} (${pct}%)`],
          ['Rate limit', String(d.rateLimit ?? '60 req/min')],
          ['Analytics', String(d.analyticsRetention ?? '30 days retention')],
          ['Tags per link', String(d.tagsPerLink ?? 3)],
          ['Bulk ops limit', String(d.bulkOpsLimit ?? 10)],
          ['Import', String(d.importAvailable ? 'Available' : 'Not available (upgrade to Pro)')],
          ['Export formats', String(d.exportFormats ?? 'CSV only')],
        ]));

        if (d.upgradeMessage) {
          console.log('');
          console.log(`  ${d.upgradeMessage}`);
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

// --- billing upgrade ---
billingCommand
  .command('upgrade')
  .description('Get upgrade URL (opens in browser)')
  .option('--plan <plan>', 'pro or business')
  .option('--open', 'Open URL in default browser')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const body: Record<string, unknown> = {};
      if (opts.plan) body.plan = opts.plan;

      const response = await apiRequest<{ url: string; plan: string; price: string }>(
        'POST', 'billing/checkout', { ...apiOpts(globalOpts), body }
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const d = response.data;
        console.log(`  To upgrade to ${d.plan} (${d.price}), open:`);
        console.log(`  ${d.url}`);
      }

      if (opts.open && response.data.url) {
        const { exec } = await import('node:child_process');
        const url = response.data.url;
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} ${url}`);
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

// --- billing cancel ---
billingCommand
  .command('cancel')
  .description('Cancel current plan at end of billing cycle')
  .option('--force', 'Skip confirmation prompt')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      if (!opts.force) {
        const confirmed = await confirm('Cancel your current plan? You\'ll keep access until the end of the billing cycle.');
        if (!confirmed) {
          if (!globalOpts.quiet) console.log('  Aborted.');
          process.exit(0);
        }
      }

      const response = await apiRequest<{ message: string; activeUntil: string }>(
        'POST', 'billing/cancel', apiOpts(globalOpts)
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const d = response.data;
        console.log(`  Subscription canceling. Active until ${d.activeUntil ?? 'end of billing cycle'}.`);
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

// --- billing history ---
billingCommand
  .command('history')
  .description('Show billing history')
  .action(async (_opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Array<Record<string, unknown>>>('GET', 'billing/history', apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(formatTable(response.data, [
          { key: 'date', label: 'DATE', format: (v) => String(v ?? '').split('T')[0] },
          { key: 'plan', label: 'PLAN' },
          { key: 'amount', label: 'AMOUNT', align: 'right', format: (v) => String(v ?? '') },
          { key: 'status', label: 'STATUS' },
        ]));
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

// --- billing invoices ---
billingCommand
  .command('invoices')
  .description('List invoices')
  .option('--limit <n>', 'Maximum number of invoices to return', (v) => parseInt(v, 10))
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const handle = await getClient(clientOpts(globalOpts));
      const query: { limit?: number } = {};
      if (typeof opts.limit === 'number' && !Number.isNaN(opts.limit)) {
        query.limit = opts.limit;
      }
      const invoices = await handle.client.billing.invoices(query);

      if (globalOpts.json) {
        console.log(formatJson(invoices));
      } else if (!globalOpts.quiet) {
        console.log(formatTable(invoices as Record<string, unknown>[], [
          { key: 'id', label: 'ID' },
          { key: 'date', label: 'DATE', format: (v) => String(v ?? '').split('T')[0] },
          { key: 'amount', label: 'AMOUNT', align: 'right', format: (v) => String(v ?? '') },
          { key: 'status', label: 'STATUS' },
          { key: 'url', label: 'URL' },
        ]));
      }
      process.exit(0);
    } catch (err) {
      const apiErr = toApiRequestError(err);
      errorOutput({ code: apiErr.errorCode, message: apiErr.message }, globalOpts);
      process.exit(apiErr.exitCode);
    }
  });

// --- billing downgrade ---
billingCommand
  .command('downgrade <plan-id>')
  .description('Downgrade to a different plan (effective at the end of the cycle)')
  .action(async (planId: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const handle = await getClient(clientOpts(globalOpts));
      const result = await handle.client.billing.downgrade({ planId });

      if (globalOpts.json) {
        console.log(formatJson(result));
      } else if (!globalOpts.quiet) {
        const r = result as Record<string, unknown>;
        console.log(`  Downgrade scheduled to plan "${planId}".`);
        if (r.activeUntil) console.log(`  Current plan active until: ${String(r.activeUntil)}`);
        if (r.message) console.log(`  ${String(r.message)}`);
      }
      process.exit(0);
    } catch (err) {
      const apiErr = toApiRequestError(err);
      errorOutput({ code: apiErr.errorCode, message: apiErr.message }, globalOpts);
      process.exit(apiErr.exitCode);
    }
  });
