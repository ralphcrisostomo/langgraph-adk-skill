# Recipe: Merge AWS assistant into chat (plus repo bash tool)

A reusable **chat agent** that lets the end-user drive the AWS CLI and inspect or
edit the repository in natural language. AWS is scoped to ONE account via a
single managed profile. AWS writes and bash delete operations are gated behind
explicit human approval; other bash commands run immediately.

Default shape: merge this into the existing `chat` action as an **agent** with
turn-shape **both** (one-shot via `--input`, otherwise an Ink `<SessionApp>`).
Remove the old `aws-assistant` menu item unless the user explicitly asks to keep
an alias. It composes the standard primitives: one ReAct agent with `aws_cli`,
`bash`, and `query_user` tools.

## Step 0 — ASK FOR THE AWS PROFILE (do this FIRST, every time)

Before generating anything, **ask the user which AWS profile and region the
assistant should run as.** This is mandatory — the whole safety model is "every
AWS command runs through ONE pinned profile/account," so the profile must be a
deliberate choice, never guessed.

- Ask: "Which AWS CLI profile should this assistant use? (must exist in
  `~/.aws/config`/`credentials`)" and "Default region?".
- Bake the answer as the env-backed default in the action:
  ```ts
  const PROFILE = process.env.<APP>_AWS_PROFILE ?? '<profile-they-gave>';
  const REGION  = process.env.<APP>_AWS_REGION  ?? '<region-they-gave>';
  ```
  (`<APP>` = the project's env prefix.) Confirm the profile resolves before
  finishing: `aws --profile <profile> sts get-caller-identity`.
- Every spawned command is `aws --profile ${PROFILE} --region ${REGION} …` — the
  user can never override these (see managed-flag stripping below).

## Step 1 — Pick your path: migrate vs new project

Both paths converge on the same `chat` action + tools described below; they differ
only in setup and teardown.

**New project (no `src/actions/index.ts` yet):**
1. Scaffold first (SKILL.md Step 2A). That gives you the seed `src/actions/chat.tsx`
   (a plain multi-turn chat) and an `index.ts` registry with `chat` already listed.
2. Build the tools **into that seed `chat.tsx`** — do NOT create a new action file.
   Add `aws_cli`, `bash`, `query_user`, the `AGENTS.md` loader, and date injection
   (all below).
3. There is nothing to delete or re-register: `chat` is already the only action.

**Migrate an existing project (has `src/actions/index.ts`, often a separate
`aws-assistant` action):**
1. Inventory what exists: read `src/actions/index.ts` and check for
   `src/actions/aws-assistant.tsx` and any shared modules (`aws-cli-core.ts`, etc.).
2. Fold the AWS tool + gate into `src/actions/chat.tsx` and add the `bash` tool,
   the `AGENTS.md` loader, and date injection. Keep pure logic in separate modules
   (`aws-cli-core.ts`, `bash-core.ts`, `command-runtime.ts`) so they stay testable.
3. **Delete** `src/actions/aws-assistant.tsx` and `tests/aws-assistant.test.ts`,
   and remove its import + array entry from `src/actions/index.ts` so only `chat`
   is registered (unless the user explicitly asked to keep a compatibility alias).
4. Migrate the old action's tests to the new module/test files; don't lose coverage.

## The chat action

- Update `src/actions/chat.tsx`; do not create a separate `aws-assistant` action
  unless explicitly requested.
- `params: []`. Branch on `--input`: one-shot prints the final text + a context
  bar; otherwise render `<SessionApp>` (multi-turn). See the `both` turn-shape in
  SKILL.md Step 3 and `reference/src/actions/assistant.tsx`.
- Build a fresh agent per turn with `createAgent({ model: ctx.llm, tools, systemPrompt })`
  (verify the signature via context7 first). Stream with `streamAgent`.
- Load repository instructions from root `AGENTS.md` on every turn and append them
  to the chat system prompt in a fenced `md` block before the current date/time.
  Use helpers shaped like:
  ```ts
  const REPO_INSTRUCTIONS_FILE = 'AGENTS.md';

  export async function loadRepoInstructions(cwd = process.cwd()): Promise<string | undefined> {
    const file = Bun.file(`${cwd}/${REPO_INSTRUCTIONS_FILE}`);
    if (!(await file.exists())) return undefined;
    const text = (await file.text()).trim();
    return text || undefined;
  }

  export function buildSystemPrompt(repoInstructions: string | undefined, now = new Date()): string {
    const sections = [SYSTEM_PROMPT];
    if (repoInstructions) {
      sections.push([
        `Repository instructions from ${REPO_INSTRUCTIONS_FILE}:`,
        '```md',
        repoInstructions,
        '```',
      ].join('\n'));
    }
    sections.push(`Current date and time: ${currentDateTime(now)}`);
    return sections.join('\n\n');
  }
  ```
- Tools: `aws_cli` (below), `bash` (below), `query_user` (human clarification),
  and optionally `load_doc` (domain knowledge — see "Knowledge docs" below).
- Register only `chat` in `src/actions/index.ts` after the merge, unless the user
  chose a compatibility alias.

## The `bash` tool + repo safety gate

The bash tool lets chat search files, inspect content, and make approved repo
changes. Keep this tool separate from `aws_cli` so raw AWS commands cannot escape
the pinned AWS profile/region.

- Run from the project working directory with capped stdout/stderr and a timeout.
- Run bash commands immediately unless they request deletion or can't be classified.
- Require approval for delete operations: `rm`, `rmdir`, `unlink`, `shred`,
  `find -delete`/`--delete`, and subcommand deletes (`git rm`, `docker rm`/`rmi`,
  `podman rm`, `kubectl delete`).

> **These gates have been adversarially reviewed. Every sub-point below is a real
> bypass a code review caught in a naive implementation — do not simplify them away.**

**Classify on a NORMALIZED token stream, not raw text.** One tokenizer feeds both
the delete gate and the raw-AWS gate, so it must mirror what the shell actually
runs or both gates are trivially bypassed. Beyond collapsing quoted segments to one
token and emitting `; | && || & ( )` as their own tokens, it MUST normalize:
- **Unquoted backslash escapes** — the shell drops them, so `r\m` / `a\ws` execute
  `rm` / `aws`. Drop the backslash, keep the next char in the token.
- **ANSI-C / locale quoting** — `$'rm'` / `$'aws'` execute `rm` / `aws`. Drop a `$`
  that immediately precedes a quote so the quoted body becomes the token.

**Find the *command-position* token ("head") of each simple command.** "Is the
first token `rm`/`aws`?" is the classic bug. Walk the tokens; for each simple
command (reset on a separator) step transparently over `VAR=val` prefixes,
pass-through wrappers (`env sudo nohup exec command builtin time timeout xargs
setsid nice ionice stdbuf`), wrapper OPTIONS **and their value tokens**
(`sudo -u root`, `env -C dir`, `nice -n 5`, `timeout -k 5`), and wrapper positionals
(timeout's duration). The first remaining non-option token is the invoked program;
everything after it is that command's arguments.
```ts
const SEPARATORS = new Set([';','|','||','&&','&','(',')']);
const COMMAND_PREFIXES = new Set(['env','sudo','nohup','exec','command','builtin',
  'time','timeout','xargs','setsid','nice','ionice','stdbuf']);
