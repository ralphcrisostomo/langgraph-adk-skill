import { test, expect, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSystemPrompt, loadRepoInstructions, SYSTEM_PROMPT } from '../src/actions/repo-instructions';

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'reference-repo-'));
  dirs.push(dir);
  return dir;
}
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('loadRepoInstructions returns trimmed content when AGENTS.md is present', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'AGENTS.md'), '\n  Always use tabs.  \n');
  expect(await loadRepoInstructions(dir)).toBe('Always use tabs.');
});

test('loadRepoInstructions returns undefined when AGENTS.md is missing', async () => {
  const dir = await tempDir();
  expect(await loadRepoInstructions(dir)).toBeUndefined();
});

test('loadRepoInstructions returns undefined for a blank AGENTS.md', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'AGENTS.md'), '   \n\n');
  expect(await loadRepoInstructions(dir)).toBeUndefined();
});

test('buildSystemPrompt omits the repo block when there are no instructions', () => {
  const prompt = buildSystemPrompt(undefined);
  expect(prompt).toContain(SYSTEM_PROMPT);
  expect(prompt).toContain('Current date and time:');
  expect(prompt).not.toContain('Repository instructions from AGENTS.md');
});

test('buildSystemPrompt embeds repo instructions in a fenced md block', () => {
  const prompt = buildSystemPrompt('Use tabs.');
  expect(prompt).toContain('Repository instructions from AGENTS.md:');
  expect(prompt).toContain('```md');
  expect(prompt).toContain('Use tabs.');
});
