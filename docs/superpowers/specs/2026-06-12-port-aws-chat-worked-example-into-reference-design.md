# Port the AWS-chat worked example into `reference/`

## Background

The `langgraph-adk` skill scaffolds Bun/TypeScript LangGraph CLIs. Its
`references/chat-aws-repo.md` recipe describes — in prose — how to merge an AWS
CLI + repo `bash` tool into the seed `chat` action, with a two-layer safety
boundary (string classifier + stripped subprocess env) plus a delete-approval
gate. The recipe is detailed, but the skill has no concrete worked example of
the recipe's *end state* anywhere in the tree.

A downstream project (`<downstream-app>`) was scaffolded from this skill and then had
the recipe successfully applied. Its modules are clean, fully consistent with
the recipe's prescribed behavior, and have unit-test coverage for the
adversarial bypasses the recipe enumerates.

## Goal

Materialize the recipe's end state inside `reference/` as a buildable worked
example, so future runs of the recipe have ground truth to mirror.

Non-goals (explicitly out of scope for this work):

- Editing `templates/` (the minimal seed scaffold stays minimal).
- Editing `SKILL.md` or any file in `references/` (the recipe doc stays as-is).
- Editing `README.md` or other documentation.
- Refactoring the existing reference modules that are not part of the AWS-chat
  end state (`session-core.ts`, `model-info.ts`, `ui.tsx`, etc.).

## End state of `reference/`

After the port, `reference/` looks like a fresh scaffold that has had the
`chat-aws-repo` recipe successfully applied:

```
reference/
├── AGENTS.md                    [NEW, generic]
├── package.json / bunfig.toml / tsconfig.json / scripts / .env.example
└── src/
    ├── cli.ts, config.ts, dotenv.ts, index.ts          [unchanged — keeps CWD]
    ├── llm.ts, model-info.ts, params.ts, trace.ts      [unchanged]
    ├── session-core.ts, ui.tsx                          [unchanged]
    ├── ink/SessionApp.tsx                               [unchanged — keeps newer spinner]
    └── actions/
        ├── _types.ts                                    [unchanged]
        ├── index.ts                                     [registers ONLY chat]
        ├── chat.tsx                                     [REPLACED]
        ├── aws-cli-core.ts                              [NEW]
        ├── bash-core.ts                                 [NEW]
        ├── command-runtime.ts                           [NEW, generic PROFILE/REGION]
        ├── repo-instructions.ts                         [NEW]
        └── shell-tokens.ts                              [NEW]
└── tests/
    ├── aws-cli-core.test.ts                             [NEW]
    ├── bash-core.test.ts                                [NEW]
    ├── command-runtime.test.ts                          [NEW]
    ├── repo-instructions.test.ts                        [NEW]
    └── (existing tests unchanged: config, dotenv, global-bin-jsx,
        ink-session, llm, model-info, params, session-core, trace)
```

### Removed files

- `reference/src/actions/assistant.tsx`
- `reference/tests/assistant.test.ts`

Rationale: the merged `chat.tsx` already demonstrates the "both" turn-shape
(branch on `--input` → one-shot, otherwise render `<SessionApp>`), so
`assistant.tsx` is redundant as a worked example. Keeping it would mislead
future runs into registering two actions when the recipe explicitly says to
remove the standalone aws-assistant.

### Files intentionally kept newer than `<downstream-app>`

`<downstream-app>` was scaffolded before two scaffold improvements landed and is
*behind* on these. We do NOT regress them when porting:

- `reference/src/cli.ts` — keeps `process.chdir(config.cwd)` so the CWD env
  steers every action's working directory.
- `reference/src/config.ts` — keeps the `cwd` field + `CWD` env handling.
- `reference/src/ink/SessionApp.tsx` — keeps the floating-spinner comment and
  behavior (spinner floats above the top divider when busy with no pending
  question).

## The three surgical changes during the port

Everything else is a verbatim file copy from `<downstream-app>` into `reference/`.
These are the only edits made during the copy:

### 1. `command-runtime.ts` — generic PROFILE/REGION placeholders

Replace the project-specific identity at lines 8–9:

```ts
// <downstream-app> (project-specific):
export const PROFILE = process.env.<APP>_AWS_PROFILE ?? '<old-profile>';
export const REGION  = process.env.<APP>_AWS_REGION  ?? 'us-east-2';

// reference/ (neutral placeholder):
export const PROFILE = process.env.REFERENCE_AWS_PROFILE ?? 'default';
export const REGION  = process.env.REFERENCE_AWS_REGION  ?? 'us-east-1';
```

