import { test, expect } from 'bun:test';
import { loadConfig } from '../src/config';

test('defaults to local provider with gemma + localhost', () => {
  const c = loadConfig({});
  expect(c.provider).toBe('local');
  expect(c.model).toBe('google/gemma-4-26B-A4B-it');
  expect(c.baseUrl).toBe('http://localhost:8000/v1');
  expect(c.apiKey).toBe('not-needed');
});

test('honors explicit overrides', () => {
  const c = loadConfig({
    LLM_PROVIDER: 'anthropic',
    LLM_MODEL: 'claude-opus-4-8',
    LLM_API_KEY: 'sk-x',
  });
  expect(c.provider).toBe('anthropic');
  expect(c.model).toBe('claude-opus-4-8');
  expect(c.baseUrl).toBeUndefined();
  expect(c.apiKey).toBe('sk-x');
});

test('rejects an unknown provider', () => {
  expect(() => loadConfig({ LLM_PROVIDER: 'bogus' })).toThrow(/Invalid LLM_PROVIDER/);
});
