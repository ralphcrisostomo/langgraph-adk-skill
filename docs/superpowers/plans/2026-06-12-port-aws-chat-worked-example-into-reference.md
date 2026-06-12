# Port AWS-chat worked example into `reference/` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize the `chat-aws-repo` recipe's end state inside `reference/` by porting `<downstream-app>`'s modules with neutral placeholders.

**Architecture:** Mostly verbatim file copies from `<DOWNSTREAM_REPO>/` into `<REPO_ROOT>/reference/`, with four surgical edits (PROFILE/REGION placeholder, persona line, AGENTS.md fresh) and two deletions (`assistant.tsx` + its test). Modules are added in dependency order so `bun run typecheck` and `bun test` stay green at every commit.

**Tech Stack:** Bun, TypeScript, LangChain/LangGraph JS, Ink (React for terminal), Zod.

**Spec:** `docs/superpowers/specs/2026-06-12-port-aws-chat-worked-example-into-reference-design.md`

---

## Glossary of paths

- `SRC` = `<DOWNSTREAM_REPO>`
- `DST` = `<REPO_ROOT>/reference`

All commands assume you are working from the repo root `<REPO_ROOT>`.

---

### Task 1: Capture pre-work SHA and confirm clean tree

**Files:** none (read-only baseline capture)

- [ ] **Step 1: Confirm clean working tree**

Run:
```bash
git status --short
```
Expected: empty output. If anything is staged or modified, stop and ask.

- [ ] **Step 2: Capture the pre-work commit SHA**

Run:
```bash
git rev-parse --short HEAD
```
Expected: a 7-char SHA (e.g. `548adc3`). **Write it down — you will paste it into the Codex review line at the end.**

- [ ] **Step 3: Sanity-baseline the reference tree**

Run:
```bash
cd reference && bun install && bun run typecheck && bun test && cd ..
```
Expected: install succeeds (lockfile already present), typecheck clean, all existing tests pass. This is the green baseline every subsequent task must preserve.

---

### Task 2: Remove `assistant.tsx`, its test, and its registry entry

**Files:**
- Delete: `reference/src/actions/assistant.tsx`
- Delete: `reference/tests/assistant.test.ts`
- Modify: `reference/src/actions/index.ts`

- [ ] **Step 1: Delete the assistant action and its test**

Run:
```bash
rm reference/src/actions/assistant.tsx reference/tests/assistant.test.ts
```

- [ ] **Step 2: Replace `reference/src/actions/index.ts` so only `chat` is registered**

Overwrite the file with exactly:
```ts
import type { Action } from './_types';
import { chat } from './chat';

// Registry: the skill appends new actions here when adding one.
export const actions: Action[] = [chat];
```

- [ ] **Step 3: Verify the tree still typechecks and tests pass**

Run:
```bash
cd reference && bun run typecheck && bun test && cd ..
```
Expected: typecheck clean; all remaining tests pass (one fewer test file than before).

- [ ] **Step 4: Verify no dangling `assistant` references**

Run:
```bash
grep -rn assistant reference/src reference/tests
```
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add reference/src/actions/index.ts reference/src/actions/assistant.tsx reference/tests/assistant.test.ts
git commit -m "$(cat <<'EOF'
chore(reference): drop assistant action ahead of AWS-chat materialisation

The merged chat.tsx (next commits) demonstrates the 'both' turn-shape, so
assistant.tsx is redundant and would mislead future runs of the recipe
into registering two actions.
EOF
)"
```

---

### Task 3: Port `shell-tokens.ts` (no test — exercised via bash-core)

**Files:**
- Create: `reference/src/actions/shell-tokens.ts`

- [ ] **Step 1: Copy verbatim from `<downstream-app>`**

Run:
```bash
cp <DOWNSTREAM_REPO>/src/actions/shell-tokens.ts reference/src/actions/shell-tokens.ts
```

- [ ] **Step 2: Verify the file landed**

Run:
```bash
test -f reference/src/actions/shell-tokens.ts && head -1 reference/src/actions/shell-tokens.ts
```
Expected: prints `// Minimal, dependency-free shell tokenizer shared by the bash and aws_cli safety`.

