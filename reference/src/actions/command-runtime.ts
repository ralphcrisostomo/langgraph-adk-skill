// The spawning layer for the aws_cli and bash tools. Every AWS command is pinned
// to ONE profile/region here; the bash subprocess runs with a stripped env so it
// cannot reach AWS at all (LAYER 2 of the boundary — see bash-core.ts for LAYER 1).
import { shellEnv } from './bash-core';

// The single pinned AWS identity. Env-overridable for deploys, but the agent and
// the user can never change it at runtime.
export const PROFILE = process.env.REFERENCE_AWS_PROFILE ?? 'default';
export const REGION = process.env.REFERENCE_AWS_REGION ?? 'us-east-1';

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function cap(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

// AWS CLI env: drop ambient credentials/profile/region so the pinned --profile /
// --region flags fully determine identity, but KEEP the config-file locations so
// the managed profile in ~/.aws still resolves.
export function awsEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const drop = new Set([
    'AWS_PROFILE',
    'AWS_DEFAULT_PROFILE',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
  ]);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || drop.has(k)) continue;
    // Endpoint overrides are a data-exfiltration vector: an inherited
    // AWS_ENDPOINT_URL / AWS_ENDPOINT_URL_<SERVICE> would redirect calls off real
    // AWS even though we strip the --endpoint-url flag. Drop them so the pinned
    // profile/region truly determine where requests go.
    if (k === 'AWS_ENDPOINT_URL' || k.startsWith('AWS_ENDPOINT_URL_')) continue;
    env[k] = v;
  }
  return env;
}

async function spawn(cmd: string[], env: Record<string, string>, timeoutMs: number): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, {
    cwd: process.cwd(),
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const timedOut = proc.exitCode === null && proc.signalCode != null;
  return { code: proc.exitCode, stdout: cap(stdout), stderr: cap(stderr), timedOut };
}

// Run `aws --profile <PROFILE> --region <REGION> <args>` under the AWS env.
export function runAws(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CommandResult> {
  return spawn(['aws', '--profile', PROFILE, '--region', REGION, ...args], awsEnv(), timeoutMs);
}

// Run a shell command in the repo cwd under the AWS-stripped shell env.
export function runBash(command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CommandResult> {
  return spawn(['/bin/zsh', '-lc', command], shellEnv(), timeoutMs);
}

// Render a CommandResult as the string the tool returns to the agent.
export function formatResult(r: CommandResult): string {
  const parts: string[] = [];
  if (r.timedOut) parts.push('[command timed out]');
  if (r.stdout.trim()) parts.push(r.stdout.trimEnd());
  if (r.stderr.trim()) parts.push(`[stderr]\n${r.stderr.trimEnd()}`);
  parts.push(`[exit code: ${r.code ?? 'killed'}]`);
  return parts.join('\n');
}
