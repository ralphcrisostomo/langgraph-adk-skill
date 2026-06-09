# LangChain ADK Skill — Design Spec

**Date:** 2026-06-09
**Status:** Approved design, pre-implementation
**Type:** Claude Code skill (personal, `~/.claude/skills/langchain-adk/`)

## Summary

A personal Claude Code skill that acts as an **architect + scaffolder** for the
user's custom JavaScript/TypeScript LangGraph "ADK" (Agent Development Kit) CLIs.

Invoking the skill either **scaffolds a new** action-oriented Bun CLI or **adds a
new action to an existing one**. For agent-type actions, the skill *analyzes the
scenario, composes a fitting LangGraph design from primitives, renders an ASCII
diagram for the user to accept, verifies the current API via context7, then
generates the code.*

The generated CLI is an interactive, action-oriented tool (`bun run start`):
minimist parses flags, inquirer fills any missing parameters, chalk + ora give
verbose, observable feedback (including live LangGraph node/tool tracing).

## Goals

- One skill that both **scaffolds new** CLIs and **incrementally extends** them.
- An **architect** that reasons about the problem and proposes a LangGraph design
  (with an ASCII diagram approval gate), rather than a fixed pattern picker.
- Generated code that is **current** — context7 verifies the LangGraph JS API at
  scaffold time (the API drifts; e.g. `createReactAgent` → `createAgent`).
- A uniform, **observable** runtime: verbose step/tool tracing via chalk + ora.

## Non-Goals (MVP)

- Rich multi-action orchestration in a single architect run (one run = one action).
- Deep MCP/context7 runtime wiring (runtime context7 is a minimal helper for now).
- Persistent cross-session checkpointing/memory.
- A test suite beyond a scaffold smoke check.

## Approach

**Hybrid (Approach 3):** the skill ships a small, stable **skeleton** copied
verbatim (CLI loop, registry, model factory, config, trace renderer), while the
**per-action body** — especially LangGraph agent graphs — is *generated* with a
context7 currency check. Skeleton stays boring and reliable; the parts that drift
stay fresh.

## Key Decisions

| Decision | Choice |
|---|---|
| Skill role | Architect **and** scaffold |
| Generated app | Interactive, action-oriented CLI (`bun run start`) |
| Runtime | Bun + TypeScript (runs `.ts` natively) |
| Action types | Mixed: plain async functions **and** LangGraph agents (architect decides per-action) |
| LLM provider | Configurable; **defaults to `local`** (OpenAI-compatible endpoint) |
| LangGraph patterns | **No seeded catalog** — architect composes from primitives every run, ASCII approval each time |
| context7 | Both scaffold-time (API currency) **and** a minimal runtime helper |
| Param entry | minimist flags **fill**, inquirer **catches the gaps** (declarative `ParamDef`) |
| Observability | Verbose LangGraph tracing (node + tool events) via chalk + ora |
| Action scope | One architect run produces exactly one action |

## Generated Stack

| Package | Role |
|---|---|
| `langchain` | `createAgent`, `tool` — agent-type actions |
| `@langchain/langgraph` | graph primitives: `StateGraph`, conditional edges, `Send`, `Command`, reducers, checkpointers |
| `@langchain/openai` | `ChatOpenAI` with `configuration.baseURL` → **local** default + OpenAI |
| `@langchain/anthropic` | `ChatAnthropic` → Claude option |
| `inquirer` | interactive prompts (action choice + missing params) |
| `minimist` | CLI flag parsing |
| `chalk` | colored output |
| `ora` | async spinners + verbose trace rendering |

Default model config (env):

```
LLM_PROVIDER=local                       # local | openai | anthropic
LLM_MODEL=google/gemma-4-26B-A4B-it
LLM_BASE_URL=http://localhost:8000/v1
# LLM_API_KEY=...                          # optional; local endpoints often need a placeholder
```

## Skill Layout

