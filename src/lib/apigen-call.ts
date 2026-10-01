/**
 * How the generated `linksnap api <area> <action>` commands (commands/api.generated.ts)
 * make their call: this CLI's own HTTP helper and credentials (lib/api.ts, with the
 * credential order of lib/credentials.ts — --api-key or $LINKSNAP_API_KEY, else the
 * `linksnap auth login` session of --profile, else the key saved by `linksnap auth
 * token`), against --api-url, with its own output and errors, exactly like `linksnap links …`.
 */
import type { Command } from 'commander';
import { apiRequest, ApiRequestError } from './api.js';
import { errorOutput, formatJson } from './output.js';

interface GlobalOpts {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  apiKey?: string;
  apiUrl?: string;
  profile?: string;
}

const globals = (cmd: Command): GlobalOpts => cmd.optsWithGlobals() as GlobalOpts;

export async function callRoute(
  cmd: Command,
  method: string,
  path: string,
  query: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
): Promise<void> {
  const g = globals(cmd);
  let response: Awaited<ReturnType<typeof apiRequest>>;
  try {
    const params = Object.fromEntries(
      Object.entries(query).map(([k, v]): [string, string] => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
    );
    // lib/api.ts resolves a path against the API base URL (…/api/v1), as every command does.
    response = await apiRequest(method, path.replace(/^\/api\/v1\//, ''), {
      apiKey: g.apiKey,
      apiUrl: g.apiUrl,
      profile: g.profile,
      verbose: g.verbose,
      body,
      params,
    });
  } catch (err) {
    return failRoute(cmd, err);
  }
  if (!g.quiet) {
    // A paginated list keeps its cursor, as `linksnap links list --json` does.
    const meta = response.meta as Record<string, unknown> | undefined;
    console.log(formatJson(meta && 'hasMore' in meta ? { data: response.data, meta } : response.data));
  }
  process.exit(0);
}

/** Bad input to a generated command (a missing field, a value the spec does not allow),
 *  or the API's refusal. */
export async function failRoute(cmd: Command, err: unknown): Promise<never> {
  const g = globals(cmd);
  if (err instanceof ApiRequestError) {
    errorOutput({ code: err.errorCode, message: err.message }, g);
    process.exit(err.exitCode);
  }
  errorOutput({ code: 'INVALID_INPUT', message: err instanceof Error ? err.message : String(err) }, g);
  process.exit(1);
}
