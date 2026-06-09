import { test, expect } from 'bun:test';
import {
  contextBar,
  estimateTokens,
  historyBudget,
  trimHistory,
  usedTokens,
  type ChatMsg,
} from '../src/session-core';

test('estimateTokens approximates 4 chars per token', () => {
  expect(estimateTokens('')).toBe(0);
  expect(estimateTokens('a'.repeat(8))).toBe(2);
  expect(estimateTokens('a'.repeat(9))).toBe(3); // rounds up
});

test('trimHistory drops oldest turns until under budget, preserving the newest', () => {
  const history: ChatMsg[] = [
    { role: 'user', content: 'x'.repeat(400) },
    { role: 'assistant', content: 'y'.repeat(400) },
    { role: 'user', content: 'z'.repeat(400) },
    { role: 'assistant', content: 'w'.repeat(40) },
  ];
  const { kept, dropped } = trimHistory(history, 120);
  expect(dropped).toBeGreaterThan(0);
  expect(kept.reduce((n, m) => n + estimateTokens(m.content), 0)).toBeLessThanOrEqual(120);
  expect(kept.at(-1)!.content).toBe('w'.repeat(40));
  expect(history).toHaveLength(4); // pure: original untouched
});

test('trimHistory keeps the latest message even if it alone exceeds the budget', () => {
  const { kept, dropped } = trimHistory([{ role: 'user', content: 'q'.repeat(1000) }], 10);
  expect(dropped).toBe(0);
  expect(kept).toHaveLength(1);
});

test('historyBudget reserves ~25% headroom under the context window', () => {
  expect(historyBudget(16384)).toBe(12288); // 75% of 16k
  expect(historyBudget(100)).toBe(512);     // floor for tiny windows
});

test('contextBar renders a proportional ccstatusline-style usage bar vs the window', () => {
  const s = contextBar(4000, 16000, 20); // 25%
  expect(s).toContain('4.0k/16.0k');
  expect(s).toContain('(25%)');
  expect(s).toContain('█'.repeat(5)); // 25% of width 20 = 5 filled
  expect(s).toContain('░');
});

test('usedTokens counts the system prompt plus history', () => {
  expect(usedTokens([])).toBeGreaterThan(0); // system prompt baseline
  expect(usedTokens([{ role: 'user', content: 'a'.repeat(40) }])).toBe(usedTokens([]) + 10);
});