The recipe (`references/chat-aws-repo.md` Step 0) already tells the skill to
ask the user for their profile/region and bake the answer under a per-project
`<APP>_AWS_*` env prefix. Seeing a placeholder pair in the reference signals
"swap these per project" — on-pattern with how the recipe is taught.

No other lines in `command-runtime.ts` change.

### 2. `chat.tsx` — verbatim copy, import paths re-verified

All imports (`./aws-cli-core`, `./bash-core`, `./command-runtime`,
`./repo-instructions`, `./shell-tokens`) resolve identically because the
sibling modules are being ported in the same change. The `Seams` interface,
`buildTools`, `buildAgent`, `extractFinalText`, and `oneShotInput` helpers are
preserved as-is.

### 3. `AGENTS.md` — new generic file (~12 lines)

A minimal generic stand-in so `loadRepoInstructions` returns content when
exercising `reference/`:

```md
## Working agreements
- Example placeholder rule — replace per project.

## AGENTS.md structure policy
- Prefer directory-scoped `AGENTS.md` files over centralized implementation docs.
- Place guidance in the nearest directory that owns the code.
- Keep root `AGENTS.md` focused on cross-cutting repository rules.
- Inheritance: root applies by default; the nearest `AGENTS.md` may add or
  override local rules.
```

No Doki tables, no GSI references, no domain content — strictly the reusable
structure policy plus a placeholder working-agreement line so the file is
non-empty (and `loadRepoInstructions` returns truthy content).

## Verbatim ports (no edits)

| Source (`<downstream-app>`) | Destination (`reference/`) |
| --- | --- |
| `src/actions/aws-cli-core.ts` | `src/actions/aws-cli-core.ts` |
| `src/actions/bash-core.ts` | `src/actions/bash-core.ts` |
| `src/actions/repo-instructions.ts` | `src/actions/repo-instructions.ts` |
| `src/actions/shell-tokens.ts` | `src/actions/shell-tokens.ts` |
| `src/actions/index.ts` | `src/actions/index.ts` |
| `tests/aws-cli-core.test.ts` | `tests/aws-cli-core.test.ts` |
| `tests/bash-core.test.ts` | `tests/bash-core.test.ts` |
| `tests/command-runtime.test.ts` | `tests/command-runtime.test.ts` |
| `tests/repo-instructions.test.ts` | `tests/repo-instructions.test.ts` |

`chat.tsx` and `command-runtime.ts` are listed under "surgical changes" above.

## Package dependencies

Verified at design time: `reference/package.json` already lists `langchain`,
`@langchain/core`, `zod`, and `minimist`. No new dependencies are introduced
by the port. A `bun install` should be a no-op for `dependencies`.

## Verification

Run from `reference/` after the port:

1. `bun install` — no missing deps.
2. `bun run typecheck` — clean.
3. `bun test` — all tests green, including the four new files.
4. `bun run start --list` — shows only `chat`.
5. `bun run start --action chat --input "list profile"` — exercises the
   one-shot path. The actual AWS call will fail against the placeholder
   `default` profile, but the streaming/printing/`printContextBar` path must
   complete without crashing.
6. `grep -r "assistant" reference/src reference/tests` — no dangling
   references to the removed `assistant.tsx`.

## Risks and mitigations

- **Regressing CWD or the spinner change** by accidentally copying
  `<downstream-app>`'s older `cli.ts` / `config.ts` / `SessionApp.tsx`. *Mitigation:*
  these three files are explicitly on the "do not touch" list above.
- **Forgetting a dep** that `chat.tsx` needs. *Mitigation:* the explicit
  package-dependencies step above.
- **Stale references to `assistant`** in tests, registry, or README.
  *Mitigation:* the final `grep` step.
- **Doki-specific content leaking into the generic `AGENTS.md`.**
  *Mitigation:* the new file is authored fresh from the design above, not
  copied from `<downstream-app>/AGENTS.md`.

## Success criteria

- `reference/` builds and tests pass.
- Only `chat` is registered.
- `command-runtime.ts` PROFILE/REGION read as neutral placeholders.
- `assistant.tsx` and its test are gone.
- The newer scaffold files (`cli.ts`, `config.ts`, `SessionApp.tsx`) are byte-
  identical to their pre-port state.
- A minimal generic `reference/AGENTS.md` exists and is non-empty.
