#!/usr/bin/env bun
import { resolve } from 'node:path';
import minimist from 'minimist';
import { loadProjectEnv } from './dotenv';

// Installed as a linked global bin (`bun link`), this command runs with the
// caller's cwd — so actions operate on the directory you invoke it from, while
// Bun's auto .env load also targets that dir. Load the project's own .env first
// (resolved from this file's location) so config works from anywhere.
loadProjectEnv(resolve(import.meta.dir, '..'));

// Import the CLI graph AFTER the env load: actions snapshot env into module-level
// constants at import time, so a static import here would read env too early.
const { runCli } = await import('./cli');

const argv = minimist(process.argv.slice(2));

runCli(argv as Record<string, unknown>).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
