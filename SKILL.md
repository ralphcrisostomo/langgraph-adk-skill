---
name: langgraph-adk
version: 0.1.0
description: Use when the user wants to create, scaffold, or extend a JavaScript/TypeScript LangGraph "ADK" command-line agent toolkit — an action-oriented Bun CLI. Architects the agent design (with an ASCII-diagram approval step) and scaffolds or adds actions.
---

# LangGraph ADK — Architect & Scaffold

You architect and scaffold action-oriented LangGraph CLIs (Bun + TypeScript). An
"action" is a menu entry the end-user picks at runtime. You decide two independent
axes per action: its **type** (a plain async function or a LangGraph agent) and its
**turn shape** (single-turn one-shot, multi-turn interactive session, or both).

## ALWAYS verify the API with context7 first

Before writing ANY LangChain/LangGraph code, query context7 for the current API.
The JS API drifts (e.g. `createReactAgent` → `createAgent`). Never write agent
code from memory. Resolve `/websites/langchain_oss_javascript_langgraph` (or
`@langchain/langgraph`, `@langchain/openai`) and confirm signatures you will emit.

## Step 1 — Detect the mode

Check the target directory for `src/actions/index.ts`:
- **Absent → Scaffold-new** (Step 2A)
- **Present → Add-action** (Step 2B)

## Step 2A — Scaffold-new

1. Ask for the project directory name if not given.
2. Copy `templates/` into the target: `src/`, `tsconfig.json`, `bunfig.toml`,
   `.env.example`. Render `package.json.tmpl` → `package.json`, replacing
   `{{PROJECT_NAME}}`.
3. From the target dir, run:
   `bun add langchain @langchain/langgraph @langchain/openai @langchain/anthropic @langchain/core zod minimist chalk ink react @inkjs/ui ink-text-input ink-spinner`
   and `bun add -d typescript bun-types @types/minimist @types/react ink-testing-library`
   (this also pins the `*` versions in package.json).
4. Confirm it runs: `bun run start --list` (should list `chat`).
5. Tell the user how to configure `.env` and run `bun run start`.
6. Then proceed to Step 3 to add their first real action (one run = one action).

## Step 2B — Add-action

Run the architect interview (Step 3) and append exactly one action.

## Step 3 — Architect ONE action

1. **Understand the scenario.** Ask what the action should do, its inputs, and its
   output. Keep it to one action; if the scenario is really several, say so and
   recommend splitting (the user re-runs per action).
2. **Pick the type:**
   - **Function** — deterministic logic or a single model call → use
     `action.function.ts.tmpl`.
   - **Agent** — needs tools, multi-step reasoning, or orchestration → continue.
3. **Pick the turn shape.** Ask the user and present it as a single-select choice
   (an Ink `selectMenu` — offer these three options):
   - **single-turn** (one-shot) — one request in → one answer out → exits. The
     default; keeps nothing between runs.
   - **multi-turn** (interactive session / REPL) — render the Ink `<SessionApp>`
     (`src/ink/SessionApp.tsx`): a pinned footer with a ccstatusline-style `Model:`
     line above a usage bar
     (vs the model's **real** `ctx.contextWindow`, resolved by `src/model-info.ts`
     from the provider's `/models` endpoint with a `MODEL_CONTEXT_TOKENS` env
     fallback), history trimming, and quit on **Ctrl+C** or `/exit`. Pass
     `respond(messages, { onStep, ask })` for one turn — `ask` is the human-in-the-loop
     seam. The action file is `.tsx`. Copy the seed `src/actions/chat.tsx`; pure
     helpers live in `src/session-core.ts`.
   - **both** — run one-shot when the input is supplied via flags (e.g.
     `--input ...`), otherwise render the `<SessionApp>`; or offer an Ink
     `selectMenu` ("Run once" vs "Start a session") at startup. Worked example:
     `reference/src/actions/assistant.tsx` (`params: []`, branch on `--input`;
     one-shot prints, else renders `<SessionApp>`).

   Turn shape is orthogonal to type: a Function or an Agent can be single- or
   multi-turn. For a multi-turn **agent**, each turn streams through
   `streamAgent` inside the session's `respond` callback.
4. **Compose the graph from primitives** (see `references/primitives.md`). There is
   NO fixed catalog — reason from the scenario to the smallest graph that fits
   (single agent, sequential, parallel, loop-and-critic, coordinator/routing,
   orchestrator-worker, map-reduce, agent-as-tool, or a custom mix).
