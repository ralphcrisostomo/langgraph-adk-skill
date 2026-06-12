import { test, expect } from 'bun:test';
import { resolveContextWindow, DEFAULT_CONTEXT_TOKENS } from '../src/model-info';

// No baseUrl -> no live lookup, so these exercise the env/default fallbacks.
test('falls back to the default window when no endpoint and no env', async () => {
  delete process.env.MODEL_CONTEXT_TOKENS;
  const w = await resolveContextWindow({ provider: 'anthropic', model: 'claude', promptLabel: 'you', cwd: '.' });
  expect(w).toBe(DEFAULT_CONTEXT_TOKENS);
});

test('uses MODEL_CONTEXT_TOKENS env as the fallback window', async () => {
  process.env.MODEL_CONTEXT_TOKENS = '200000';
  try {
    const w = await resolveContextWindow({ provider: 'anthropic', model: 'claude', promptLabel: 'you', cwd: '.' });
    expect(w).toBe(200000);
  } finally {
    delete process.env.MODEL_CONTEXT_TOKENS;
  }
});
