// Pure (no-spawn) classification for the bash tool: detect delete operations
// (approval-gated) and reject any attempt to invoke / re-arm `aws` (so raw AWS
// can't escape the pinned profile via the shell). This is LAYER 1 of the AWS
// boundary; LAYER 2/3 — a stripped, allowlisted, HOME-jailed subprocess env — live
// in shellEnv (below) + command-runtime.ts. A string classifier is BEST-EFFORT:
// every gate below guards a real bypass, but the env boundary is what makes a
// missed obfuscation HARMLESS (no creds -> it just fails). These gates were
// hardened across many adversarial review rounds; do not simplify them away.
import { REDIR, SEPARATORS, stripPath, tokenize } from './shell-tokens';

// Programs that delete on their own.
const DELETE_HEADS = new Set(['rm', 'rmdir', 'unlink', 'shred']);

// Subcommand deletes: `git rm`/`git clean`, `docker rm/rmi`, `kubectl delete`, …
const SUBCOMMAND_DELETES: Record<string, Set<string>> = {
  git: new Set(['rm', 'clean']), // `git clean -fd` permanently removes untracked files
  docker: new Set(['rm', 'rmi']),
  podman: new Set(['rm', 'rmi']),
  kubectl: new Set(['delete']),
};

// Global options (BEFORE the subcommand) that take a value, per program — skip their
// values when locating the destructive subcommand, else `git -C . rm` reads `.`.
const SUBCOMMAND_GLOBAL_VALUE_FLAGS: Record<string, Set<string>> = {
  git: new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']),
  docker: new Set(['--context', '-H', '--host', '--config', '--log-level', '-l', '--tlscacert', '--tlscert', '--tlskey']),
  podman: new Set(['--context', '--connection', '-c', '--url', '--runtime', '--root', '--runroot', '--storage-driver', '--namespace', '--cgroup-manager', '--log-level']),
  kubectl: new Set(['-n', '--namespace', '--context', '--cluster', '--kubeconfig', '--user', '--as', '--as-group', '-s', '--server', '--token', '--cache-dir', '--request-timeout', '--tls-server-name']),
};

// Flags that turn a traversal into a deletion: `find … -delete`.
const FIND_DELETE_FLAGS = new Set(['-delete', '--delete']);
// `find … -exec/-execdir/-ok/-okdir <prog> …` runs <prog> per match — recurse into it.
const FIND_EXEC_FLAGS = new Set(['-exec', '-execdir', '-ok', '-okdir']);

// Shell interpreters whose `-c "<cmd>"` is a nested SHELL command to re-check.
const SHELL_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'fish']);
// Interpreter options that CONSUME the next token (skip when scanning for `-c`).
const SHELL_VALUE_FLAGS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);

// General-purpose interpreters whose inline code / script / stdin is NOT shell —
// `python -c 'os.remove(...)'`, `node -e 'fs.rmSync(...)'`, … — opaque to the
// classifier; any such invocation can delete files.
const CODE_INTERPRETERS = new Set([
  'python', 'python2', 'python3', 'node', 'bun', 'deno', 'ruby', 'perl', 'php',
  'Rscript', 'pwsh', 'powershell', 'osascript', 'lua', 'luajit', 'tclsh', 'groovy',
]);
const INTERP_INFO_FLAGS = new Set(['--version', '-V', '-v', '--help', '-h']);

// Pass-through wrappers: the REAL command is whatever they invoke, so step over them
// (and their option values) when finding a command's head.
const COMMAND_PREFIXES = new Set([
  'env', 'sudo', 'nohup', 'exec', 'command', 'builtin',
  'time', 'timeout', 'xargs', 'setsid', 'nice', 'ionice', 'stdbuf',
]);

