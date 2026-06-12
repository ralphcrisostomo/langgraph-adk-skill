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
4. **Gates completion with a Codex review** — after verifying, it emits a
   `/codex:review --base=<short-sha> --wait` line and won't call the work done
   until the review has run.

Generated CLIs use **minimist** (flags fill parameters) and an **Ink** UI (React for
the terminal — menus, text input, spinners; prompts only for what's missing), with
**chalk** for plain colored output and live LangGraph node/tool tracing. The system
prompt is stamped with the current date/time each turn (LLMs have no clock). Multi-turn
actions render a Claude Code-style Ink `<SessionApp>`: the input framed by dividers
above a ccstatusline-style status footer (working dir · model · context-usage bar),
with a configurable `PROMPT_LABEL` prompt prefix.

**Recipes** ship for common scenarios — an [AWS CLI + repo shell assistant](references/chat-aws-repo.md)
(one pinned account, human-approved writes) and [LangSmith tracing](references/langsmith-observability.md).

## Install

Clone this repo straight into your Claude Code skills directory:

```bash
git clone https://github.com/ralphcrisostomo/langgraph-adk-skill.git ~/.claude/skills/langgraph-adk
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
    cli.ts                # action runner; resolves flags/prompts via Ink
    config.ts             # env -> typed config (local LLM by default)
    llm.ts                # model factory
    model-info.ts         # resolves the model's real context window
    trace.ts              # verbose LangGraph streaming (streamAgent)
    session-core.ts       # pure session helpers (status footer, date stamp, history trim)
    params.ts             # Ink chooser + flag/prompt resolver
    ui.tsx                # Ink prompts (menu, text input, confirm, spinner)
    ink/
      SessionApp.tsx      # multi-turn Ink chat UI (framed input + dir/model/context footer)
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
  agent-as-tool, or a custom composition). Executes through `streamAgent` so
  every node and tool call is rendered live.

## Stack

| Package | Role |
|---|---|
| `langchain` | `createAgent`, `tool` (LangChain **v1.x**) |
| `@langchain/langgraph` | graph primitives, streaming, checkpointing |
| `@langchain/openai` | `ChatOpenAI` (+ custom `baseURL` for local endpoints) |
| `@langchain/anthropic` | `ChatAnthropic` |
| `ink` · `@inkjs/ui` · `ink-text-input` · `react` | terminal UI (menus, input, spinner, chat session) |
| `minimist` · `chalk` | flag parsing · colored output |

### Default LLM config (env)

Defaults to a **local**, OpenAI-compatible endpoint — override via env:

```
LLM_PROVIDER=local            # local | openai | anthropic
LLM_MODEL=google/gemma-4-26B-A4B-it
LLM_BASE_URL=http://localhost:8000/v1
# LLM_API_KEY=                 # optional for local endpoints
# PROMPT_LABEL=you             # session prompt prefix, e.g. "you › "
# CWD=.                        # working dir actions run in (default: launch dir)
```

Set `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` to send run traces to
[LangSmith](https://smith.langchain.com) (see the observability recipe).

## Repo layout

```
SKILL.md                              # the skill: architect method + scaffold logic
references/primitives.md              # LangGraph building-block cheat-sheet
references/chat-aws-repo.md           # recipe: AWS CLI + repo bash assistant in chat
references/langsmith-observability.md # recipe: add LangSmith tracing to a project
templates/                            # verbatim project skeleton + action templates
reference/                            # proving-ground CLI (TDD'd, `bun test`) — templates derive from this
docs/superpowers/                     # design spec + implementation plan
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
