// The spawning layer for the aws_cli and bash tools. Every AWS command is pinned
// to ONE profile/region here; the bash subprocess runs with a stripped, allowlisted,
// HOME-jailed env so it cannot reach AWS at all (LAYER 2 of the boundary — see
// bash-core.ts for LAYER 1/3).
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellEnv } from './bash-core';

// The single pinned AWS identity. Env-overridable for deploys, but the agent and
// the user can never change it at runtime.
export const PROFILE = process.env.REFERENCE_AWS_PROFILE ?? 'default';
export const REGION = process.env.REFERENCE_AWS_REGION ?? 'us-east-1';

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT_MS = 60_000;

// The directory the bash/repo work operates on: the invocation cwd by default (a
// globally-linked bin runs with the caller's cwd), or an explicit CWD override.
export function resolveCwd(): string {
  const override = process.env.CWD?.trim();
  return override || process.cwd();
}

// A scratch HOME for the bash subprocess so the AWS default credential chain
// ($HOME/.aws/…) and other HOME-based credential stores resolve to an empty dir —
// closing the "child process re-reads ~/.aws" bypass. Best-effort, not a sandbox.
// Created once; failure is non-fatal (the /dev/null pins still apply).
const BASH_JAIL_HOME = join(tmpdir(), 'reference-bash-home');
try {
  mkdirSync(BASH_JAIL_HOME, { recursive: true });
} catch {
  // ignore — shellEnv still jails the AWS_* discovery vars
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function cap(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

// AWS CLI env: drop EVERY ambient AWS_* var. A denylist keeps missing credential
// sources (AWS_ROLE_ARN / AWS_WEB_IDENTITY_TOKEN_FILE, the container-cred vars
// AWS_CONTAINER_CREDENTIALS_*, SSO, endpoint overrides, config-file paths) — any of
// which could feed the CLI credential chain a DIFFERENT account or an off-AWS
// endpoint, escaping the single-account model. With them all unset, the pinned
// --profile/--region flags plus the CLI's trusted default config (~/.aws/config,
// ~/.aws/credentials) fully determine the call.
export function awsEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k.startsWith('AWS_')) continue;
    env[k] = v;
  }
  return env;
}

async function spawn(
  cmd: string[],
  env: Record<string, string>,
  timeoutMs: number,
  cwd: string,
): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, {
    cwd,
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
  return spawn(['aws', '--profile', PROFILE, '--region', REGION, ...args], awsEnv(), timeoutMs, process.cwd());
}

// Run a shell command in the working dir under the AWS-stripped, HOME-jailed env.
// Uses `zsh -f -c` (NO_RCS), NOT `-lc`: a login/interactive shell would source
// startup files (.zshenv/.zprofile/.zshrc) from HOME, and since HOME is a writable
// jail dir a command could plant `$HOME/.zprofile` with a hidden rm/aws that the
// NEXT invocation runs before the classified command. `-f` skips ALL startup files.
export function runBash(command: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CommandResult> {
  return spawn(['/bin/zsh', '-f', '-c', command], shellEnv(process.env, BASH_JAIL_HOME), timeoutMs, resolveCwd());
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
