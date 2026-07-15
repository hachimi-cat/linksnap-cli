import { Command } from 'commander';
import { existsSync } from 'node:fs';
import {
  startDeviceFlow,
  pollDeviceToken,
  type DeviceTokens,
} from '@forjio/sdk';
import {
  setConfig,
  clearConfig,
  getConfig,
  getConfigPath,
  getCredentialsPath,
  resolveHuudisIssuer,
  resolveHuudisClientId,
  resolveProfile,
} from '../lib/config.js';
import { newSession, getClient, toApiRequestError } from '../lib/client.js';
import { ApiRequestError } from '../lib/api.js';
import { formatKeyValue, errorOutput } from '../lib/output.js';

function getGlobalOpts(cmd: Command): {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  apiKey?: string;
  apiUrl?: string;
  profile?: string;
} {
  return cmd.optsWithGlobals();
}

async function tryOpenBrowser(url: string): Promise<void> {
  try {
    const mod = (await import('open')) as { default?: (u: string) => Promise<unknown> };
    const openFn = mod.default ?? (mod as unknown as (u: string) => Promise<unknown>);
    if (typeof openFn === 'function') {
      await openFn(url);
    }
  } catch {
    // 'open' is optional — silently skip if unavailable.
  }
}

export const authCommand = new Command('auth')
  .description('Authentication commands');

// --- auth login (Huudis device flow) ---
authCommand
  .command('login')
  .description('Sign in via Huudis device-flow OIDC (RFC 8628)')
  .option('--issuer <url>', 'Override the Huudis issuer URL')
  .option('--client-id <id>', 'Override the OIDC client ID')
  .option('--no-browser', 'Do not attempt to open a browser')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    const issuer: string = opts.issuer ?? resolveHuudisIssuer();
    const clientId: string = opts.clientId ?? resolveHuudisClientId();
    const scope = 'openid profile email';
    const profile = resolveProfile(globalOpts);

    try {
      const start = await startDeviceFlow({ issuer, clientId, scope });

      const verificationUri =
        start.verificationUriComplete ?? start.verificationUri;

      if (globalOpts.json) {
        console.log(
          JSON.stringify(
            {
              status: 'device_flow_started',
              userCode: start.userCode,
              verificationUri,
              expiresIn: start.expiresIn,
            },
            null,
            2,
          ),
        );
      } else if (!globalOpts.quiet) {
        console.log('');
        console.log('  To complete sign-in, visit:');
        console.log(`    ${verificationUri}`);
        console.log('');
        console.log(`  Enter the code: ${start.userCode}`);
        console.log('');
        console.log('  Waiting for approval...');
      }

      if (opts.browser !== false) {
        await tryOpenBrowser(verificationUri);
      }

      const tokens: DeviceTokens = await pollDeviceToken({
        issuer,
        clientId,
        deviceCode: start.deviceCode,
        interval: start.interval,
      });

      // Persist tokens via Session.
      const session = newSession(profile);
      await session.save({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        issuer,
        clientId,
        scope: tokens.scope ?? scope,
      });

      if (globalOpts.json) {
        console.log(
          JSON.stringify(
            {
              status: 'authenticated',
              profile,
              credentials: getCredentialsPath(),
            },
            null,
            2,
          ),
        );
      } else if (!globalOpts.quiet) {
        console.log('');
        console.log(`  Signed in. Tokens saved to ${getCredentialsPath()} (profile: ${profile}).`);
      }
      process.exit(0);
    } catch (err) {
      const apiErr = toApiRequestError(err);
      errorOutput({ code: apiErr.errorCode, message: apiErr.message }, globalOpts);
      process.exit(apiErr.exitCode);
    }
  });

// --- auth token <api-key> (headless / CI) ---
authCommand
  .command('token <api-key>')
  .description('Save a static API key for headless/CI use (stored in config.json)')
  .option('--profile <name>', 'Profile name for tracking (default: "ci")')
  .action(async (apiKey: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    const profile = opts.profile ?? globalOpts.profile ?? 'ci';

    try {
      // Verify the key by hitting the workspace endpoint via the SDK.
      const handle = await getClient({
        apiKey,
        apiUrl: globalOpts.apiUrl,
        verbose: globalOpts.verbose,
      });
      const data = (await handle.client.account.me()) as {
        email?: string;
        plan?: string;
      };

      setConfig({
        apiKey,
        ...(globalOpts.apiUrl ? { apiUrl: globalOpts.apiUrl } : {}),
      });

      if (globalOpts.json) {
        console.log(
          JSON.stringify(
            { status: 'authenticated', profile, ...data },
            null,
            2,
          ),
        );
      } else if (!globalOpts.quiet) {
        console.log(
          `Saved. Authenticated as ${data.email ?? 'user'} (${data.plan ?? 'unknown'} plan), profile "${profile}".`,
        );
      }
      process.exit(0);
    } catch (err) {
      // Key might still be valid — save anyway, just like before.
      setConfig({
        apiKey,
        ...(globalOpts.apiUrl ? { apiUrl: globalOpts.apiUrl } : {}),
      });
      if (err instanceof ApiRequestError) {
        if (!globalOpts.quiet) {
          console.log(`API key saved to ${getConfigPath()}`);
        }
        process.exit(0);
      }
      const apiErr = toApiRequestError(err);
      errorOutput({ code: apiErr.errorCode, message: apiErr.message }, globalOpts);
      process.exit(apiErr.exitCode);
    }
  });