```
~/.claude/skills/langchain-adk/
  SKILL.md                       # architect method + scaffold logic + mode detection
  references/primitives.md       # LangGraph building-block cheat-sheet (compose-from)
  templates/                     # stable skeleton, copied verbatim
    package.json.tmpl
    tsconfig.json.tmpl
    .env.example
    src/index.ts.tmpl            # minimist parse -> action select -> menu loop
    src/cli.ts.tmpl              # inquirer action chooser + resolveParams()
    src/config.ts.tmpl           # env load + validate
    src/llm.ts.tmpl              # model factory
    src/trace.ts.tmpl            # runGraphVerbose() — streams + renders
    src/actions/_types.ts        # Action / ParamDef / Ctx interfaces (verbatim)
    src/actions/index.ts.tmpl    # explicit action registry array
    src/actions/ping-llm.ts      # demo action; fresh scaffold runs immediately
    templates/action.function.ts.tmpl   # plain-fn action body
    templates/action.agent.ts.tmpl      # agent-action scaffold (graph body generated)
```

## Two Modes (auto-detected)

The skill checks the target dir for `src/actions/index.ts`:

1. **Scaffold-new** (absent) — copy skeleton, set project name, write `.env.example`,
   run `bun install`, include the `ping-llm` demo so `bun run start` works at once.
2. **Add-action** (present) — skip skeleton; run the architect interview, generate
   one action, register it in `src/actions/index.ts`.

### Layering note

The **architect interview happens in the Claude Code conversation** (Claude asks
the user what the action should do, proposes a design, shows ASCII). The
**inquirer menu is the generated CLI's end-user runtime**. Two distinct prompt
layers.

## Action Contract

A uniform, declarative module shape — this is what makes "add an action" clean and
what the registry iterates.

```ts
// src/actions/_types.ts
export interface ParamDef {
  name: string;
  message: string;                 // inquirer prompt text
  type?: 'input' | 'number' | 'confirm' | 'list';
  choices?: unknown[];
  required?: boolean;
  default?: unknown;
  validate?: (v: unknown) => true | string;
}

export interface Ctx {
  llm: BaseChatModel;              // from the model factory
  log: typeof chalk;               // colored output
  spinner: Ora;                    // async feedback
  getDocs: (query: string) => Promise<string>;   // minimal runtime context7 helper
}

export interface Action {
  name: string;
  description: string;             // shown in the inquirer menu
  params: ParamDef[];              // declarative
  run(values: Record<string, unknown>, ctx: Ctx): Promise<void>;
}
```

Registry (`src/actions/index.ts`) is an **explicit array** the skill edits on add —
deterministic, no import-glob magic:

```ts
import { pingLlm } from './ping-llm';
export const actions: Action[] = [pingLlm /*, newAction */];
```

## CLI Flow

`bun run start` → `src/index.ts`:

1. **minimist** parses argv into a flat flag object.
2. Action selection: `--action <name>` selects it; if absent, inquirer **list**
   menu of `name` + `description`.
3. **`resolveParams(action.params, flags)`** (in `cli.ts`) walks each `ParamDef`:
   if the flag is present and valid, use it; otherwise inquirer prompts
   (`when: () => !(name in flags)`), enforcing `required` / `validate`.
4. `action.run(values, ctx)` executes — ora spinner while running, chalk output.
5. Loop back to the menu / exit.

```
bun run start --action draft-pr --title "Fix auth"
   -> action known, title known, --base missing
   -> inquirer asks ONLY for base, then runs (spinner -> output)
```

Fully non-interactive when all flags are supplied; interactive exactly where a
required parameter is missing.

## Action Types

- **Function action** — plain async body; may call `ctx.llm.invoke(...)`, using
  `ctx.spinner` for async feedback. Generated from `action.function.ts.tmpl`.