// wrapper options that CONSUME the next token (so the real command isn't mistaken
// for the value). `-i` is excluded: `env -i` takes no value.
const WRAPPER_VALUE_FLAGS = new Set(['-u','-C','-S','-g','-h','-p','-r','-t','-U','-D',
  '-R','-s','-k','-n','-c','-o','-e','-I','-L','-P','-d','-E','-a']);
const stripPath = (t: string) => t.slice(t.lastIndexOf('/') + 1);  // /bin/rm -> rm

function commandHeads(tokens: string[]): string[] {
  const heads: string[] = [];
  let pending = true;                                          // still seeking the command word?
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (SEPARATORS.has(t)) { pending = true; continue; }
    if (!pending) continue;                                    // inside the command's arguments
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue;          // VAR=val prefix
    if (t.startsWith('-')) { if (WRAPPER_VALUE_FLAGS.has(t)) i++; continue; }
    if (COMMAND_PREFIXES.has(stripPath(t))) continue;          // env/sudo/timeout/…
    if (/^\d+[smhd]?$/.test(t)) continue;                      // timeout's duration positional
    heads.push(t); pending = false;                            // the invoked program
  }
  return heads;
}
```

Then **TWO required layers PLUS an env-jailbreak refusal** — no single one holds:

1. **Reject `aws` invoked as a program (classifier), including nested.** `aws` is a
   command head, OR it appears in a nested shell / `eval` string. The naive
   first-token check is the classic bypass:
   `bash -lc "aws s3 rm s3://prod/key --profile other"` has head `bash`. Recurse
   into the command string of shell interpreters and `eval` — and when scanning for
   `-c`, **skip value-taking interpreter options** (`bash -o pipefail -c "…"`) or
   you stop before the `-c`. Do NOT over-reject `aws` as a mere ARGUMENT
   (`rg aws src`, `bash -c "rg aws src"`, `timeout 5 rg aws src` must all pass).
   ```ts
   const SHELL_INTERPRETERS = new Set(['sh','bash','zsh','dash','ksh','ash','fish']);
   const SHELL_VALUE_FLAGS  = new Set(['-o','+o','-O','+O','--rcfile','--init-file']);

   export function invokesAwsDirectly(cmd: string): boolean {
     return commandHeads(tokenize(cmd)).some((h) => stripPath(h) === 'aws');
   }
   export function containsRawAws(cmd: string): boolean {
     if (invokesAwsDirectly(cmd)) return true;
     return nestedCommandStrings(tokenize(cmd)).some(containsRawAws);   // recurse `bash -c`/`eval`
   }
   // nestedCommandStrings: for a shell interpreter, scan its args skipping
   //   SHELL_VALUE_FLAGS (+ their value) until a `-c`-style flag, then take the next
   //   token as the nested command; keep scanning past non-flags; stop at a separator.
   ```
2. **Disable AWS in the bash subprocess env (the real boundary).** Obfuscation
   (`a''ws`, `$(printf aws)`, `$cmd`, base64, `xargs aws`) eventually beats ANY
   string classifier, so the subprocess must be unable to authenticate at all. Drop
   ALL inherited `AWS_*` (creds, profile, region, **and endpoint overrides**) and
   point discovery at nothing:
   ```ts
   export function shellEnv(base = process.env): Record<string, string> {
     const env: Record<string, string> = {};
     for (const [k, v] of Object.entries(base)) {
       if (v === undefined || k.startsWith('AWS_')) continue;  // drop creds/profile/region/config/endpoint
       env[k] = v;
     }
     env.AWS_CONFIG_FILE = '/dev/null';
     env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
     env.AWS_EC2_METADATA_DISABLED = 'true';                   // block IMDS creds on EC2
     return env;
   }
   // Bun.spawn(['/bin/zsh', '-lc', command], { cwd: process.cwd(), env: shellEnv(), … })
   ```
   NEVER pass `process.env` to the bash subprocess.
3. **Refuse inline `AWS_*=` assignments — they JAILBREAK layer 2.** A per-command
   assignment in `zsh -lc` overrides the spawn env, so
   `AWS_CONFIG_FILE=~/.aws/config $cmd --profile other s3 ls` re-points the CLI at
   the real credentials even though `shellEnv` set `/dev/null`. The bash tool must
   refuse any command that sets an `AWS_*` var inline (recurse into nested shells):
   ```ts
   export function assignsAwsEnv(cmd: string): boolean {
     const tokens = tokenize(cmd);
     if (tokens.some((t) => /^AWS_[A-Za-z0-9_]+=/.test(t))) return true;
     return nestedCommandStrings(tokens).some(assignsAwsEnv);
   }
   // bash tool guard:  if (containsRawAws(cmd) || assignsAwsEnv(cmd)) return 'Refused: use aws_cli.';
   ```

**The delete gate must also approval-gate the UNCLASSIFIABLE.** Beyond literal
deletes, a command head that is shell-expanded (`$cmd`, `${cmd}`, `$(…)`, backticks)
can't be classified — it may resolve to `rm`. Require approval rather than run it
blind. Expansion only in ARGUMENTS (`cat $file`, `rg $pat src`) stays fine.
```ts
const hasExpansion = (t: string) => t.includes('$') || t.includes('`');
// requestsDelete(cmd) === literal delete (token/flag/subcommand on the token stream)
//   || commandHeads(tokenize(cmd)).some(hasExpansion)            // opaque command name
//   || nestedCommandStrings(tokenize(cmd)).some(requestsDelete)  // `bash -c "rm …"`
```

- Bind delete approval the same way as AWS writes: one-shot TTY `askConfirm`,
  one-shot non-TTY auto-denies, sessions use `helpers.ask` (explicit `y`/`yes`).
- Put pure classifiers in a small module (`src/actions/bash-core.ts`) and test them
  without spawning. **A string classifier is best-effort, not a hard boundary** —
  the env jail (layer 2) plus the inline-assignment refusal (layer 3) are what make
  a missed obfuscation HARMLESS (no creds → it just fails). A hard guarantee needs
  OS sandboxing (separate user/container with no access to `~/.aws`); surface that
  limitation to the user rather than pretending the classifier is airtight.
- After writing or updating each helper/action/test file, validate the result on
  disk with `test -f`, `git diff -- <path>`, or a targeted read-back before
  proceeding.

## The `aws_cli` tool + safety gate (keep these invariants)

The tool is an `async function*` (so it can emit an `on_tool_event` progress line
before the slow CLI call). Flow: strip managed flags → classify → if write, call
the `approve` seam and skip on denial → run.

**1. Strip managed flags** so the user's input can't escape the pinned scope.
Two sets — value-taking (drop the flag AND its following token) and boolean (drop
ONLY the flag; eating the next token corrupts the command):
```ts
const MANAGED_VALUE_FLAGS = new Set(['--profile', '--region', '--output', '--endpoint-url']);
// --endpoint-url is a data-exfiltration vector (redirects calls off real AWS).
const MANAGED_BOOL_FLAGS  = new Set(['--no-sign-request']);
// --no-sign-request would run UNSIGNED against public buckets, ignoring the
// account boundary — strip it so the command re-runs signed under the profile.
```

**1b. Pin identity in the `aws_cli` subprocess env, too.** Stripping `--endpoint-url`
from the args is NOT enough — an inherited `AWS_ENDPOINT_URL` / `AWS_ENDPOINT_URL_*`
env var redirects calls off real AWS just the same (a code review caught this). The
`aws_cli` env must drop ambient identity AND endpoint overrides so the pinned
`--profile`/`--region` fully determine the call, while KEEPING the config-file
locations so the profile resolves:
```ts
export function awsEnv(base = process.env): Record<string, string> {
  const drop = new Set(['AWS_PROFILE','AWS_DEFAULT_PROFILE','AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_REGION','AWS_DEFAULT_REGION']);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || drop.has(k)) continue;
    if (k === 'AWS_ENDPOINT_URL' || k.startsWith('AWS_ENDPOINT_URL_')) continue;   // exfil vector
    env[k] = v;                          // keeps AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE
  }
  return env;
}
// runAws: Bun.spawn(['aws','--profile',PROFILE,'--region',REGION, ...args], { env: awsEnv(), … })
```

**2. Classify read vs write — fail-safe to WRITE.** An allowlist of read verbs;
ANYTHING not matched is a write (so an unknown/new op is approval-gated, never
silently run):
```ts
const READ_VERBS = ['describe','list','get','head','lookup','search','scan','query','batch-get','select'];
// operation is READ if it === a verb or startsWith(`${verb}-`)
```
Two carve-outs the naive allowlist gets wrong:
- **High-level `s3`:** only `s3 ls` is a read; `cp/sync/rm/mb/rb` mutate → write.
- **`s3api` local-file writes:** `get-object` and `select-object-content` match the
  `get-/select` read verbs but write a required LOCAL outfile → force them to
  write. (`get-object-acl`, `get-bucket-policy`, `dynamodb get-item`, etc. only
  print to stdout → stay reads.)
  ```ts
  const S3API_LOCAL_WRITE_OPS = new Set(['get-object', 'select-object-content']);
  ```
- When locating the service/operation positionals, skip the VALUE token of
  global value-flags (`--query`, `--cli-input-json`, …) so a flag value isn't
  mistaken for the command.

**3. Approval seam (`approve`), bound per run mode:**
- One-shot on a TTY → `askConfirm` (default cancel).
- One-shot non-TTY (piped/CI) → auto-DENY writes (no human present); reads still run.
- Session → reuse the session's text prompt; accept only an explicit `y`/`yes`
  (`isApproval`), everything else (incl. empty) is a deny.
- A denied write returns a "Write not approved — skipped" string and does NOT run.
  The system prompt must tell the model: never claim a write happened unless the
  tool result confirms it ran.

**Test the gate** (pure, no AWS): classify reads vs writes incl. the `s3`/`s3api`
carve-outs; managed-flag stripping incl. the boolean flag not eating the next
token; `isApproval`; and that a denied write never calls the runner. For the bash
classifier, cover **every bypass a review has caught** — each line below is a
regression test, not a hypothetical:
- non-delete pass-through; literal deletes incl. subcommands (`git rm`,
  `kubectl delete`) and `find -delete`;
- raw-AWS rejection **nested** (`bash -lc "aws …"`, `sh -c "aws …"`,
  `eval "aws …"`, `timeout 5 bash -c "aws …"`) and **behind wrapper options**
  (`env -i aws …`, `env -i AWS_CONFIG_FILE=x aws …`, `sudo -u root aws …`,
  `timeout 5 aws …`, `nice -n 5 aws …`, `bash -o pipefail -c "aws …"`);
- **normalization** bypasses (`r\m …`, `a\ws …`, `$'rm' …`, `$'aws' …`);
- **shell-expansion**: `cmd=rm; $cmd -rf x` and `` `echo rm` -rf x `` require
  approval (`requestsDelete` true);
- **inline-assignment jailbreak**: `AWS_CONFIG_FILE=… $cmd … s3 ls` is refused
  (`assignsAwsEnv` true);
- **must-NOT-reject** (false-positive guards): `rg aws src`, `bash -c "rg aws src"`,
  `timeout 5 rg aws src`, `sudo -u root rg aws src`, `bash -o pipefail -c "rg aws src"`,
  `cat $file`, `FOO=bar rg pattern src`.

Test `shellEnv` drops every inherited `AWS_*` (incl. the config-file vars) and sets
the `/dev/null` discovery + `AWS_EC2_METADATA_DISABLED`; test `awsEnv` drops ambient
creds/profile/region + `AWS_ENDPOINT_URL[_*]` while KEEPING the config-file
locations. Add tests for `loadRepoInstructions` with present, missing, and blank
`AGENTS.md`, plus `buildSystemPrompt` including the fenced repository instructions.
See `reference/tests` for the shape.

## Human-in-the-loop input (critical)

Writes are approved through the session's `ask` seam, which renders mid-turn. The
`<SessionApp>` MUST use a single persistent `<TextInput>` or the approval prompt
silently drops keystrokes in a real TTY — see the gotcha in
`references/primitives.md`. Verify the approval prompt in a REAL terminal;
`ink-testing-library` can't model raw-mode focus.

## Optional — knowledge docs (`load_doc`)

To make the assistant fluent in a specific system (DynamoDB schema, business
rules, query recipes), add a `load_doc` tool with a small registry instead of
stuffing everything into the system prompt (progressive disclosure):
```ts
export const knowledgeDocs = [{ name, description, path }]; // path resolved from repo root
export async function loadDoc(name) { /* read the file; unknown name → error listing valid names */ }
```
Advertise each doc's name+description in the system prompt (generated from the
registry so it never drifts); the agent calls `load_doc` on demand. Tool errors
are RETURNED as strings (not thrown) so the agent can self-correct. Adding a doc
= drop a markdown file + one registry entry; no runtime change.

## If you do DIRECT AWS SDK calls (not the CLI)

The `aws_cli` tool pins the profile via the `--profile` flag. If an action instead
uses the AWS SDK (`@aws-sdk/*`) for direct DynamoDB/S3 work, the SDK does NOT see
that flag — pin the profile explicitly or it falls back to the ambient credential
chain (which may be empty, or point at the WRONG account):
```ts
import { fromIni } from '@aws-sdk/credential-providers';
new DynamoDBClient({ region, credentials: fromIni({ profile }) });
```

## Finish

`bun run typecheck` → `bun test` → `bun run start --list` (should show `chat` as
the primary action) → `bun run start --action chat --input "…"` (and a session
run to test the approval prompt in a real terminal) → then the MANDATORY Codex
review gate (SKILL.md Step 3.10).
