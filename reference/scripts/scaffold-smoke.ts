import { mkdtempSync, cpSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const templatesDir =
  process.env.TEMPLATES_DIR ?? join(homedir(), '.claude/skills/langgraph-adk/templates');

if (!existsSync(templatesDir)) {
  console.error(`Templates dir not found: ${templatesDir}`);
  process.exit(1);
}

const dest = mkdtempSync(join(tmpdir(), 'adk-smoke-'));
cpSync(templatesDir, dest, { recursive: true });

// Substitute {{PROJECT_NAME}} in package.json.tmpl -> package.json
const tmpl = join(dest, 'package.json.tmpl');
if (existsSync(tmpl)) {
  const filled = readFileSync(tmpl, 'utf8').replaceAll('{{PROJECT_NAME}}', 'smoke-cli');
  writeFileSync(join(dest, 'package.json'), filled);
}

// Drop any *.tmpl action body templates so they don't break typecheck
for (const f of ['action.function.ts.tmpl', 'action.agent.ts.tmpl', 'package.json.tmpl']) {
  const p = join(dest, f);
  if (existsSync(p)) renameSync(p, `${p}.bak`);
}

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd: dest, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')}`);
    process.exit(1);
  }
}

run('bun', ['install']);
run('bun', ['run', 'typecheck']);
run('bun', ['run', 'start', '--list']);

console.log(`\n✅ scaffold smoke passed in ${dest}`);
