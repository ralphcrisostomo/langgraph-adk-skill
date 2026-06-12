# Global bin launcher for scaffolded CLIs

**Date:** 2026-06-12

## Goal

Let a scaffolded LangGraph ADK CLI be installed once (`bun link`) and invoked as a
global command (named after the package, e.g. `puretec-bot`) from *any* directory,
operating on the directory you are standing in — the footer `Dir:` line, file
tools, and `process.cwd()` all follow your invocation directory.

## Why it (mostly) works for free

A linked bin runs `src/index.ts` with `process.cwd()` = the caller's shell cwd.
`config.cwd` already defaults to `resolve('.')` → that cwd, and `cli.ts` already
`process.chdir()`es to it. So "cwd follows invocation" needs **no** logic change in
`config.ts` / `cli.ts`. The `CWD` env stays as an explicit override.

## The one real change — `.env` loading

Bun auto-loads `.env` from the caller's cwd, not the project. Running the global
command from `~/some-repo` would fail to load the project's LLM config. Fix: the
entry point explicitly loads the project's own `.env` at startup.

**Precedence: no-override.** Keys already present in the environment (real exported
env, or a local dir's `.env` that Bun auto-loaded) win over the project's `.env`.
This matches standard dotenv semantics and Bun's own behavior.

## Components

1. **`package.json` / `package.json.tmpl`** — add
   `"bin": { "{{PROJECT_NAME}}": "src/index.ts" }` (reference uses its own package
   name). `bun link` exposes it globally.
2. **`src/dotenv.ts`** (new) — two pure, testable functions:
   - `parseEnv(text)` — skips blank lines and `#` comments, trims keys/values,
     strips one layer of surrounding quotes, keeps `=` inside values.
   - `loadProjectEnv(root, env = process.env)` — reads `<root>/.env`, sets each key
     only if absent, returns applied keys; missing file is a silent no-op.
3. **`src/index.ts`** — add `#!/usr/bin/env bun` shebang; before `runCli`, call
   `loadProjectEnv(resolve(import.meta.dir, '..'))` (resolves project root from the
   source location, which survives the `bun link` symlink).
4. **Docs** — `.env.example` note, README "Install as a global command" section +
   env-block note, and a `SKILL.md` convention bullet.
5. Mirrored into both **`templates/`** and **`reference/`**.

## Testing

`reference/tests/dotenv.test.ts`: comment/quote/`=`-in-value parsing; no-override
semantics (returns only newly applied keys); missing `.env` is graceful.

## Out of scope

Auto-editing the user's shell rc; a bin name separate from the package name; any
change to `config.ts` / `cli.ts`.
