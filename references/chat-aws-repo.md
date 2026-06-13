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

- Run from the **current working directory** — where the assistant was launched
  (`resolveCwd()` = `process.env.CWD?.trim() || process.cwd()`; a globally-linked bin
  runs with the caller's cwd, so it operates on whatever repo the user is in, with
  `CWD` as an override) — with capped stdout/stderr and a timeout.
- Run bash commands immediately unless they request deletion, mutate the AWS env, or
  can't be classified.
- Require approval for delete operations: `rm`, `rmdir`, `unlink`, `shred`,
  `find -delete`/`--delete`/`-exec rm`, and subcommand deletes (`git rm`,
  **`git clean`**, `docker rm`/`rmi`, `podman rm`, `kubectl delete`), plus opaque
  script/code interpreters (see the delete gate below).

> **These gates have been adversarially reviewed. Every sub-point below is a real
> bypass a code review caught in a naive implementation — do not simplify them away.**

**Classify on a NORMALIZED token stream, not raw text.** One tokenizer feeds both
the delete gate and the raw-AWS gate, so it must mirror what the shell actually
runs or both gates are trivially bypassed. The authoritative, fully-hardened
tokenizer is `reference/src/actions/shell-tokens.ts` — copy it. Beyond collapsing
quoted segments to one token and emitting `; | && || & ( )` as their own tokens, it
MUST normalize ALL of:
- **Unquoted backslash escapes** — the shell drops them, so `r\m` / `a\ws` execute
  `rm` / `aws`. Drop the backslash, keep the next char (and elide `\`+newline line
  continuations).
- **ANSI-C / locale quoting** — `$'rm'` / `$'aws'` execute `rm` / `aws`. Drop a `$`
  that immediately precedes a quote so the quoted body becomes the token.
- **Command substitutions** — keep `$(…)` and `` `…` `` GROUPED in their token (so
  the `$`/backtick marker survives for the opaque-head gate, and the body can be
  recursed); see "argument-position substitution" below.
- **`${…}` parameter expansion** — keep grouped (one token) so a bare `{`/`}` can be
  treated as a brace-group separator without splitting `${VAR}`.
- **Brace groups** — emit `{` and `}` as their own separator tokens at the character
  level, so a brace GROUP / function body — even the compact `f(){rm;}` (no space) —
  parses as its own commands instead of folding `{rm` into one token.
- **Newlines = `;`** — a delete/aws on a later line is its own command, not an
  argument of the first.
- **Redirections** — emit `>`, `>>`, `<`, `2>`, `&>`, fd-duplications (`2>&1`), etc.
  as marked tokens so a LEADING redirect (`> /dev/null rm -rf x`) isn't taken as the
  head; the head walker skips the operator and its target.
- **Here-docs** — capture the `<<DELIM` delimiter and SKIP the body lines as data
  (not commands), so writing a doc/script that mentions `rm`/`aws` isn't gated.

> The marker for redirection tokens MUST be written as a JS escape (`'\u0000'`),
> NOT a raw NUL byte — a literal NUL makes git treat the file as binary and hides
> the diff. A regression test (`reference/tests/global-bin-jsx.test.ts`) asserts no
> source file contains a raw NUL.

**Find the *command-position* token ("head") of each simple command.** "Is the
first token `rm`/`aws`?" is the classic bug. Walk the tokens; for each simple
command (reset on a separator OR a brace) step transparently over redirections (and
their target), `VAR=val` prefixes, **compound-command keywords** (`if then elif else
fi while until do done for select case esac in function time ! [[ ]]` — else
`if true; then rm; fi` keeps `then` as the head), pass-through wrappers (`env sudo
nohup exec command builtin time timeout xargs setsid nice ionice stdbuf`), wrapper
OPTIONS **and their value tokens**, and wrapper positionals (timeout's duration).
The first remaining non-option token is the invoked program. The authoritative
walker is `reference/src/actions/bash-core.ts` (`simpleCommands`); copy it.

> **Wrapper value-flags MUST be keyed PER WRAPPER, not a flat union.** A flat set
> (the old bug) wrongly treats a *valueless* flag for one wrapper as value-taking —
> `sudo -E rm -rf x` and `command -p aws s3 ls` then swallow the real command and
> skip the gate. Only consume the next token when the flag takes a value FOR THAT
> wrapper (separated form; `--flag=value` is self-contained). Include short AND long
> forms (`env --unset NAME`, `sudo --user NAME`, `nice --adjustment 5`,
> `timeout --kill-after 5`).
```ts
// e.g.  env: -u -C -S --unset --chdir --split-string …   sudo: -u -g -C -D --user --chdir …
const WRAPPER_VALUE_FLAGS: Record<string, Set<string>> = { env: new Set([...]), sudo: new Set([...]), /*…*/ };
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
   // `aws` as a head OR a shell-expanded head (`$(echo aws)` could resolve to aws),
   // here or inside ANY nested context: shell `-c`/eval, command substitutions in
   // argument position (`echo $(aws s3 ls)`), `env -S` strings, git-alias bodies, and
   // `find -exec` slices — all collected by a shared `descend()`. A leading redirect
   // (`> /dev/null aws …`) and a later-line `aws` are handled by the tokenizer.
   // See the authoritative `containsRawAws` in reference/src/actions/bash-core.ts.
   ```
2. **Disable AWS in the bash subprocess env (the real boundary) — ALLOWLIST, jail
   HOME, no startup files.** Obfuscation (`a''ws`, `$(printf aws)`, base64,
   `xargs aws`) eventually beats ANY string classifier, so the subprocess must be
   unable to authenticate at all. Use a STRICT ALLOWLIST (a denylist that only drops
   `AWS_*` still hands the subprocess the model's `OPENAI_API_KEY`, `GH_TOKEN`, SSH,
   etc. — a `env`/prompt-injected command echoes them back). Jail `HOME` to a scratch
   dir so the AWS default chain (`$HOME/.aws`, SSO cache) finds nothing even if a
   child unsets the pins. And run `zsh -f` (NO_RCS): `-lc` sources
   `.zshenv`/`.zprofile` from HOME, and a writable jail HOME lets a command plant
   `$HOME/.zprofile` with a hidden `rm`/`aws` the next invocation runs.
   ```ts
   const SHELL_ENV_ALLOWLIST = new Set(['PATH','HOME','USER','LOGNAME','SHELL','PWD',
     'TMPDIR','TMP','TEMP','LANG','LANGUAGE','TZ','TERM','TERMINFO','COLORTERM',
     'HOSTNAME','PAGER','LSCOLORS','LS_COLORS','EDITOR']);
   export function shellEnv(base = process.env, home?: string): Record<string, string> {
     const env: Record<string, string> = {};
     for (const [k, v] of Object.entries(base)) {
       if (v === undefined) continue;
       if (SHELL_ENV_ALLOWLIST.has(k) || k.startsWith('LC_')) env[k] = v;   // drop ALL secrets, not just AWS_*
     }
     if (home !== undefined) env.HOME = home;                  // jail HOME away from the real ~/.aws
     env.AWS_CONFIG_FILE = '/dev/null';
     env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
     env.AWS_EC2_METADATA_DISABLED = 'true';                   // block IMDS creds on EC2
     return env;
   }
   // const JAIL = mkdirSync(join(tmpdir(),'<app>-bash-home'),{recursive:true}) once at module load
   // Bun.spawn(['/bin/zsh','-f','-c', command], { cwd: resolveCwd(), env: shellEnv(process.env, JAIL), … })
   // resolveCwd = process.env.CWD?.trim() || process.cwd()   (invocation dir; CWD overrides)
   ```
   NEVER pass `process.env` to the bash subprocess. **LIMITATION:** even this is
   best-effort — a command with the user's filesystem privileges could still read
   creds by ABSOLUTE path; a hard guarantee needs OS-level isolation (separate
   user/container). Surface that to the user; don't claim the classifier is airtight.
3. **Refuse any command that MUTATES the AWS env — assignment OR unset.** A
   per-command assignment overrides the spawn env (`AWS_CONFIG_FILE=~/.aws/config
   $cmd --profile other s3 ls` re-points the CLI at real creds), and an UNSET removes
   the `/dev/null` pins so a child interpreter (`env -u AWS_CONFIG_FILE python -c
   "…aws…"`) falls back to `~/.aws`. The authoritative `tampersWithAwsEnv`
   (`reference/src/actions/bash-core.ts`) covers both. Two subtleties:
   - **Assignment must be LEADING (command-prefix position), not any token.** A flat
     `tokens.some(/^AWS_.../=/)` false-refuses `rg 'AWS_PROFILE=' src` and
     `echo AWS_PROFILE=x` (the `AWS_*=` is an ARGUMENT). Walk to the head like
     `commandHeads`; only an `AWS_*=` BEFORE the head (stepping over other `VAR=` /
     wrappers) counts.
   - **Unset** covers `env -u AWS_X`, `env --unset[=]AWS_X`, and the `unset` builtin.
   - Recurse into every nested context (shell `-c`/eval, command substitutions,
     `env -S`, `find -exec`, git-alias bodies) — see `descend()` in the reference.
   ```ts
   // bash tool guard:  if (containsRawAws(cmd) || tampersWithAwsEnv(cmd)) return 'Refused: use aws_cli.';
   ```

**The delete gate (head-based) must catch every form a review has caught.** Use the
authoritative `requestsDelete` in `reference/src/actions/bash-core.ts`. It is NOT a
broad "any token is `rm`" scan (that false-flags `echo rm`); it walks `simpleCommands`
and gates a command when:
- its **head** is `rm`/`rmdir`/`unlink`/`shred`, OR is **shell-expanded** (`$cmd`,
  `$(…)`, backticks — opaque, may resolve to `rm`; expansion only in ARGUMENTS like
  `cat $file` stays fine);
- it's a **subcommand delete** — `git rm`, **`git clean`**, `docker rm/rmi`,
  `kubectl delete` — found AFTER skipping global value-flags (`git -C . rm` resolves
  to `rm`, not `.`);
- it's `find … -delete`, OR `find … -exec/-execdir/-ok <prog> …` whose exec
  sub-command is a delete — INCLUDING `find … -exec sh -c 'rm …' {} ;` (recurse the
  exec slice);
- it **runs opaque code**: a shell interpreter WITHOUT `-c` (reads stdin/script:
  `printf 'rm' | sh`, `bash deploy.sh`), or a CODE interpreter (`python -c
  'os.remove(...)'`, `node -e 'fs.rmSync(...)'`, `ruby`/`perl`/`bun`/… — gate any
  invocation except a pure `--version`/`--help`).

And it RECURSES into every nested context — shell `-c`/eval strings, **command
substitutions in argument position** (`echo $(rm -rf x)`), `env -S` strings,
git-alias bodies (`git -c alias.x='!rm …' x`), and `find -exec` slices — via a
shared `descend()`. Here-doc bodies are NOT scanned (the tokenizer skips them), so
writing a doc that mentions `rm` isn't gated.

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

**1b. Pin identity in the `aws_cli` subprocess env, too — drop EVERY `AWS_*`.** A
denylist of specific vars keeps missing credential SOURCES (a review caught several):
`AWS_ENDPOINT_URL[_*]` (redirects calls off real AWS), `AWS_ROLE_ARN` /
`AWS_WEB_IDENTITY_TOKEN_FILE`, the container-cred vars `AWS_CONTAINER_CREDENTIALS_*`,
SSO, and caller-controlled `AWS_CONFIG_FILE` / `AWS_SHARED_CREDENTIALS_FILE` (which
could repoint the managed profile at another account). Drop them ALL — the pinned
`--profile`/`--region` flags plus the CLI's trusted default config (`~/.aws/config`,
`~/.aws/credentials`) then fully determine the call:
```ts
export function awsEnv(base = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || k.startsWith('AWS_')) continue;   // no ambient AWS source reaches the CLI
    env[k] = v;
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
- **shell-expansion**: `cmd=rm; $cmd -rf x` and `` `echo rm` -rf x `` require approval;
- **per-wrapper false-consume**: `sudo -E rm -rf x`, `command -p aws s3 ls` (the flat
  WRAPPER_VALUE_FLAGS bug); long-form `env --unset … aws`, `sudo --chdir /tmp aws`;
- **subcommand-after-global-option**: `git -C . rm`, `kubectl -n default delete`,
  `docker --context prod rm`; plus **`git clean -fd`**;
- **find -exec**: `find … -exec rm {} +`, `find … -exec sh -c 'rm …' {} ;`;
- **substitutions in argument position**: `echo $(rm -rf x)`, `echo $(aws s3 ls)`;
  **`env -S 'rm …'`**; **git aliases** `git -c alias.x='!rm …' x`;
- **newlines / braces / keywords**: `echo ok\nrm -rf x`, `f(){rm;}; f`,
  `if true; then rm; fi`; **leading redirections** `> /dev/null rm`, `2>&1 aws s3 ls`;
- **interpreters**: `printf 'rm' | sh`, `bash deploy.sh`, `python -c 'os.remove(…)'`,
  `node -e 'fs.rmSync(…)'` (gated); `python --version`, `node -v` (NOT gated);
- **inline-assignment / unset jailbreak**: `AWS_CONFIG_FILE=… $cmd … s3 ls`,
  `env -u AWS_CONFIG_FILE python -c "…"`, `unset AWS_CONFIG_FILE; …` are refused;
- **must-NOT-reject** (false-positive guards): `rg aws src`, `bash -c "rg aws src"`,
  `timeout 5 rg aws src`, `sudo -u root rg aws src`, `cat $file`, `FOO=bar rg pat src`,
  `echo rm`, `rg 'AWS_PROFILE=' src`, `echo hi > out.log`, `cat ${HOME}/notes.txt`,
  and a here-doc body that mentions `rm`/`aws s3 ls`.

Test `shellEnv` drops every inherited `AWS_*` AND every non-AWS secret (allowlist —
e.g. `OPENAI_API_KEY`, `GH_TOKEN`), keeps `PATH`/`HOME`/`LC_*`, sets the `/dev/null`
discovery + `AWS_EC2_METADATA_DISABLED`, and jails `HOME` when a home override is
given; test that `runBash` does NOT source a `.zshenv` planted in the jail HOME
(`zsh -f`). Test `awsEnv` drops EVERY `AWS_*` (incl. `AWS_ROLE_ARN`,
`AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_CONTAINER_CREDENTIALS_*`, and the config-file
paths). Add tests for `loadRepoInstructions` (present/missing/blank `AGENTS.md`) and
`buildSystemPrompt`. See `reference/tests` for the shape.

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