5. **Render an ASCII diagram** of the concrete graph (nodes + edges) and explain
   why this shape fits. Example:

   ```
      +-----------+
      |  drafter  |<-------------+
      +-----+-----+              |
            v                    | revise (not good enough)
      +-----------+              |
      |  critic   |--------------+
      +-----+-----+
            | approved
            v
          [done]
   ```

   **Wait for the user to accept or request changes. Loop until accepted.**
6. **Verify the API via context7** for every construct you will emit
   (`createAgent`, `StateGraph`, `addConditionalEdges`, `Send`, `Command`,
   reducers, `tool`, streaming).
7. **Generate the action file** from `action.function.ts.tmpl` or
   `action.agent.ts.tmpl` into `src/actions/<name>.ts` (or `.tsx` if it renders
   Ink), replacing the `{{...}}` markers. Agent actions stream node/tool steps via
   `streamAgent(graph, input, onStep)` from `../trace` (print with chalk, or feed
   `onStep` to the Ink session). Tools that report progress are authored as
   `async function*` so `on_tool_event` fires. Multi-turn (or both) actions are
   `.tsx` and render `<SessionApp>`.
8. **Register it.** Add an import and append to the `actions` array in
   `src/actions/index.ts`.
9. **Verify:** `bun run typecheck` then `bun run start --action <name> ...`.
10. **Gate completion with a Codex review (MANDATORY).** Implementation is NOT done
    until the diff has been reviewed by Codex. Capture the pre-work commit first
    (`git rev-parse --short HEAD` BEFORE you start editing), then after verification
    passes, emit this exact copy-paste line for the user (substitute the captured
    SHA) and stop — do not declare the work complete until the review is run:

    ```
    /codex:review --base=<short-sha> --wait
    ```

    `<short-sha>` is the short commit SHA the work started from (the review diffs
    everything since that commit). Address any review findings, then re-emit the
    line if you make further changes.

## Conventions you MUST keep

- The UI runtime is **Ink** (React for the terminal) — no inquirer, no ora.
  Prompts come from `src/ui.tsx` (`selectMenu`, `askText`, `askConfirm`); wrap slow
  work in `withSpinner`. `ctx.log` is still chalk for plain colored output.
- Parameters are declarative `ParamDef[]`. minimist flags fill them; `resolveParams`
  Ink-prompts only for what is missing. Never hand-roll prompt plumbing in an action.
- The "Choose an action" menu (`selectAction` in `src/params.ts`) pads each action
  name to the longest name's width (`padEnd`) before the `—` so descriptions line up
  in a column. Keep that alignment when editing the menu label.
- The `Ctx` gives every action `{ llm, log (chalk), getDocs, contextWindow, model }`.
- Agent runs stream node/tool steps via `streamAgent` (from `src/trace.ts`).
- **Mandatory model + context bar**: any action that calls the LLM MUST surface the
  model id and context usage — multi-turn via `<SessionApp>` (live footer: a `Model:`
  line above the bar), one-shot via
  `printContextBar(ctx.log, ctx.contextWindow, messages, ctx.model)` (from
  `src/session-core.ts`). The action templates include it by default.
- Turn shape: single-turn actions return after one run; multi-turn actions are
  `.tsx` and render the Ink `<SessionApp>` (pinned context footer; bar shows usage
  vs the real `ctx.contextWindow`). Pure helpers live in `src/session-core.ts`;
  `chat` is the reference multi-turn action.
- Keep each file focused; one action per file. Actions that render Ink are `.tsx`.
- **Codex review gates completion**: never call the implementation done until a
  Codex review of the diff has run. After verification, emit the copy-paste line
  `/codex:review --base=<short-sha> --wait` (with the pre-work short SHA) and wait.

## Templates

- `templates/` — verbatim skeleton (do not regenerate from memory). Core:
  `src/ui.tsx` (Ink prompts + spinner), `src/session-core.ts` (pure session
  helpers), `src/ink/SessionApp.tsx` (pinned-footer chat UI), `src/trace.ts`
  (`streamAgent`), `src/model-info.ts` (context window).
- `templates/src/actions/chat.tsx` — seed action and reference **multi-turn
  Ink session**.
- `action.function.ts.tmpl` / `action.agent.ts.tmpl` — action bodies you fill in
  (rename to `.tsx` when rendering Ink).
- `references/primitives.md` — LangGraph building blocks to compose from.
