import { Command } from 'commander';
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
  return { apiKey: globalOpts.apiKey, apiUrl: globalOpts.apiUrl, profile: globalOpts.profile, verbose: globalOpts.verbose };
}

function clientOpts(globalOpts: ReturnType<typeof getGlobalOpts>) {
  return {
    apiKey: globalOpts.apiKey,
    apiUrl: globalOpts.apiUrl,
    profile: globalOpts.profile,
    verbose: globalOpts.verbose,
  };
}

export const workspaceCommand = new Command('workspace')
  .description('Workspace settings commands');

// --- workspace show ---
workspaceCommand
  .command('show')
  .description('Show workspace details')
  .action(async (_opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>>('GET', 'workspace', apiOpts(globalOpts));

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        const d = response.data;
        console.log(formatKeyValue([
          ['Name', String(d.name ?? '')],
          ['Slug', String(d.slug ?? '')],
          ['Plan', String(d.plan ?? 'Free')],
          ['Members', String(d.memberCount ?? 1)],
          ['Created', String(d.createdAt ?? '').split('T')[0]],
          ['ID', String(d.id ?? '')],
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

// --- workspace rename ---
workspaceCommand
  .command('rename <new-name>')
  .description('Rename the workspace')
  .action(async (newName: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const response = await apiRequest<Record<string, unknown>>(
        'PATCH', 'workspace',
        { ...apiOpts(globalOpts), body: { name: newName } }
      );

      if (globalOpts.json) {
        console.log(formatJson(response.data));
      } else if (!globalOpts.quiet) {
        console.log(`  Workspace renamed to "${response.data.name ?? newName}".`);
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

// --- workspace members (sub-group) ---
const membersCommand = new Command('members')
  .description('Workspace member management commands');

// workspace members list
membersCommand
  .command('list')
  .description('List workspace members')
  .action(async (_opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const handle = await getClient(clientOpts(globalOpts));
      const members = await handle.client.workspace.members.list();

      if (globalOpts.json) {
        console.log(formatJson(members));
      } else if (!globalOpts.quiet) {
        console.log(formatTable(members as Record<string, unknown>[], [
          { key: 'id', label: 'ID' },
          { key: 'email', label: 'EMAIL' },
          { key: 'name', label: 'NAME' },
          { key: 'role', label: 'ROLE' },
          { key: 'createdAt', label: 'JOINED', format: (v) => v ? String(v).split('T')[0] : '—' },
        ]));
      }
      process.exit(0);
    } catch (err) {
      const apiErr = toApiRequestError(err);
      errorOutput({ code: apiErr.errorCode, message: apiErr.message }, globalOpts);
      process.exit(apiErr.exitCode);
    }
  });

// workspace members add <email>
membersCommand
  .command('add <email>')
  .description('Invite a member to the workspace')
  .option('--role <role>', 'Role for the new member (e.g. admin, member)')
  .action(async (email: string, opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const handle = await getClient(clientOpts(globalOpts));
      const input: { email: string; role?: string } = { email };
      if (opts.role) input.role = opts.role;
      const member = await handle.client.workspace.members.add(input);

      if (globalOpts.json) {
        console.log(formatJson(member));
      } else if (!globalOpts.quiet) {
        const m = member as Record<string, unknown>;
        console.log(`  Invited ${email}${opts.role ? ` as ${opts.role}` : ''}.`);
        if (m.id) console.log(`  Member ID: ${String(m.id)}`);
      }
      process.exit(0);
    } catch (err) {
      const apiErr = toApiRequestError(err);
      errorOutput({ code: apiErr.errorCode, message: apiErr.message }, globalOpts);
      process.exit(apiErr.exitCode);
    }
  });

// workspace members remove <id>
membersCommand
  .command('remove <id>')
  .description('Remove a member from the workspace')
  .action(async (id: string, _opts, cmd) => {
    const globalOpts = getGlobalOpts(cmd);
    try {
      const handle = await getClient(clientOpts(globalOpts));
      await handle.client.workspace.members.remove(id);

      if (globalOpts.json) {
        console.log(formatJson({ removed: id }));
      } else if (!globalOpts.quiet) {
        console.log(`  Removed member ${id}.`);
      }
      process.exit(0);
    } catch (err) {
      const apiErr = toApiRequestError(err);
      errorOutput({ code: apiErr.errorCode, message: apiErr.message }, globalOpts);
      process.exit(apiErr.exitCode);
    }
  });

workspaceCommand.addCommand(membersCommand);
