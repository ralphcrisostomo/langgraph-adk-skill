// Pure (no-spawn) classification + sanitization for the aws_cli tool. Every helper
// here is unit-tested without touching AWS. The invariants:
//   1. strip managed flags so user input can't escape the pinned profile/region,
//   2. classify read vs write, FAIL-SAFE to write (unknown op -> approval-gated),
//   3. recognise explicit approvals.

// Value-taking managed flags: drop the flag AND its following value token.
//   --endpoint-url is a data-exfiltration vector (redirects calls off real AWS).
export const MANAGED_VALUE_FLAGS = new Set(['--profile', '--region', '--output', '--endpoint-url']);

// Boolean managed flags: drop ONLY the flag. --no-sign-request would run UNSIGNED
// against public buckets, ignoring the account boundary; strip it so the command
// re-runs signed under the pinned profile. Eating the next token would corrupt it.
export const MANAGED_BOOL_FLAGS = new Set(['--no-sign-request']);

// Global value-taking flags whose VALUE token must be skipped when locating the
// service/operation positionals, so a flag value isn't mistaken for the command.
const GLOBAL_VALUE_FLAGS = new Set([
  '--profile',
  '--region',
  '--output',
  '--endpoint-url',
  '--query',
  '--filters',
  '--cli-input-json',
  '--cli-binary-format',
  '--ca-bundle',
  '--color',
  '--cli-connect-timeout',
  '--cli-read-timeout',
  '--page-size',
  '--max-items',
  '--starting-token',
]);

export const READ_VERBS = [
  'describe',
  'list',
  'get',
  'head',
  'lookup',
  'search',
  'scan',
  'query',
  'batch-get',
  'select',
];

// s3api ops that match a read verb (get-/select-) but write a required LOCAL
// outfile, so they must be treated as writes.
export const S3API_LOCAL_WRITE_OPS = new Set(['get-object', 'select-object-content']);

function flagName(token: string): string {
  const eq = token.startsWith('--') ? token.indexOf('=') : -1;
  return eq !== -1 ? token.slice(0, eq) : token;
}

// Remove managed flags from the aws argument list (everything after "aws").
export function stripManagedFlags(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const name = flagName(a);
    const inlineValue = a.startsWith('--') && a.includes('=');
    if (MANAGED_VALUE_FLAGS.has(name)) {
      if (!inlineValue) i++; // also drop the separate value token
      continue;
    }
    if (MANAGED_BOOL_FLAGS.has(name)) continue; // drop ONLY the flag
    out.push(a);
  }
  return out;
}

// Locate the service + operation positionals, skipping the value token of global
// value-flags so a flag value isn't mistaken for the command.
export function serviceAndOperation(args: string[]): { service?: string; operation?: string } {
  const positionals: string[] = [];
  for (let i = 0; i < args.length && positionals.length < 2; i++) {
    const a = args[i]!;
    if (a.startsWith('-')) {
      const name = flagName(a);
      const inlineValue = a.startsWith('--') && a.includes('=');
      if (!inlineValue && GLOBAL_VALUE_FLAGS.has(name)) i++; // skip the flag's value token
      continue;
    }
    positionals.push(a);
  }
  return { service: positionals[0], operation: positionals[1] };
}

export function isReadCommand(args: string[]): boolean {
  const { service, operation } = serviceAndOperation(args);
  if (!service) return false; // unknown shape -> fail-safe to write
  if (service === 's3') return operation === 'ls'; // high-level s3: only `ls` reads
  if (!operation) return false;
  if (service === 's3api' && S3API_LOCAL_WRITE_OPS.has(operation)) return false; // writes local outfile
  return READ_VERBS.some((v) => operation === v || operation.startsWith(`${v}-`));
}

export function isWriteCommand(args: string[]): boolean {
  return !isReadCommand(args);
}

// Only an explicit y/yes approves a write; everything else (incl. empty) denies.
export function isApproval(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === 'y' || a === 'yes';
}
