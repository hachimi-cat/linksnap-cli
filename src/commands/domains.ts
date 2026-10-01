import { Command } from 'commander';
import { apiRequest, ApiRequestError } from '../lib/api.js';
import { formatJson, formatKeyValue, errorOutput } from '../lib/output.js';

function getGlobalOpts(cmd: Command) {
  return cmd.optsWithGlobals() as {
    json?: boolean; quiet?: boolean; verbose?: boolean;
    apiKey?: string; apiUrl?: string; profile?: string;
  };
}

function apiOpts(globalOpts: ReturnType<typeof getGlobalOpts>) {
  return { apiKey: globalOpts.apiKey, apiUrl: globalOpts.apiUrl, profile: globalOpts.profile, verbose: globalOpts.verbose };
}

export const domainsCommand = new Command('domains')
  .description('Custom domain management');

// --- domains list ---
domainsCommand
  .command('list')
  .description('List custom domains')
  .action(async (_opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>[]>('GET', 'domains', apiOpts(globalOpts));
      const domains = Array.isArray(response.data) ? response.data : [];

      if (globalOpts.json) {
        console.log(formatJson(domains));
      } else if (!globalOpts.quiet) {
        if (domains.length === 0) {
          console.log('  No custom domains configured.');
        } else {
          for (const d of domains) {
            console.log(formatKeyValue([
              ['Domain', String(d.domain ?? '')],
              ['Status', String(d.status ?? '')],
              ['SSL', d.sslProvisioned ? 'yes' : 'no'],
              ['Created', String(d.createdAt ?? '').split('T')[0]],
              ['ID', String(d.id ?? '')],
            ]));
            console.log();
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

// --- domains add ---
domainsCommand
  .command('add <domain>')
  .description('Add a custom domain')
  .action(async (domain: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>>(
        'POST', 'domains',
        { ...apiOpts(globalOpts), body: { domain } },
      );
      const d = response.data;

      if (globalOpts.json) {
        console.log(formatJson(d));
      } else if (!globalOpts.quiet) {
        console.log(`  Domain added: ${d.domain} (pending verification)\n`);
        const dns = d.dnsInstructions as any;
        if (dns) {
          console.log('  Configure these DNS records:\n');
          console.log(`    CNAME   ${dns.cname.host} → ${dns.cname.target}`);
          console.log(`    TXT     ${dns.txt.host} → ${dns.txt.value}`);
          console.log(`\n  Then run: linksnap domains verify ${d.id}`);
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

// --- domains verify ---
domainsCommand
  .command('verify <id>')
  .description('Verify DNS configuration for a domain')
  .action(async (id: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>>(
        'POST', `domains/${id}/verify`,
        apiOpts(globalOpts),
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const d = response.data;
        if (d.verified) {
          console.log(`  DNS verified for ${d.domain}. SSL provisioning in progress.`);
        } else {
          console.log(`  Verification status: ${d.status}`);
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

// --- domains remove ---
domainsCommand
  .command('remove <id>')
  .description('Remove a custom domain')
  .action(async (id: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>>(
        'DELETE', `domains/${id}`,
        apiOpts(globalOpts),
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const d = response.data;
        console.log(`  Domain ${d.domain ?? id} removed.`);
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