- [ ] **Step 3: Typecheck**

Run:
```bash
cd reference && bun run typecheck && cd ..
```
Expected: clean (the file is not yet imported by anything in `reference/`, so it must at least type-check on its own).

- [ ] **Step 4: Commit**

```bash
git add reference/src/actions/shell-tokens.ts
git commit -m "feat(reference): add shell-tokens module"
```

---

### Task 4: Port `bash-core.ts` + its test

**Files:**
- Create: `reference/src/actions/bash-core.ts`
- Create: `reference/tests/bash-core.test.ts`

- [ ] **Step 1: Copy module and test verbatim**

Run:
```bash
cp <DOWNSTREAM_REPO>/src/actions/bash-core.ts reference/src/actions/bash-core.ts
cp <DOWNSTREAM_REPO>/tests/bash-core.test.ts reference/tests/bash-core.test.ts
```

- [ ] **Step 2: Verify both files landed**

Run:
```bash
test -f reference/src/actions/bash-core.ts && test -f reference/tests/bash-core.test.ts && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Run the bash-core test**

Run:
```bash
cd reference && bun test tests/bash-core.test.ts && cd ..
```
Expected: all `bash-core.test.ts` cases pass (covers delete classification, raw-AWS rejection, wrapper-option bypasses, ANSI-C / backslash normalisation, inline-AWS-env refusal, `shellEnv` env stripping).

- [ ] **Step 4: Typecheck the whole reference tree**

Run:
```bash
cd reference && bun run typecheck && cd ..
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add reference/src/actions/bash-core.ts reference/tests/bash-core.test.ts
git commit -m "feat(reference): add bash-core classifier + tests"
```

---

### Task 5: Port `aws-cli-core.ts` + its test

**Files:**
- Create: `reference/src/actions/aws-cli-core.ts`
- Create: `reference/tests/aws-cli-core.test.ts`

- [ ] **Step 1: Copy module and test verbatim**

Run:
```bash
cp <DOWNSTREAM_REPO>/src/actions/aws-cli-core.ts reference/src/actions/aws-cli-core.ts
cp <DOWNSTREAM_REPO>/tests/aws-cli-core.test.ts reference/tests/aws-cli-core.test.ts
```

- [ ] **Step 2: Verify both files landed**

Run:
```bash
test -f reference/src/actions/aws-cli-core.ts && test -f reference/tests/aws-cli-core.test.ts && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Run the aws-cli-core test**

Run:
```bash
cd reference && bun test tests/aws-cli-core.test.ts && cd ..
```
Expected: all cases pass (read/write classification, `s3` carve-outs, `s3api` local-write ops, managed-flag stripping incl. `--flag=value` form and boolean-flag handling, `isApproval`).

- [ ] **Step 4: Typecheck**

Run:
```bash
cd reference && bun run typecheck && cd ..
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add reference/src/actions/aws-cli-core.ts reference/tests/aws-cli-core.test.ts
git commit -m "feat(reference): add aws-cli-core classifier + tests"
```

---

### Task 6: Port `command-runtime.ts` with generic PROFILE/REGION + its test

**Files:**
- Create: `reference/src/actions/command-runtime.ts`
- Create: `reference/tests/command-runtime.test.ts`

- [ ] **Step 1: Copy module and test verbatim**

Run:
```bash
cp <DOWNSTREAM_REPO>/src/actions/command-runtime.ts reference/src/actions/command-runtime.ts
cp <DOWNSTREAM_REPO>/tests/command-runtime.test.ts reference/tests/command-runtime.test.ts
```

