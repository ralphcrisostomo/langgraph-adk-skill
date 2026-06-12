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
- Run bash commands immediately unless they request deletion.
- Require approval for obvious delete operations: `rm`, `rmdir`, `unlink`,
  `delete`, `find -delete`, `--delete`, and common delete subcommands such as
  `git rm`, `docker rm`, `podman rm`, and `kubectl delete`.

**Keep AWS out of bash — TWO layers, both required.** A shell tool can always reach
a binary, so neither layer alone is enough:

1. **Reject `aws` in the classifier, including when nested.** Detect `aws` invoked
   as a program — top-level (`aws …`), after env assignments/`env`/`sudo`
   (`AWS_PROFILE=x aws …`), by path (`/path/to/aws …`), after a shell separator
   (`; | && ||`), AND **inside a nested shell or `eval`**. The naive "is the first
   token `aws`" check is the classic bypass:
   `bash -lc "aws s3 rm s3://prod/key --profile other"` has first token `bash`, so
   it slips through and runs with an attacker-chosen profile. Recurse into the
   command string of shell interpreters (`sh/bash/zsh/dash/ksh/… -c|-lc|-ic "<cmd>"`)
   and of `eval`, and re-check each. Do NOT over-reject `aws` as a mere argument
   (`rg aws src`, `echo "deploy aws later"`, `bash -c "rg aws src"` must all pass).
   ```ts
   // reject if aws is INVOKED (recurse into `bash -c "<cmd>"` / `eval "<cmd>"`)
   export function containsRawAws(command: string): boolean {
     if (invokesAwsDirectly(command)) return true;              // top-level / env / path / separator
     return nestedCommandStrings(tokenize(command)).some(containsRawAws);
   }
   ```
2. **Disable AWS in the bash subprocess env (the real boundary).** Obfuscation
   (`a''ws`, `$(printf aws)`, base64, `xargs aws`) will eventually beat any string
   classifier, so the bash subprocess must be unable to authenticate at all.
   Spawn it with a STRICTER env than `aws_cli` uses — `aws_cli`'s `sanitizedEnv`
   keeps the config-file vars so the managed profile resolves; bash must drop them
   too. Use a `shellEnv` that removes ALL inherited `AWS_*` and points discovery at
   nothing, so even `aws --profile other` finds no profile and no credentials:
   ```ts
   export function shellEnv(base = process.env): Record<string, string> {
     const env: Record<string, string> = {};
     for (const [k, v] of Object.entries(base)) {
       if (v === undefined || k.startsWith('AWS_')) continue;   // drop creds, profile, region, config paths
       env[k] = v;
     }
     env.AWS_CONFIG_FILE = '/dev/null';
     env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
     env.AWS_EC2_METADATA_DISABLED = 'true';                    // block IMDS creds on EC2
     return env;
   }
   // Bun.spawn(['/bin/zsh', '-lc', command], { cwd: process.cwd(), env: shellEnv(), … })
   ```
   NEVER pass `process.env` to the bash subprocess — that hands it ambient AWS
   credentials and every profile in `~/.aws`.

- Bind delete approval the same way as AWS writes: one-shot TTY uses
  `askConfirm`, one-shot non-TTY auto-denies, and sessions use `helpers.ask`
  with only explicit `y`/`yes` accepted.
- Put pure classification helpers in a small module (for example
  `src/actions/bash-core.ts`) and test them without spawning commands.
- After writing or updating each helper/action/test file, validate the result on
  disk with `test -f`, `git diff -- <path>`, or a targeted read-back of the
  changed lines before proceeding.

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
classifier: non-delete pass-through, rm/delete approval, and raw-AWS rejection —
including the **nested** forms (`bash -lc "aws …"`, `sh -c "aws …"`,
`eval "aws …"`, `timeout 5 bash -c "aws …"`) AND the must-NOT-reject cases
(`rg aws src`, `bash -c "rg aws src"`). Test `shellEnv` drops every inherited
`AWS_*` (incl. the config-file vars) and sets the `/dev/null` discovery +
`AWS_EC2_METADATA_DISABLED`. Add tests for `loadRepoInstructions` with present,
missing, and blank `AGENTS.md`, plus `buildSystemPrompt` including the fenced
repository instructions. See `reference/tests` for the shape.

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
