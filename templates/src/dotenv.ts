import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parse a `.env` file's text into key/value pairs. Skips blank lines and
 * `#` comments, strips one layer of surrounding single/double quotes, and
 * preserves `=` characters that appear inside the value.
 */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/**
 * Load `<root>/.env` into `env`, setting only keys that are not already
 * present — so real exported env (and Bun's own cwd auto-load) win. A missing
 * file is a silent no-op. Returns the list of keys that were applied.
 *
 * Needed because a linked global bin (`bun link`) runs with the caller's cwd,
 * where Bun looks for `.env`; the project's own config lives next to the source.
 */
export function loadProjectEnv(
  root: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const path = resolve(root, '.env');
  if (!existsSync(path)) return [];
  const parsed = parseEnv(readFileSync(path, 'utf8'));
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
