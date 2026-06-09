# LangGraph ADK

A [Claude Code](https://claude.com/claude-code) **skill** that architects and scaffolds
JavaScript/TypeScript [LangGraph](https://github.com/langchain-ai/langgraphjs) "ADK"
(Agent Development Kit) command-line apps — interactive, **action-oriented Bun CLIs**.

Invoke it and describe what you want. The skill:

1. **Detects the mode** — scaffold a new CLI, or add an action to an existing one.
2. **Architects one action** — for agent-type actions it analyzes the scenario,
   composes a fitting LangGraph design from primitives, and renders an **ASCII
   diagram for you to approve** before any code is written.
3. **Verifies the current API via context7** (the LangChain JS API drifts) and
   **generates + registers** the action.

Generated CLIs use **minimist** (flags fill parameters), **inquirer** (prompts only
for what's missing), and **chalk + ora** for verbose, observable output — including
live LangGraph node/tool tracing.

## Install

Clone this repo straight into your Claude Code skills directory:

```bash
git clone https://github.com/ralphcrisostomo/langgraph-adk.git ~/.claude/skills/langgraph-adk
```

Then invoke it in Claude Code:

```
/langgraph-adk
```

…or just say *"scaffold me a LangGraph CLI that …"* and the skill activates.

## What a generated CLI looks like

```
my-cli/
  package.json            # bun; scripts: start, test, typecheck
  src/
    index.ts              # minimist parse -> action select -> run
    cli.ts                # inquirer chooser + flag/prompt resolver
    config.ts             # env -> typed config (local LLM by default)
    llm.ts                # model factory
    trace.ts              # verbose LangGraph streaming (chalk + ora)
    actions/
      _types.ts           # Action / ParamDef / Ctx contract
      index.ts            # explicit action registry
      chat.tsx            # demo action; `bun run start` works immediately
```

Run it: `bun run start` (interactive) or `bun run start --action <name> --flag value`.

### Action types

- **Function action** — deterministic logic or a single model call.
- **Agent action** — a LangGraph graph (single agent, sequential, parallel,
  loop-and-critic, coordinator/routing, orchestrator-worker, map-reduce,
  agent-as-tool, or a custom composition). Executes through `runGraphVerbose` so
  every node and tool call is rendered live.

## Stack

| Package | Role |
|---|---|
| `langchain` | `createAgent`, `tool` (LangChain **v1.x**) |
| `@langchain/langgraph` | graph primitives, streaming, checkpointing |
| `@langchain/openai` | `ChatOpenAI` (+ custom `baseURL` for local endpoints) |
| `@langchain/anthropic` | `ChatAnthropic` |
| `inquirer` · `minimist` · `chalk` · `ora` | interactive CLI |

### Default LLM config (env)

Defaults to a **local**, OpenAI-compatible endpoint — override via env:

```
LLM_PROVIDER=local            # local | openai | anthropic
LLM_MODEL=google/gemma-4-26B-A4B-it
LLM_BASE_URL=http://localhost:8000/v1
# LLM_API_KEY=                 # optional for local endpoints
```

## Repo layout

```
SKILL.md                 # the skill: architect method + scaffold logic
references/primitives.md  # LangGraph building-block cheat-sheet
templates/                # verbatim project skeleton + action templates
reference/                # proving-ground CLI (TDD'd, `bun test`) — templates derive from this
docs/superpowers/         # design spec + implementation plan
```

`templates/src` is a verbatim copy of `reference/src`. The `reference/` app is the
tested source of truth; if you change one, keep the other in sync.

### Develop / verify

```bash
cd reference
bun install
bun test          # unit tests
bun run typecheck
bun run scripts/scaffold-smoke.ts   # instantiate templates -> install -> typecheck -> --list
```

## License

MIT — see [LICENSE](LICENSE).
