# Recipe: LangSmith observability (tracing)

Enable per-run tracing for an existing scaffolded project: every `ctx.llm.invoke(...)`
and every `createAgent`/graph run becomes a nested trace (model calls, tool calls,
inputs/outputs, real token counts, latency) in the LangSmith UI at smith.langchain.com.

This is a **cross-cutting upgrade**, NOT an action — skip the Step 3 architect
interview, but the global conventions still apply (capture the pre-work SHA; the
Codex review gate runs on the diff at the end). The code below is already verified
against current LangSmith docs — no context7 check needed unless you deviate from it
(moving the flush to fit a drifted `cli.ts` is NOT a deviation; new APIs are).
No new dependencies and no graph changes: `@langchain/core` (already a dep) has
LangSmith tracing built in, activated purely by environment variables.

## Step 0 — Privacy check (ask FIRST)

Traces include **full prompts, history, and tool outputs** sent to LangSmith's
cloud. For actions that touch sensitive systems (e.g. an aws-assistant whose tool
results contain account/resource data), confirm with the user that this is
acceptable before enabling. If cloud is a blocker, suggest a self-hosted
alternative (e.g. Langfuse) instead of this recipe — do not enable by default.

Also ask what to call the LangSmith project (default: the package name).

## Steps

1. **Env vars** — append to `.env.example` (commented out) and tell the user to set
   them in `.env` with a real key from smith.langchain.com → Settings → API Keys:

   ```bash
   # LangSmith tracing (optional). Set all three to send run traces to
   # smith.langchain.com. NOTE: traces include full prompts and tool outputs.
   # LANGSMITH_TRACING=true
   # LANGSMITH_API_KEY=lsv2_...
   # LANGSMITH_PROJECT=<project-name>
   ```

   Use the `LANGSMITH_*` names — the older `LANGCHAIN_TRACING_V2` /
   `LANGCHAIN_API_KEY` names are legacy. Do NOT set both. Never write the user's
   `.env` yourself (it holds secrets) — edit `.env.example`, then tell the user
   what to paste into `.env`.

2. **Do NOT `bun add langsmith`** — it ships transitively via `@langchain/core`.
   Adding it directly risks a second, version-skewed copy.

3. **Flush before exit** — one-shot actions can exit before background trace
   batches send. In `src/cli.ts`, wrap the action run in `runCli` with a `finally`:

   ```ts
   import { awaitAllCallbacks } from '@langchain/core/callbacks/promises';

   // Traces only exist once an action runs — a Ctrl+C at the pre-action prompts
   // (ExitPromptError) must keep its instant exit, so the flush is skipped then.
   let actionStarted = false;
   try {
     // ...selectAction / resolveParams as-is, then:
     actionStarted = true;
     // ...action.run as-is
   } finally {
     // Deliberately NO tracing-enabled env guard. langsmith's "is tracing on"
     // logic spans many env knobs (LANGSMITH_/LANGCHAIN_ × TRACING/TRACING_V2,
     // LANGSMITH_TRACING_MODE=otel, OTEL_ENABLED, …) and drifts across releases;
     // re-deriving it here silently drops traces for configs you forgot. Safety
     // comes from three structural properties instead:
     //   • actionStarted — a Ctrl+C at the pre-action prompts (ExitPromptError)
     //     keeps its instant exit; traces only exist once an action ran.
     //   • the catch — awaitAllCallbacks() constructs the LangSmith client even
     //     when tracing is off, so a bad LANGSMITH_* env value (e.g. an
     //     out-of-range LANGSMITH_TRACING_SAMPLING_RATE) throws here; it warns
     //     but MUST NOT change the run's outcome.
     //   • the 5s cap — the client retries with ~90s timeouts, so an unreachable
     //     endpoint would otherwise hang the exit for minutes.
     // When tracing is off the flush resolves in a few ms, so it's unconditional.
     if (actionStarted) {
       const flush = awaitAllCallbacks().then(
         () => 'ok' as const,
         (err) => {
           console.error(chalk.dim(`trace flush failed: ${err instanceof Error ? err.message : String(err)}`));
           return 'error' as const;
         },
       );
       const timeout = new Promise<'timeout'>((resolve) => {
         setTimeout(resolve, 5_000, 'timeout').unref(); // unref: timer must not hold the process open
       });
       if ((await Promise.race([flush, timeout])) === 'timeout') {
         console.error(chalk.dim('trace flush timed out (5s) — some traces may be incomplete'));
       }
     }
   }
   ```

   (Keep the existing `catch` clauses; only add the `finally`. If the project's
   `cli.ts` has drifted from the template, put the flush wherever the action run
   completes — the requirement is "flush after the action, before the process
   exits". Ink sessions exit via `useApp().exit()`, which resolves
   `waitUntilExit`, so the same `finally` covers them; a hard SIGKILL can still
   drop the last batch — acceptable.)

4. **Verify** — `bun run typecheck`, then with `.env` populated run one one-shot
   action (e.g. `--input "hi"`) and one session turn, and confirm both traces
   appear under the project in the LangSmith UI with the model call visible.
   With `LANGSMITH_TRACING` unset, confirm the CLI still runs (tracing must stay
   opt-in; zero overhead when off). If the user has no API key yet, verify
   typecheck + tracing-off behavior and say plainly that the UI check is pending
   their key — do not claim end-to-end verification.

## Notes

- Works with ALL providers including `LLM_PROVIDER=local` — tracing hooks
  LangChain's callback layer, not the vendor API.
- Free tier is ~5k traces/month; fine for CLI use.
- Recommend a key with an expiration (not "Never") since it lives in `.env`.