// Wrapper options that CONSUME the next token, keyed PER WRAPPER (short + long
// forms). A flat union is wrong — a valueless flag for one wrapper (`sudo -E`,
// `command -p`) would wrongly swallow the real command. Only flags that take a value
// FOR THAT wrapper consume the next token.
const WRAPPER_VALUE_FLAGS: Record<string, Set<string>> = {
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string', '--block-signal', '--default-signal', '--ignore-signal']),
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '--user', '--group', '--host', '--prompt', '--close-from', '--chdir', '--type', '--role', '--other-user']),
  nice: new Set(['-n', '--adjustment']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  ionice: new Set(['-c', '-n', '-p', '--class', '--classdata', '--pid', '--pgid', '--uid']),
  stdbuf: new Set(['-i', '-o', '-e', '--input', '--output', '--error']),
  xargs: new Set(['-a', '-d', '-E', '-I', '-L', '-n', '-P', '-s', '--arg-file', '--delimiter', '--eof', '--replace', '--max-lines', '--max-args', '--max-procs', '--max-chars']),
  exec: new Set(['-a']),
  time: new Set(['--format']),
};

// Compound-command reserved words. In COMMAND POSITION they introduce a list rather
// than being the command, so step over them — else `if true; then rm; fi` keeps
// `then` as the head and hides `rm`. `{`/`}` are already separators. `time` is NOT
// here — it's a COMMAND_PREFIX so the walker also records `wrapper='time'` and skips
// its `--format` value (`time --format '%E' rm x` must resolve to `rm`).
const CONTROL_KEYWORDS = new Set([
  'if', 'then', 'elif', 'else', 'fi', 'while', 'until', 'do', 'done',
  'for', 'select', 'case', 'esac', 'in', 'function', '!', '[[', ']]',
]);

const hasShellExpansion = (token: string): boolean => token.includes('$') || token.includes('`');

// Does this wrapper option token take the NEXT token as its value? Handles long
// `--flag` (separated form; `--flag=value` is self-contained) AND grouped short
// clusters — `sudo -Eu root` is `-E -u root`, so a value-flag whose letter is LAST
// in the cluster consumes the next token; if more chars follow the value is attached
// (`-uroot`) and nothing extra is consumed.
function wrapperFlagConsumesNext(wrapper: string, token: string): boolean {
  const vf = WRAPPER_VALUE_FLAGS[wrapper];
  if (!vf) return false;
  if (token.startsWith('--')) {
    const eq = token.indexOf('=');
    return eq < 0 && vf.has(token);
  }
  for (let p = 1; p < token.length; p++) {
    if (vf.has('-' + token[p]!)) return p === token.length - 1;
  }
  return false;
}

// Split a token stream into simple commands as { head, args }. For each command
// (reset on a separator) step transparently over redirections, `VAR=val` prefixes,
// compound-command keywords, pass-through wrappers and their value tokens, and the
// timeout duration positional — so `head` is the program actually invoked.
export interface SimpleCommand {
  head: string;
  args: string[];
}

export function simpleCommands(tokens: string[]): SimpleCommand[] {
  const cmds: SimpleCommand[] = [];
  let cur: SimpleCommand | null = null;
  let wrapper = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (SEPARATORS.has(t)) {
      cur = null;
      wrapper = '';
      continue;
    }
    if (t.startsWith(REDIR)) {
      const next = tokens[i + 1];
      if (next !== undefined && !SEPARATORS.has(next) && !next.startsWith(REDIR)) i++; // skip target
      continue;
    }
    if (cur) {
      cur.args.push(t);
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue; // VAR=val prefix
    if (t.startsWith('-')) {
      if (wrapperFlagConsumesNext(wrapper, t)) i++; // `sudo -u root`, `sudo -Eu root`, …
      continue;
    }
    if (CONTROL_KEYWORDS.has(t)) continue;
    if (COMMAND_PREFIXES.has(stripPath(t))) {
      wrapper = stripPath(t);
      continue;
    }
    if (/^\d+[smhd]?$/.test(t)) continue; // timeout duration positional
    cur = { head: t, args: [] };
    cmds.push(cur);
  }
  return cmds;
}

export function commandHeads(tokens: string[]): string[] {
  return simpleCommands(tokens).map((c) => c.head);
}

