import { Command } from 'commander';
import { apiRequest, ApiRequestError } from '../lib/api.js';
import { formatJson, formatTable, errorOutput } from '../lib/output.js';

function getGlobalOpts(cmd: Command) {
  return cmd.optsWithGlobals() as {
    json?: boolean; quiet?: boolean; verbose?: boolean;
    apiKey?: string; apiUrl?: string; profile?: string;
  };
}

function apiOpts(globalOpts: ReturnType<typeof getGlobalOpts>) {
  return { apiKey: globalOpts.apiKey, apiUrl: globalOpts.apiUrl, profile: globalOpts.profile, verbose: globalOpts.verbose };
}

export const tagsCommand = new Command('tags')
  .description('Tag management commands');

tagsCommand
  .command('list')
  .description('List all tags with link counts')
  .action(async (_opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Array<{ name: string; count: number }>>(
        'GET', 'tags', apiOpts(globalOpts)
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(formatTable(
          response.data as unknown as Record<string, unknown>[],
          [
            { key: 'name', label: 'TAG' },
            { key: 'count', label: 'LINKS', align: 'right', format: (v) => String(v ?? 0) },
          ]
        ));
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
