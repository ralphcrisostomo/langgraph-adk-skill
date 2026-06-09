---
name: langgraph-adk
description: Use when the user wants to create, scaffold, or extend a JavaScript/TypeScript LangGraph "ADK" command-line agent toolkit — an action-oriented Bun CLI. Architects the agent design (with an ASCII-diagram approval step) and scaffolds or adds actions.
---

# LangGraph ADK — Architect & Scaffold

You architect and scaffold action-oriented LangGraph CLIs (Bun + TypeScript). An
"action" is a menu entry the end-user picks at runtime; it is either a plain async
function or a LangGraph agent. You decide which per action.

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
   `bun add langchain @langchain/langgraph @langchain/openai @langchain/anthropic @langchain/core zod inquirer minimist chalk ora`
   and `bun add -d typescript bun-types @types/minimist`
   (this also pins the `*` versions in package.json).
4. Confirm it runs: `bun run start --list` (should list `ping-llm`).
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
3. **Compose the graph from primitives** (see `references/primitives.md`). There is
   NO fixed catalog — reason from the scenario to the smallest graph that fits
   (single agent, sequential, parallel, loop-and-critic, coordinator/routing,
   orchestrator-worker, map-reduce, agent-as-tool, or a custom mix).
4. **Render an ASCII diagram** of the concrete graph (nodes + edges) and explain
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
5. **Verify the API via context7** for every construct you will emit
   (`createAgent`, `StateGraph`, `addConditionalEdges`, `Send`, `Command`,
   reducers, `tool`, streaming).
6. **Generate the action file** from `action.function.ts.tmpl` or
   `action.agent.ts.tmpl` into `src/actions/<name>.ts`, replacing the `{{...}}`
   markers. Agent actions MUST execute via `runGraphVerbose(graph, input,
   ctx.spinner)` so node/tool steps render verbosely (chalk + ora). Tools that
   report progress are authored as `async function*` so `on_tool_event` fires.
7. **Register it.** Add an import and append to the `actions` array in
   `src/actions/index.ts`.
8. **Verify:** `bun run typecheck` then `bun run start --action <name> ...`.

## Conventions you MUST keep

- Parameters are declarative `ParamDef[]`. minimist flags fill them; inquirer
  prompts only for what is missing. Never hand-roll prompt plumbing in an action.
- The `Ctx` gives every action `{ llm, log (chalk), spinner (ora), getDocs }`.
- Verbose by default: agent runs stream through `runGraphVerbose`.
- Keep each file focused; one action per file.

## Templates

- `templates/` — verbatim skeleton (do not regenerate from memory).
- `action.function.ts.tmpl` / `action.agent.ts.tmpl` — action bodies you fill in.
- `references/primitives.md` — LangGraph building blocks to compose from.