// Nested SHELL command strings: the `-c` arg of a shell interpreter (skipping
// value-taking interpreter options) and the first string arg of `eval`.
export function nestedCommandStrings(tokens: string[]): string[] {
  const out: string[] = [];
  for (const c of simpleCommands(tokens)) {
    const head = stripPath(c.head);
    if (head === 'eval') {
      const s = c.args.find((a) => !a.startsWith('-'));
      if (s !== undefined) out.push(s);
      continue;
    }
    if (!SHELL_INTERPRETERS.has(head)) continue;
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i]!;
      if (SHELL_VALUE_FLAGS.has(a)) {
        i++;
        continue;
      }
      if (a === '-c' || /^-[A-Za-z]*c$/.test(a)) {
        const cmd = c.args[i + 1];
        if (cmd !== undefined) out.push(cmd);
        break;
      }
    }
  }
  return out;
}

// Command-substitution bodies inside any token (`$(…)`, backticks). A substitution
// in ARGUMENT position (`echo $(rm -rf x)`) runs before the outer command, so its
// body must be gated too. Extracted from raw token text (substitution markers are
// kept by the tokenizer); recursion terminates (each body is a substring).
//
// KNOWN over-approximation (safe): a SINGLE-quoted `'$(rm)'` is inert at this level
// but the tokenizer strips the quotes, so it's still flagged — `echo '$(rm)'`
// over-asks for approval. This is deliberate: the SAME token also feeds
// nestedCommandStrings, and `bash -c '$(rm)'` IS re-expanded by the inner shell and
// MUST stay gated. Suppressing single-quoted substitutions here (without separate
// per-token quote provenance) would turn that into an UNDER-gate — do not "fix" it
// by neutralizing quoted markers.
export function substitutionBodies(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    let i = 0;
    while (i < t.length) {
      if (t[i] === '$' && t[i + 1] === '(') {
        i += 2;
        let depth = 1;
        let body = '';
        while (i < t.length && depth > 0) {
          const c = t[i]!;
          // Quote-aware: a quoted paren must not change depth (mirrors the tokenizer),
          // else `$(printf ')' ; rm …)` extracts only `printf '` and the rm escapes.
          if (c === "'" || c === '"') {
            body += c;
            i++;
            while (i < t.length && t[i] !== c) {
              body += t[i]!;
              i++;
            }
            if (i < t.length) {
              body += t[i]!;
              i++;
            }
            continue;
          }
          if (c === '(') depth++;
          else if (c === ')') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          body += c;
          i++;
        }
        out.push(body);
        continue;
      }
      if (t[i] === '`') {
        i++;
        let body = '';
        while (i < t.length && t[i] !== '`') {
          body += t[i]!;
          i++;
        }
        if (i < t.length) i++;
        out.push(body);
        continue;
      }
      i++;
    }
  }
  return out;
}

// Command strings that `env --split-string` (`-S`) runs: env splits the single -S
// argument into argv, so that value is a full command and must be gated.
function envSplitStrings(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (SEPARATORS.has(tokens[i]!)) continue;
    if (stripPath(tokens[i]!) !== 'env') continue;
    for (let j = i + 1; j < tokens.length; j++) {
      const a = tokens[j]!;
      if (SEPARATORS.has(a)) break;
      if (a === '-S' || a === '--split-string') {
        if (tokens[j + 1] !== undefined) out.push(tokens[j + 1]!);
        break;
      }
      if (a.startsWith('-S') && a.length > 2) {
        out.push(a.slice(2));
        break;
      }
      if (a.startsWith('--split-string=')) {
        out.push(a.slice('--split-string='.length));
        break;
      }
      if (!a.startsWith('-')) break; // reached env's NAME=VAL or the command word
      if (a === '-u' || a === '-C' || a === '--unset' || a === '--chdir') j++;
    }
  }
  return out;
}

