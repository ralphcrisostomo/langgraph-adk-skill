// Pure (no-spawn) classification for the bash tool: detect delete operations
// (approval-gated) and reject any attempt to invoke `aws` (so raw AWS commands
// can't escape the pinned profile via the shell). This is LAYER 1 of the AWS
// boundary; LAYER 2 — a stripped subprocess env — lives in command-runtime.ts.
import { SEPARATORS, stripPath, tokenize } from './shell-tokens';

// Commands that delete on their own.
const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'unlink', 'shred']);

// Two-word deletes: `git rm`, `docker rm`, `kubectl delete`, …
const SUBCOMMAND_DELETES: Record<string, Set<string>> = {
  git: new Set(['rm']),
  docker: new Set(['rm', 'rmi']),
  podman: new Set(['rm', 'rmi']),
  kubectl: new Set(['delete']),
};

// Flags that turn a traversal into a deletion: `find … -delete`, `rsync --delete`.
const DELETE_FLAGS = new Set(['-delete', '--delete']);

// Shell interpreters whose `-c "<cmd>"` argument is a nested command to re-check.
const SHELL_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'fish']);

// Interpreter options that CONSUME the next token as their value, so we step over
// it while scanning for `-c` (e.g. `bash -o pipefail -c "<cmd>"`).
const SHELL_VALUE_FLAGS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);

// Wrappers that pass through to the command that follows them (so `sudo aws …`
// and `env AWS_PROFILE=x aws …` still resolve `aws` as the invoked program).
const COMMAND_PREFIXES = new Set([
  'env',
  'sudo',
  'nohup',
  'exec',
  'command',
  'builtin',
  'time',
  'timeout',
  'xargs',
  'setsid',
  'nice',
  'ionice',
  'stdbuf',
]);

// Short options on the wrappers above that CONSUME the following token as their
// value (e.g. `sudo -u root`, `env -C dir`, `nice -n 5`, `timeout -k 5`). We skip
// that value so `sudo -u root aws …` still resolves `aws` as the invoked program.
// `-i` is intentionally excluded: `env -i` takes no value, and treating it as
// value-taking would let `env -i aws …` swallow the `aws` token.
const WRAPPER_VALUE_FLAGS = new Set([
  '-u',
  '-C',
  '-S',
  '-g',
  '-h',
  '-p',
  '-r',
  '-t',
  '-U',
  '-D',
  '-R',
  '-s',
  '-k',
  '-n',
  '-c',
  '-o',
  '-e',
  '-I',
  '-L',
  '-P',
  '-d',
  '-E',
  '-a',
]);

export function requestsDelete(command: string): boolean {
  const tokens = tokenize(command);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const base = stripPath(t);
    if (DELETE_COMMANDS.has(base)) return true;
    if (DELETE_FLAGS.has(t)) return true;
    const subs = SUBCOMMAND_DELETES[base];
    if (subs && tokens[i + 1] && subs.has(tokens[i + 1]!)) return true;
  }
  // A shell-expanded command name (`$cmd -rf build`, `$(…)`, backticks) in command
  // position can't be classified statically — require approval rather than run it
  // blind, since it may resolve to `rm` (or any deletion).
  if (commandHeads(tokens).some(hasShellExpansion)) return true;
  // Deletes hidden inside `bash -c "rm …"` / `eval "rm …"`.
  return nestedCommandStrings(tokens).some(requestsDelete);
}

function isAwsProgramToken(token: string): boolean {
  return stripPath(token) === 'aws';
}

// The command-position token of each simple command in the string: the program
// actually being invoked, after transparently stepping over env-assignments,
// pass-through wrappers (env/sudo/timeout/…) and their options/values. Everything
// after a head is that command's arguments (so a later `aws`/`rm` there is benign).
function commandHeads(tokens: string[]): string[] {
  const heads: string[] = [];
  let pending = true; // are we still looking for this segment's command word?
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (SEPARATORS.has(t)) {
      pending = true; // a new simple command starts after a separator
      continue;
    }
    if (!pending) continue; // inside the current command's arguments
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue; // VAR=val prefix
    if (t.startsWith('-')) {
      if (WRAPPER_VALUE_FLAGS.has(t)) i++; // skip this option's value token too
      continue; // an option belonging to a wrapper we already stepped over
    }
    if (COMMAND_PREFIXES.has(stripPath(t))) continue; // transparent wrapper
    if (/^\d+[smhd]?$/.test(t)) continue; // a wrapper positional (e.g. timeout's duration)
    heads.push(t); // this token is the invoked program
    pending = false;
  }
  return heads;
}

// A shell-expanded / substituted token (`$cmd`, `${cmd}`, `$(…)`, backticks)
// whose real value we cannot know by static inspection.
function hasShellExpansion(token: string): boolean {
  return token.includes('$') || token.includes('`');
}

// `aws` is INVOKED (not merely an argument) when it sits in command position of any
// simple command. A later `aws` among a real command's args is harmless (`rg aws src`).
export function invokesAwsDirectly(command: string): boolean {
  return commandHeads(tokenize(command)).some(isAwsProgramToken);
}

// Inline `AWS_*=…` assignments (e.g. `AWS_CONFIG_FILE=~/.aws/config aws …`) would
// re-point the AWS CLI at the user's real credentials/config from inside `zsh -lc`,
// overriding the stripped shell env. Refuse any command that sets an AWS_* var inline.
export function assignsAwsEnv(command: string): boolean {
  const tokens = tokenize(command);
  if (tokens.some((t) => /^AWS_[A-Za-z0-9_]+=/.test(t))) return true;
  return nestedCommandStrings(tokens).some(assignsAwsEnv);
}

// Pull out inline command strings from `<shell> -c "<cmd>"` and `eval "<cmd>"`
// so the classifier can recurse into nested shells (the classic bypass).
export function nestedCommandStrings(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const base = stripPath(tokens[i]!);
    if (SHELL_INTERPRETERS.has(base)) {
      for (let j = i + 1; j < tokens.length; j++) {
        const tj = tokens[j]!;
        if (SEPARATORS.has(tj)) break;
        if (SHELL_VALUE_FLAGS.has(tj)) {
          j++; // step over the option's value (e.g. `-o pipefail`) and keep scanning
          continue;
        }
        if (tj.startsWith('-')) {
          if (/c/.test(tj)) {
            if (tokens[j + 1] !== undefined) out.push(tokens[j + 1]!);
            break;
          }
          continue; // a flag without 'c' (e.g. -l, -i) -> keep scanning for -c
        }
        // a non-flag token (likely a script path); keep scanning in case -c follows
      }
    } else if (base === 'eval') {
      const parts: string[] = [];
      for (let j = i + 1; j < tokens.length; j++) {
        if (SEPARATORS.has(tokens[j]!)) break;
        parts.push(tokens[j]!);
      }
      if (parts.length) out.push(parts.join(' '));
    }
  }
  return out;
}

export function containsRawAws(command: string): boolean {
  if (invokesAwsDirectly(command)) return true;
  return nestedCommandStrings(tokenize(command)).some(containsRawAws);
}

// LAYER 2 of the AWS boundary: the bash subprocess env. Drop EVERY inherited
// AWS_* var and point credential/config discovery at nothing, so even an
// obfuscated `aws --profile other` finds no profile and no credentials.
export function shellEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k.startsWith('AWS_')) continue; // drop creds, profile, region, config paths
    env[k] = v;
  }
  env.AWS_CONFIG_FILE = '/dev/null';
  env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
  env.AWS_EC2_METADATA_DISABLED = 'true'; // block IMDS creds on EC2
  return env;
}