- **Agent action** — a LangGraph design. The architect runs:

  ```
  user describes scenario
     -> skill analyzes, composes a graph from LangGraph primitives (+ context7)
     -> skill renders an ASCII diagram of the concrete graph
     -> user accepts ----------> context7 API check -> generate action + register
        |                                                     ^
        +-- request changes -> re-diagram (loop) -------------+
  ```

  Generated body uses `createAgent` (single/ReAct) or a hand-built `StateGraph`
  (sequential, parallel, loop-and-critic, routing/coordinator, orchestrator-worker,
  map-reduce via `Send`, agent-as-tool, or a custom composition) — whatever fits
  the scenario. There is **no fixed catalog**; the architect composes each time and
  always shows ASCII before generating.

### ASCII approval example (Loop & Critic)

```
   +-------------+
   |   drafter   |<--------------+
   +------+------+               |
          v                      | revise (not good enough)
   +-------------+               |
   |   critic    |---------------+
   +------+------+
          | approved
          v
        [done]
```

## Observability (Verbose Tracing)

Agent actions execute through a shared skeleton helper rather than calling
`.invoke` directly, so tracing is uniform.

```ts
// src/trace.ts — runGraphVerbose(graph, input, ctx): streams + renders, returns final state
for await (const [mode, chunk] of await graph.stream(input, { streamMode: ["updates", "tools"] })) {
  if (mode === "updates") { /* ▸ <node>  (chalk.cyan) per node entered */ }
  if (mode === "tools") switch (chunk.event) {
    case "on_tool_start": ctx.spinner.start(chalk.yellow(`🔧 ${chunk.name}(${fmt(chunk.input)})`)); break;
    case "on_tool_event": ctx.spinner.text = chalk.dim(chunk.data?.message ?? "…");                 break;
    case "on_tool_end":   ctx.spinner.succeed(chalk.green(`✓ ${chunk.name}`)); /* dim output */      break;
    case "on_tool_error": ctx.spinner.fail(chalk.red(`✗ ${chunk.name}`));                            break;
  }
}
```

Render legend: `▸ node` (cyan) · `🔧 tool(args)` live ora spinner (yellow) ·
`✓ tool` (green) · `✗ tool` (red) · final answer (bold). Tools that want progress
are authored as `async function*` so `on_tool_event` fires; the architect does this
when an action benefits from it.

## Model Factory

`src/llm.ts` reads env and returns a configured model instance (consumed by both
function actions via `.invoke` and agent actions via `createAgent({ model, ... })`):

- `local` / `openai` → `new ChatOpenAI({ model, configuration: { baseURL }, apiKey })`
- `anthropic` → `new ChatAnthropic({ model, apiKey })`

Defaults to the `local` / gemma / `localhost` endpoint.

## context7 Integration

- **Scaffold-time (currency):** before generating LangGraph/LangChain code, the
  skill queries context7 for the current API so generated code is not stale. This
  is the primary value — it auto-corrects drift like `createReactAgent` →
  `createAgent`.
- **Runtime (minimal):** the generated `Ctx` exposes `getDocs(query)`; agent
  actions can optionally include a docs-lookup tool. Kept intentionally minimal for
  MVP; deeper MCP wiring is deferred.

## Error Handling

- Missing required env → friendly `config.ts` validation message (chalk red), exit.
- Action throws → `ctx.spinner.fail()` + red chalk, return to the menu (interactive)
  or non-zero exit (flag-driven run).
- Tool error during a graph run → surfaced via `on_tool_error` in the trace.

## Testing (MVP)

A scaffold **smoke check**: generate a fresh project, `bun install` succeeds, and
`bun run start --action ping-llm` runs the demo action end-to-end against the
configured (local) endpoint.

## Open Items / Future

- Multi-action architect runs (decompose a scenario into several actions at once).
- Deeper context7 runtime integration via MCP.
- Persistent checkpointing/memory across CLI sessions.
- Optional seeded pattern catalog if compose-every-time proves repetitive.