// --- auth status / whoami ---
async function statusAction(_opts: unknown, cmd: Command): Promise<void> {
  const globalOpts = getGlobalOpts(cmd);
  const profile = resolveProfile(globalOpts);

  // Try session first.
  if (existsSync(getCredentialsPath())) {
    try {
      const session = newSession(profile);
      const data = await session.load();
      let email: string | undefined;
      try {
        const handle = await getClient({
          apiUrl: globalOpts.apiUrl,
          profile,
          verbose: globalOpts.verbose,
        });
        const me = (await handle.client.account.me()) as { email?: string };
        email = me.email;
      } catch {
        // Best-effort — show what we know locally.
      }

      if (globalOpts.json) {
        console.log(
          JSON.stringify(
            {
              authenticated: true,
              authMode: 'session',
              profile,
              issuer: data.issuer,
              email,
              expiresAt: data.expiresAt,
              credentials: getCredentialsPath(),
            },
            null,
            2,
          ),
        );
      } else if (!globalOpts.quiet) {
        console.log(
          formatKeyValue([
            ['Mode', 'Huudis session'],
            ['Profile', profile],
            ['Email', email ?? '(unknown)'],
            ['Issuer', data.issuer],
            ['Expires', new Date(data.expiresAt * 1000).toISOString()],
            ['Credentials', getCredentialsPath()],
          ]),
        );
      }
      process.exit(0);
    } catch {
      // No session for this profile — fall through to API-key path.
    }
  }

  // API key fallback.
  const config = getConfig();
  if (!config?.apiKey) {
    if (globalOpts.json) {
      console.log(JSON.stringify({ authenticated: false }, null, 2));
    } else if (!globalOpts.quiet) {
      console.log(
        'Not authenticated. Run `linksnap auth login` (Huudis) or `linksnap auth token <key>` (CI).',
      );
    }
    process.exit(2);
  }

  const keyHint = '...' + config.apiKey.slice(-6);

  if (globalOpts.json) {
    console.log(
      JSON.stringify(
        {
          authenticated: true,
          authMode: 'apiKey',
          keyHint,
          configPath: getConfigPath(),
        },
        null,
        2,
      ),
    );
  } else if (!globalOpts.quiet) {
    console.log(
      formatKeyValue([
        ['Mode', 'API key'],
        ['API key', keyHint],
        ['Config', getConfigPath()],
      ]),
    );
  }
  process.exit(0);
}

authCommand
  .command('status')
  .description('Show current authentication status')
  .action(statusAction);

authCommand
  .command('whoami')
  .description('Alias for `auth status`')
  .action(statusAction);

// --- auth logout ---
authCommand
  .command('logout')
  .description('Remove stored credentials (session or API key) from local disk')
  .option('--profile <name>', 'Profile to clear (default: active profile)')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    const profile = opts.profile ?? resolveProfile(globalOpts);

    let clearedSession = false;
    if (existsSync(getCredentialsPath())) {
      try {
        const session = newSession(profile);
        await session.load();
        await session.clear();
        clearedSession = true;
      } catch {
        // Profile not present — ignore.
      }
    }

    // Also clear the legacy config.json (API key) — only if no profile flag
    // was passed, so a targeted profile clear doesn't nuke CI creds.
    let clearedApiKey = false;
    if (!opts.profile) {
      const config = getConfig();
      if (config?.apiKey) {
        clearConfig();
        clearedApiKey = true;
      }
    }

    if (globalOpts.json) {
      console.log(
        JSON.stringify(
          {
            status: 'logged_out',
            profile,
            clearedSession,
            clearedApiKey,
          },
          null,
          2,
        ),
      );
    } else if (!globalOpts.quiet) {
      if (clearedSession || clearedApiKey) {
        const parts: string[] = [];
        if (clearedSession) parts.push(`session profile "${profile}"`);
        if (clearedApiKey) parts.push('API key');
        console.log(`Logged out. Cleared: ${parts.join(', ')}.`);
      } else {
        console.log('Nothing to clear (not authenticated).');
      }
    }
    process.exit(0);
  });

// --- auth update-profile ---
authCommand
  .command('update-profile')
  .description('Update your account profile (name / email)')
  .option('--name <name>', 'New display name')
  .option('--email <email>', 'New email address')
  .action(async (opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    if (!opts.name && !opts.email) {
      errorOutput(
        {
          code: 'MISSING_FIELDS',
          message: 'Provide at least one of --name or --email.',
        },
        globalOpts,
      );
      process.exit(1);
      return;
    }
    try {
      const handle = await getClient({
        apiKey: globalOpts.apiKey,
        apiUrl: globalOpts.apiUrl,
        profile: globalOpts.profile,
        verbose: globalOpts.verbose,
      });
      const patch: { name?: string; email?: string } = {};
      if (opts.name) patch.name = opts.name;
      if (opts.email) patch.email = opts.email;
      const updated = await handle.client.account.update(patch);

      if (globalOpts.json) {
        console.log(JSON.stringify(updated, null, 2));
      } else if (!globalOpts.quiet) {
        const u = updated as { name?: unknown; email?: unknown };
        console.log(
          formatKeyValue([
            ['Name', String(u.name ?? '')],
            ['Email', String(u.email ?? '')],
          ]),
        );
      }
      process.exit(0);
    } catch (err) {
      const apiErr = toApiRequestError(err);
      errorOutput({ code: apiErr.errorCode, message: apiErr.message }, globalOpts);
      process.exit(apiErr.exitCode);
    }
  });
