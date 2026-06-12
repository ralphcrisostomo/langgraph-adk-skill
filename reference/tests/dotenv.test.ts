import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, loadProjectEnv } from '../src/dotenv';

test('parseEnv skips blanks/comments and trims keys + values', () => {
  const parsed = parseEnv('\n# a comment\nLLM_MODEL = gemma  \n\n  # indented comment\nFOO=bar');
  expect(parsed).toEqual({ LLM_MODEL: 'gemma', FOO: 'bar' });
});

test('parseEnv strips one layer of surrounding quotes and keeps inner "="', () => {
  const parsed = parseEnv(`A="hello world"\nB='x'\nURL=http://localhost:8000/v1?k=v\nC=a=b=c`);
  expect(parsed.A).toBe('hello world');
  expect(parsed.B).toBe('x');
  expect(parsed.URL).toBe('http://localhost:8000/v1?k=v');
  expect(parsed.C).toBe('a=b=c'); // only the first `=` splits key/value
});

test('loadProjectEnv applies only keys not already set, returning applied keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dotenv-'));
  try {
    writeFileSync(join(dir, '.env'), 'LLM_PROVIDER=openai\nLLM_MODEL=gpt\n');
    const env: Record<string, string | undefined> = { LLM_PROVIDER: 'anthropic' };
    const applied = loadProjectEnv(dir, env);
    expect(applied).toEqual(['LLM_MODEL']); // existing LLM_PROVIDER wins
    expect(env.LLM_PROVIDER).toBe('anthropic');
    expect(env.LLM_MODEL).toBe('gpt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProjectEnv is a silent no-op when .env is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dotenv-'));
  try {
    const env: Record<string, string | undefined> = {};
    expect(loadProjectEnv(dir, env)).toEqual([]);
    expect(env).toEqual({});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
