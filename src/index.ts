import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ApiRequestError } from './lib/api.js';
import { errorOutput } from './lib/output.js';
import { authCommand } from './commands/auth.js';
import { linksCommand } from './commands/links.js';
import { statsCommand } from './commands/stats.js';
import { tagsCommand } from './commands/tags.js';
import { billingCommand } from './commands/billing.js';
import { keysCommand } from './commands/keys.js';
import { workspaceCommand } from './commands/workspace.js';
import { healthCommand } from './commands/health.js';
import { qrCommand } from './commands/qr.js';
import { domainsCommand } from './commands/domains.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const program = new Command();

program
  .name('linksnap')
  .description(pkg.description)
  .version(pkg.version)
  .option('-j, --json', 'Output raw JSON')
  .option('-q, --quiet', 'Suppress all output except errors')
  .option('-v, --verbose', 'Show request/response details')
  .option('--api-key <key>', 'Override API key for this invocation')
  .option('--api-url <url>', 'Override API base URL')
  .option('--profile <name>', 'Credentials profile (default: $LINKSNAP_PROFILE or "default")')
  .option('--no-color', 'Disable colored output');

// Register command groups
program.addCommand(authCommand);
program.addCommand(linksCommand);
program.addCommand(statsCommand);
program.addCommand(tagsCommand);
program.addCommand(billingCommand);
program.addCommand(keysCommand);
program.addCommand(workspaceCommand);
program.addCommand(healthCommand);
program.addCommand(qrCommand);
program.addCommand(domainsCommand);

// -------------------------------------------------------
// Top-level aliases for common commands
// Landing page shows: linksnap create https://... --slug docs
// Docs page shows:    linksnap stats my-link
// -------------------------------------------------------

// linksnap create <url> → alias for linksnap links create <url>
const createAlias = new Command('create')
  .description('Create a shortened URL (shortcut for "links create")')
  .argument('<url>', 'Destination URL')
  .option('--slug <slug>', 'Custom slug (3-50 chars)')
  .option('--expires <duration>', 'Expiry: ISO 8601 or duration shorthand (7d, 24h, 30m)')
  .option('--max-clicks <n>', 'Deactivate after N clicks', parseInt)
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (url: string, opts, cmd) => {
    // Delegate to links create by reconstructing argv
    const args = ['links', 'create', url];
    const globalOpts = cmd.optsWithGlobals();
    if (opts.slug) args.push('--slug', opts.slug);
    if (opts.expires) args.push('--expires', opts.expires);
    if (opts.maxClicks !== undefined) args.push('--max-clicks', String(opts.maxClicks));
    if (opts.tags) args.push('--tags', opts.tags);
    if (globalOpts.json) args.push('--json');
    if (globalOpts.quiet) args.push('--quiet');
    if (globalOpts.verbose) args.push('--verbose');
    if (globalOpts.apiKey) args.push('--api-key', globalOpts.apiKey);
    if (globalOpts.apiUrl) args.push('--api-url', globalOpts.apiUrl);
    await program.parseAsync(['node', 'linksnap', ...args]);
  });
program.addCommand(createAlias);

// linksnap stats <id-or-slug> → alias for linksnap stats show <id-or-slug>
// We handle this by making stats show the default subcommand
// Commander doesn't have default subcommands natively, so we use .argument on the stats command
// Actually, let's add a top-level 'stat' alias that calls stats show
const statAlias = new Command('stat')
  .description('Show click analytics (shortcut for "stats show")')
  .argument('<id-or-slug>', 'Link ID or slug')
  .option('--from <date>', 'Start date (ISO 8601)')
  .option('--to <date>', 'End date (ISO 8601)')
  .option('--breakdown <field>', 'Breakdown: day, country, device, browser, os, referrer')
  .action(async (idOrSlug: string, opts, cmd) => {
    const args = ['stats', 'show', idOrSlug];
    const globalOpts = cmd.optsWithGlobals();
    if (opts.from) args.push('--from', opts.from);
    if (opts.to) args.push('--to', opts.to);
    if (opts.breakdown) args.push('--breakdown', opts.breakdown);
    if (globalOpts.json) args.push('--json');
    if (globalOpts.quiet) args.push('--quiet');
    if (globalOpts.verbose) args.push('--verbose');
    if (globalOpts.apiKey) args.push('--api-key', globalOpts.apiKey);
    if (globalOpts.apiUrl) args.push('--api-url', globalOpts.apiUrl);
    await program.parseAsync(['node', 'linksnap', ...args]);
  });
program.addCommand(statAlias);

// Handle uncaught errors
program.hook('preAction', () => {
  process.on('unhandledRejection', (err) => {
    if (err instanceof ApiRequestError) {
      const opts = program.opts();
      errorOutput({ code: err.errorCode, message: err.message }, opts);
      process.exit(err.exitCode);
    }
    console.error(err instanceof Error ? err.message : 'Unknown error');
    process.exit(1);
  });
});

program.parse();