// Token slices that `find -exec/-execdir/-ok/-okdir … {} ;/+` runs — everything
// after the exec flag is itself a command (`find … -exec rm {} +` or
// `find … -exec sh -c 'rm …' {} ;`), so recurse into it.
function findExecTokenSlices(tokens: string[]): string[][] {
  const slices: string[][] = [];
  for (const c of simpleCommands(tokens)) {
    if (stripPath(c.head) !== 'find') continue;
    for (let k = 0; k < c.args.length; k++) {
      if (FIND_EXEC_FLAGS.has(c.args[k]!)) slices.push(c.args.slice(k + 1));
    }
  }
  return slices;
}

// Shell commands smuggled through an inline git config alias: `git -c
// alias.x='!rm -rf build' x` runs the `!…` body through the shell.
function gitAliasCommands(tokens: string[]): string[] {
  const out: string[] = [];
  for (const c of simpleCommands(tokens)) {
    if (stripPath(c.head) !== 'git') continue;
    for (let k = 0; k < c.args.length; k++) {
      const a = c.args[k]!;
      const val = a === '-c' ? c.args[k + 1] : a.startsWith('-c=') ? a.slice(3) : undefined;
      if (val === undefined) continue;
      const eq = val.indexOf('=');
      if (eq < 0) continue;
      const v = val.slice(eq + 1);
      if (v.startsWith('!')) out.push(v.slice(1));
    }
  }
  return out;
}

// All nested string fragments to recurse the gates into: shell `-c`/eval strings,
// command-substitution bodies, env -S strings, and inline git alias bodies.
function descend(tokens: string[]): string[] {
  return [
    ...nestedCommandStrings(tokens),
    ...substitutionBodies(tokens),
    ...envSplitStrings(tokens),
    ...gitAliasCommands(tokens),
  ];
}

// Does a command run code the classifier can't see (so the DELETE gate, which has
// no env-jail backstop, must approval-gate it)?
//   - shell interpreter WITHOUT `-c` reads a script from stdin (`printf 'rm' | sh`)
//     or a file (`bash deploy.sh`); WITH `-c` the shell string is recursed elsewhere.
//   - code interpreter runs non-shell code via `-c`/`-e`/script/stdin — opaque — so
//     gate any invocation except a pure `--version`/`--help`.
function runsOpaqueCode(head: string, args: string[]): boolean {
  if (SHELL_INTERPRETERS.has(head)) {
    return !args.some((a) => a === '-c' || /^-[A-Za-z]*c$/.test(a));
  }
  if (CODE_INTERPRETERS.has(head)) {
    return !(args.length > 0 && args.every((a) => INTERP_INFO_FLAGS.has(a)));
  }
  return false;
}

// The subcommand of a subcommand-style program, skipping global options AND the
// values of global value-flags before it — so `git -C . rm` resolves to `rm`.
function subcommandOf(head: string, args: string[]): string | undefined {
  const gv = SUBCOMMAND_GLOBAL_VALUE_FLAGS[head];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('-')) {
      const eq = a.indexOf('=');
      const base = eq >= 0 ? a.slice(0, eq) : a;
      if (eq < 0 && gv?.has(base)) i++;
      continue;
    }
    return a;
  }
  return undefined;
}

// Approval-gate literal deletes (rm/rmdir/unlink/shred, find -delete, subcommand
// deletes like `git rm`/`git clean`/`kubectl delete`), opaque code interpreters,
// AND the unclassifiable — a shell-expanded command head (`$cmd`, `$(…)`, backticks)
// could resolve to rm. Recurse into every nested context.
function requestsDeleteTokens(tokens: string[]): boolean {
  // A `-delete`/`--delete` FLAG token anywhere is destructive (`find … -delete`,
  // `rsync --delete`). Scan flat — `find … -exec grep {} \; -delete` fragments the
  // find command across the escaped `\;` / `{}` separators, so the flag may not sit
  // in find's own args. Over-gating a literal `-delete` argument is rare and safe.
  if (tokens.some((t) => FIND_DELETE_FLAGS.has(t))) return true;
  for (const c of simpleCommands(tokens)) {
    if (hasShellExpansion(c.head)) return true; // opaque command name
    const head = stripPath(c.head);
    if (DELETE_HEADS.has(head)) return true;
    if (runsOpaqueCode(head, c.args)) return true; // shell/code interpreter running opaque code
    const subs = SUBCOMMAND_DELETES[head];
    if (subs) {
      const sub = subcommandOf(head, c.args);
      if (sub && subs.has(sub)) return true;
    }
  }
  if (descend(tokens).some((s) => requestsDeleteTokens(tokenize(s)))) return true;
  return findExecTokenSlices(tokens).some(requestsDeleteTokens);
}

