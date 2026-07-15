import { Command } from 'commander';
import { resolveApiUrl } from '../lib/config.js';
import { formatJson, formatKeyValue, errorOutput } from '../lib/output.js';

function getGlobalOpts(cmd: Command) {
  return cmd.optsWithGlobals() as {
    json?: boolean; quiet?: boolean; verbose?: boolean;
    apiKey?: string; apiUrl?: string;
  };
}

export const healthCommand = new Command('health')
  .description('Check if the API is up (no auth required)')
  .action(async (_opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const baseUrl = resolveApiUrl(globalOpts);
      const url = new URL('health', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');

      const start = Date.now();
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      const elapsed = Date.now() - start;

      if (globalOpts.verbose) {
        console.error(`GET ${url.toString()} → ${response.status} (${elapsed}ms)`);
      }

      if (!response.ok) {
        if (globalOpts.json) {
          console.error(JSON.stringify({ error: { code: 'HEALTH_CHECK_FAILED', message: `API returned ${response.status}` } }, null, 2));
        } else if (!globalOpts.quiet) {
          console.error(`Error: API returned ${response.status}`);
        }
        process.exit(1);
      }

      const body = await response.json() as Record<string, unknown>;
      const data = (body as { data?: Record<string, unknown> }).data ?? body;

      if (globalOpts.json) {
        console.log(formatJson(data));
      } else if (!globalOpts.quiet) {
        console.log(formatKeyValue([
          ['API', String(data.status ?? 'healthy')],
          ['Version', String(data.version ?? 'unknown')],
          ['Database', String(data.database ?? 'unknown')],
          ['Redis', String(data.redis ?? 'unknown')],
          ['Uptime', String(data.uptime ?? 'unknown')],
        ]));
      }
      process.exit(0);
    } catch (err) {
      if (err instanceof Error) {
        errorOutput({ code: 'CONNECTION_ERROR', message: err.message }, globalOpts);
      }
      process.exit(1);
    }
  });