- [ ] **Step 2: Apply the PROFILE/REGION placeholder swap (surgical change #1)**

In `reference/src/actions/command-runtime.ts`, replace lines 8–9 exactly:

Old:
```ts
export const PROFILE = process.env.<APP>_AWS_PROFILE ?? '<old-profile>';
export const REGION = process.env.<APP>_AWS_REGION ?? 'us-east-2';
```

New:
```ts
export const PROFILE = process.env.REFERENCE_AWS_PROFILE ?? 'default';
export const REGION = process.env.REFERENCE_AWS_REGION ?? 'us-east-1';
```

- [ ] **Step 3: Verify the swap landed (no stray Doki references)**

Run:
```bash
grep -n '<APP>_AWS\|<old-profile>\|us-east-2' reference/src/actions/command-runtime.ts
```
Expected: no matches.

Run:
```bash
grep -n 'REFERENCE_AWS\|default\|us-east-1' reference/src/actions/command-runtime.ts
```
Expected: lines for `REFERENCE_AWS_PROFILE`, `'default'`, `REFERENCE_AWS_REGION`, `'us-east-1'`.

- [ ] **Step 4: Run the command-runtime test**

Run:
```bash
cd reference && bun test tests/command-runtime.test.ts && cd ..
```
Expected: both `awsEnv` cases pass (the test exercises `awsEnv`, not `PROFILE`/`REGION` defaults, so it is unaffected by the swap).

- [ ] **Step 5: Typecheck**

Run:
```bash
cd reference && bun run typecheck && cd ..
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add reference/src/actions/command-runtime.ts reference/tests/command-runtime.test.ts
git commit -m "$(cat <<'EOF'
feat(reference): add command-runtime spawn layer + tests

PROFILE/REGION default to neutral placeholders (REFERENCE_AWS_PROFILE /
'default' / 'us-east-1') so reference/ reads as a worked example rather
than a project-specific instance.
EOF
)"
```

---

### Task 7: Port `repo-instructions.ts` with neutral persona + its test

**Files:**
- Create: `reference/src/actions/repo-instructions.ts`
- Create: `reference/tests/repo-instructions.test.ts`

- [ ] **Step 1: Copy module and test verbatim**

Run:
```bash
cp <DOWNSTREAM_REPO>/src/actions/repo-instructions.ts reference/src/actions/repo-instructions.ts
cp <DOWNSTREAM_REPO>/tests/repo-instructions.test.ts reference/tests/repo-instructions.test.ts
```

- [ ] **Step 2: Apply the persona-line swap (surgical change #3)**

In `reference/src/actions/repo-instructions.ts`, replace line 10 exactly:

Old:
```ts
  'You are the <old-app> chat assistant. You help the user operate AWS and inspect/edit',
```

New:
```ts
  'You are the reference chat assistant. You help the user operate AWS and inspect/edit',
```

- [ ] **Step 3: Neutralise the mkdtemp prefix in the test**

In `reference/tests/repo-instructions.test.ts`, replace the `mkdtemp` prefix on line 9:

Old:
```ts
  const dir = await mkdtemp(join(tmpdir(), '<old-app>-repo-'));
```

New:
```ts
  const dir = await mkdtemp(join(tmpdir(), 'reference-repo-'));
```

This is cosmetic (a temp-dir prefix) but keeps `reference/` free of project-name leakage so Task 10's `grep -rn <old-app>` check stays clean.

- [ ] **Step 4: Verify the swaps landed (no stray <old-app> references in either file)**

Run:
```bash
grep -n '<old-app>' reference/src/actions/repo-instructions.ts reference/tests/repo-instructions.test.ts
```
Expected: no matches.

Run:
```bash
grep -n 'reference chat assistant' reference/src/actions/repo-instructions.ts
```
Expected: one match on line 10.

Run:
```bash
grep -n 'reference-repo-' reference/tests/repo-instructions.test.ts
```
Expected: one match on line 9.

- [ ] **Step 5: Run the repo-instructions test**

Run:
```bash
cd reference && bun test tests/repo-instructions.test.ts && cd ..
```
Expected: all five cases pass (loadRepoInstructions present/missing/blank, buildSystemPrompt with/without repo instructions). The test does not assert on the persona text or the mkdtemp prefix, so the swaps do not break it.

- [ ] **Step 6: Typecheck**

Run:
```bash
cd reference && bun run typecheck && cd ..
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add reference/src/actions/repo-instructions.ts reference/tests/repo-instructions.test.ts
git commit -m "$(cat <<'EOF'
feat(reference): add repo-instructions loader + tests

Persona line and the test mkdtemp prefix are neutralised so the example
isn't anchored to a downstream project name.
EOF
)"
```

---

### Task 8: Port the merged `chat.tsx`

**Files:**
- Modify (overwrite): `reference/src/actions/chat.tsx`

- [ ] **Step 1: Overwrite `chat.tsx` with the <downstream-app> version**

Run:
```bash
cp <DOWNSTREAM_REPO>/src/actions/chat.tsx reference/src/actions/chat.tsx
```

- [ ] **Step 2: Verify the file is the merged version**

Run:
```bash
grep -n 'buildAgent\|buildTools\|oneShotInput' reference/src/actions/chat.tsx
```
Expected: at least three matches (one per name).

- [ ] **Step 3: Verify the file starts with the JSX pragma**

Run:
```bash
head -1 reference/src/actions/chat.tsx
```
Expected: `/** @jsxImportSource react */`.

- [ ] **Step 4: Typecheck (this is where all sibling imports get exercised)**

Run:
```bash
cd reference && bun run typecheck && cd ..
```
Expected: clean. If you see "Cannot find module ./aws-cli-core" or similar, a previous task didn't land — go back and verify.

- [ ] **Step 5: Run the full test suite**

Run:
```bash
cd reference && bun test && cd ..
```
Expected: every test passes (the new four plus the pre-existing nine).

- [ ] **Step 6: Commit**

```bash
git add reference/src/actions/chat.tsx
git commit -m "$(cat <<'EOF'
feat(reference): merge AWS + repo chat into the chat action

chat.tsx now demonstrates the recipe's end state: a per-turn ReAct agent
with aws_cli, bash, and query_user tools; 'both' turn-shape via --input;
approval seams routed through the persistent SessionApp input.
EOF
)"
```

---

### Task 9: Create the generic `reference/AGENTS.md`

**Files:**
- Create: `reference/AGENTS.md`

- [ ] **Step 1: Write the file**

Create `reference/AGENTS.md` with exactly this content:
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

- [ ] **Step 2: Verify the file exists and has no Doki content**

Run:
```bash
test -f reference/AGENTS.md && grep -in '<old-profile>\|V3_CUSTOMER\|V4_ORDER\|GSI' reference/AGENTS.md
```
Expected: file exists; `grep` exits non-zero with no output (no Doki content).

- [ ] **Step 3: Confirm `loadRepoInstructions` reads it**

Run:
```bash
cd reference && bun -e "import('./src/actions/repo-instructions').then(m => m.loadRepoInstructions(process.cwd()).then(t => { if (!t || !t.includes('structure policy')) { console.error('FAIL:', t); process.exit(1); } console.log('OK'); }))" && cd ..
```
Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add reference/AGENTS.md
git commit -m "$(cat <<'EOF'
feat(reference): add generic AGENTS.md so loadRepoInstructions has content

Structure policy + placeholder working-agreement line; no project-specific
domain content.
EOF
)"
```

---

### Task 10: End-to-end verification gauntlet

**Files:** none (read-only checks)

- [ ] **Step 1: Final typecheck**

Run:
```bash
cd reference && bun run typecheck && cd ..
```
Expected: clean.

- [ ] **Step 2: Full test suite**

Run:
```bash
cd reference && bun test && cd ..
```
Expected: all tests pass. The new module tests (`aws-cli-core`, `bash-core`, `command-runtime`, `repo-instructions`) must all be present in the output; the removed `assistant.test.ts` must NOT appear.

- [ ] **Step 3: Action registry shows only `chat`**

Run:
```bash
cd reference && bun run start --list && cd ..
```
Expected: output lists `chat` and no other actions.

- [ ] **Step 4: One-shot path executes end-to-end (the AWS call is allowed to fail)**

Run:
```bash
cd reference && bun run start --action chat --input "say hello in one word" 2>&1 | head -40 && cd ..
```
Expected: the agent streams steps (you will see `Step:` / tool-call lines via `streamAgent`) and prints either a one-word reply or an error from the LLM call. **The point is that the process completes without throwing on the streaming/printing path.** An LLM/network error is acceptable here — a crash in `chat.tsx`, `streamAgent`, or `printContextBar` is not.

If the run fails because no `LLM_API_KEY` is configured for the reference project, that is fine — note it and move on.

- [ ] **Step 5: No dangling `assistant` references anywhere in `reference/`**

Run:
```bash
grep -rn assistant reference/src reference/tests
```
Expected: no matches.

- [ ] **Step 6: No `<old-app>` or `<old-profile>` leakage in `reference/src` or `reference/tests`**

Run:
```bash
grep -rn -E '<old-app>|<old-profile>' reference/src reference/tests
```
Expected: at most one match — the `bash-core.test.ts` test fixture (around line 109) uses the literal string `'<old-profile>'` as a test input to document that ANY profile value is stripped by `shellEnv`. If you see only that one match in `tests/bash-core.test.ts`, the gauntlet passes. Any other match (especially anything in `reference/src/`) is a leak — fix it before continuing.

- [ ] **Step 7: No further commit needed**

This task creates no new files; it is verification only. Move to Task 11.

---

### Task 11: Codex review gate

This is the **mandatory** completion gate per `SKILL.md` Step 3.10.

- [ ] **Step 1: Emit the Codex review line for the user to run**

Print exactly this for the user (substitute `<sha>` with the pre-work SHA captured in Task 1 Step 2):
```
/codex:review --base=<sha> --wait
```

- [ ] **Step 2: Stop and wait for the review to run**

Do not declare the work complete. Address any review findings, then re-emit the line if you make further changes. Implementation is NOT done until the review has been run and any findings are addressed.

---

## Files touched, summarised

| File | Action |
| --- | --- |
| `reference/src/actions/index.ts` | Modified (drop `assistant` from registry) |
| `reference/src/actions/assistant.tsx` | Deleted |
| `reference/src/actions/shell-tokens.ts` | Created (verbatim copy) |
| `reference/src/actions/bash-core.ts` | Created (verbatim copy) |
| `reference/src/actions/aws-cli-core.ts` | Created (verbatim copy) |
| `reference/src/actions/command-runtime.ts` | Created (copy + PROFILE/REGION placeholder swap) |
| `reference/src/actions/repo-instructions.ts` | Created (copy + persona-line swap) |
| `reference/src/actions/chat.tsx` | Overwritten (verbatim copy of merged version) |
| `reference/tests/assistant.test.ts` | Deleted |
| `reference/tests/aws-cli-core.test.ts` | Created (verbatim copy) |
| `reference/tests/bash-core.test.ts` | Created (verbatim copy) |
| `reference/tests/command-runtime.test.ts` | Created (verbatim copy) |
| `reference/tests/repo-instructions.test.ts` | Created (verbatim copy) |
| `reference/AGENTS.md` | Created (fresh, generic content) |

Untouched (explicitly): `reference/src/cli.ts`, `reference/src/config.ts`, `reference/src/ink/SessionApp.tsx`, `reference/src/session-core.ts`, `reference/src/ui.tsx`, `reference/src/trace.ts`, `reference/src/llm.ts`, `reference/src/model-info.ts`, `reference/src/params.ts`, `reference/src/dotenv.ts`, `reference/src/index.ts`, `reference/src/actions/_types.ts`, `reference/package.json`, `reference/tsconfig.json`, `reference/bunfig.toml`, `reference/.env.example`, `reference/scripts/scaffold-smoke.ts`, all `templates/*`, `SKILL.md`, `references/*`, `README.md`.