export function requestsDelete(command: string): boolean {
  return requestsDeleteTokens(tokenize(command));
}

function isAwsProgramToken(token: string): boolean {
  return stripPath(token) === 'aws';
}

// `aws` is INVOKED (not merely an argument) when it sits in command position of any
// simple command. A later `aws` among a real command's args is harmless (`rg aws src`).
export function invokesAwsDirectly(command: string): boolean {
  return commandHeads(tokenize(command)).some(isAwsProgramToken);
}

// `aws` invoked as a program here, or inside ANY nested context (shell -c/eval,
// command substitutions, env -S strings, git alias bodies, find -exec sub-commands).
// An opaque head (`$(echo aws)`) could resolve to `aws`, so it's refused too.
function containsRawTokens(tokens: string[]): boolean {
  if (commandHeads(tokens).some((h) => isAwsProgramToken(h) || hasShellExpansion(h))) return true;
  if (descend(tokens).some((s) => containsRawTokens(tokenize(s)))) return true;
  return findExecTokenSlices(tokens).some(containsRawTokens);
}

export function containsRawAws(command: string): boolean {
  return containsRawTokens(tokenize(command));
}

// An inline `AWS_*=` assignment in COMMAND-PREFIX position — `AWS_CONFIG_FILE=… aws
// …` — re-points the CLI at real credentials. Only a LEADING assignment (before the
// head, stepping over other VAR= prefixes / wrappers) counts; an `AWS_FOO=` that
// appears as an ARGUMENT (`rg 'AWS_PROFILE=' src`) is data and must NOT be refused.
function hasLeadingAwsAssignment(tokens: string[]): boolean {
  let seekingHead = true;
  let wrapper = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (SEPARATORS.has(t)) {
      seekingHead = true;
      wrapper = '';
      continue;
    }
    if (t.startsWith(REDIR)) {
      const next = tokens[i + 1];
      if (next !== undefined && !SEPARATORS.has(next) && !next.startsWith(REDIR)) i++;
      continue;
    }
    if (!seekingHead) continue;
    if (/^AWS_[A-Za-z0-9_]+=/.test(t)) return true;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;
    if (t.startsWith('-')) {
      if (wrapperFlagConsumesNext(wrapper, t)) i++;
      continue;
    }
    if (CONTROL_KEYWORDS.has(t)) continue;
    if (COMMAND_PREFIXES.has(stripPath(t))) {
      wrapper = stripPath(t);
      continue;
    }
    if (/^\d+[smhd]?$/.test(t)) continue;
    seekingHead = false;
  }
  return false;
}

// Unsetting an AWS_* var removes the /dev/null pins shellEnv installed, so a CHILD
// process (a python/perl/node one-liner that calls `aws`) inherits no protective
// pins and falls back to ~/.aws. A string classifier CANNOT detect "this program
// will spawn aws later", so the only correct defense is to refuse mutating the AWS
// env at all. Covers `env -u AWS_X`, `env --unset[=]AWS_X`, and the `unset` builtin.
function unsetsAwsEnv(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (/^--unset=AWS_[A-Za-z0-9_]+$/.test(t)) return true;
    if ((t === '-u' || t === '--unset') && tokens[i + 1] && /^AWS_[A-Za-z0-9_]+$/.test(tokens[i + 1]!)) {
      return true;
    }
    if (stripPath(t) === 'unset') {
      for (let j = i + 1; j < tokens.length; j++) {
        const tj = tokens[j]!;
        if (SEPARATORS.has(tj)) break;
        if (tj.startsWith('-')) continue;
        if (/^AWS_[A-Za-z0-9_]+$/.test(tj)) return true;
      }
    }
  }
  return false;
}

