import { Command } from 'commander';
import { createInterface } from 'node:readline';
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

export const keysCommand = new Command('keys')
  .description('API key management commands');

// --- keys list ---
keysCommand
  .command('list')
  .description('List all API keys')
  .action(async (_opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Array<Record<string, unknown>>>('GET', 'auth/api-keys', apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(formatTable(response.data, [
          { key: 'name', label: 'NAME' },
          { key: 'keyHint', label: 'KEY HINT' },
          { key: 'lastUsedAt', label: 'LAST USED', format: (v) => v ? String(v).replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC') : '—' },
          { key: 'createdAt', label: 'CREATED', format: (v) => v ? String(v).replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace('Z', ' UTC') : '—' },
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

// --- keys create ---
keysCommand
  .command('create <name>')
  .description('Create a new API key (full key shown once)')
  .action(async (name: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<{ key: string; name: string; id: string }>(
        'POST', 'auth/api-keys', { ...apiOpts(globalOpts), body: { name } }
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const d = response.data;
        console.log(`  API key created: ${d.name}`);
        console.log('');
        console.log(`  ${d.key}`);
        console.log('');
        console.log('  \u26A0  Save this key now. It won\'t be shown again.');
        console.log('     Store it in your CI secrets or password manager.');
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

// --- keys revoke ---
keysCommand
  .command('revoke <id-or-name>')
  .description('Revoke an API key (immediately invalidates it)')
  .option('--force', 'Skip confirmation')
  .action(async (idOrName: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      if (!opts.force) {
        const confirmed = await confirm(`Revoke API key "${idOrName}"? This will immediately invalidate it.`);
        if (!confirmed) {
          if (!globalOpts.quiet) console.log('  Aborted.');
          process.exit(0);
        }
      }

      await apiRequest('DELETE', `auth/api-keys/${encodeURIComponent(idOrName)}`, apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson({ revoked: idOrName }));
      } else if (!globalOpts.quiet) {
        console.log(`  Revoked API key "${idOrName}".`);
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