// Shell builtins that SET env vars from their arguments — `export AWS_X=v`,
// `declare -x AWS_X=v`, `typeset`/`local`/`readonly AWS_X=v` — re-point the CLI just
// like a leading assignment. The `AWS_*=` here is an ARGUMENT to the builtin, so the
// leading-position check misses it; catch it explicitly. (An `AWS_*=` argument to a
// NON-assignment program — `rg 'AWS_PROFILE=' src` — is data and stays allowed.)
const ASSIGNMENT_BUILTINS = new Set(['export', 'declare', 'typeset', 'local', 'readonly']);

function assignsAwsViaBuiltin(tokens: string[]): boolean {
  for (const c of simpleCommands(tokens)) {
    if (!ASSIGNMENT_BUILTINS.has(stripPath(c.head))) continue;
    // `export AWS_X=v` (set) or `export AWS_X` (mark an existing AWS_ var for export).
    if (c.args.some((a) => /^AWS_[A-Za-z0-9_]+=?/.test(a))) return true;
  }
  return false;
}

// Refuse any command that mutates the AWS env — inline assignment (re-point creds),
// `export`/`declare` of an AWS_* var, or unset (disarm the pins for a child
// interpreter). Recurse into every nested context so a buried form is caught too.
function tampersTokens(tokens: string[]): boolean {
  if (hasLeadingAwsAssignment(tokens)) return true;
  if (assignsAwsViaBuiltin(tokens)) return true;
  if (unsetsAwsEnv(tokens)) return true;
  if (descend(tokens).some((s) => tampersTokens(tokenize(s)))) return true;
  return findExecTokenSlices(tokens).some(tampersTokens);
}

export function tampersWithAwsEnv(command: string): boolean {
  return tampersTokens(tokenize(command));
}

// Variables the bash subprocess is allowed to inherit. Everything else is dropped —
// copying the caller's full env (minus AWS_*) would hand a prompt-injected command
// (or a plain `env`) the model's OPENAI/ANTHROPIC keys, GH/SSH tokens, and any other
// secret to echo back. This is an ALLOWLIST: only the non-secret basics repo
// commands need (PATH, HOME, locale, terminal).
const SHELL_ENV_ALLOWLIST = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LANGUAGE', 'TZ', 'TERM', 'TERMINFO', 'COLORTERM', 'HOSTNAME',
  'PAGER', 'LSCOLORS', 'LS_COLORS', 'EDITOR',
]);

// LAYER 2 of the AWS boundary AND a secret jail. Obfuscation eventually beats any
// string classifier, so the subprocess must be unable to authenticate at all: a
// strict allowlist (no AWS_*, no other credentials reach it), AWS discovery pinned
// at nothing, and — when `home` is given — a jailed HOME so the AWS default
// credential chain (`$HOME/.aws/…`, SSO cache) finds nothing even if a child unsets
// the pins. LIMITATION (best-effort, not a sandbox): a command with the user's
// filesystem privileges could still read creds by absolute path; a hard guarantee
// needs OS-level isolation. NEVER pass process.env to bash directly.
export function shellEnv(
  base: Record<string, string | undefined> = process.env,
  home?: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (SHELL_ENV_ALLOWLIST.has(k) || k.startsWith('LC_')) env[k] = v;
  }
  if (home !== undefined) env.HOME = home; // jail HOME away from the real ~/.aws
  env.AWS_CONFIG_FILE = '/dev/null';
  env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
  env.AWS_EC2_METADATA_DISABLED = 'true'; // block IMDS creds on EC2
  return env;
}
