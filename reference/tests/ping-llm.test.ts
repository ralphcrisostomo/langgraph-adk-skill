import { test, expect } from 'bun:test';
import { pingLlm, trimHistory, estimateTokens, runSession, contextBar, historyBudget, type ChatMsg, type SessionIO } from '../src/actions/ping-llm';

test('ping-llm is a parameterless interactive session action', () => {
  expect(pingLlm.name).toBe('ping-llm');
  expect(pingLlm.params).toHaveLength(0);
});

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
    { role: 'assistant', content: 'w'.repeat(40) }, // newest
  ];
  const { kept, dropped } = trimHistory(history, 120);
  expect(dropped).toBeGreaterThan(0);
  const total = kept.reduce((n, m) => n + estimateTokens(m.content), 0);
  expect(total).toBeLessThanOrEqual(120);
  expect(kept.at(-1)!.content).toBe('w'.repeat(40));
  expect(history).toHaveLength(4); // pure: original untouched
});

test('trimHistory keeps the latest message even if it alone exceeds the budget', () => {
  const { kept, dropped } = trimHistory([{ role: 'user', content: 'q'.repeat(1000) }], 10);
  expect(dropped).toBe(0);
  expect(kept).toHaveLength(1);
});

// Scripted I/O: feeds `lines` in order, then either Ctrl+C (ExitPromptError) or /exit.
function scriptedIO(lines: string[], ctrlCAfter = false) {
  const replies: string[] = [];
  const infos: string[] = [];
  const invoked: ChatMsg[][] = [];
  const contexts: Array<[number, number]> = [];
  let i = 0;
  const io: SessionIO = {
    ask: async () => {
      if (i < lines.length) return lines[i++]!;
      if (ctrlCAfter) {
        const e = new Error('User force closed the prompt with SIGINT');
        e.name = 'ExitPromptError';
        throw e;
      }
      return '/exit';
    },
    invoke: async (msgs) => {
      invoked.push(msgs);
      return `echo:${msgs.at(-1)!.content}`;
    },
    onReply: (t) => replies.push(t),
    onInfo: (t) => infos.push(t),
    onError: () => {},
    onContext: (used, max) => contexts.push([used, max]),
  };
  return { io, replies, infos, invoked, contexts };
}

test('contextBar renders a proportional ccstatusline-style usage bar', () => {
  const s = contextBar(2000, 8000, 20); // 25%
  expect(s).toContain('2.0k/8.0k');
  expect(s).toContain('(25%)');
  expect(s).toContain('█'.repeat(5));   // 25% of width 20 = 5 filled
  expect(s).toContain('░');             // and some empty
});

test('runSession reports context usage after each turn (used grows, max fixed)', async () => {
  const { io, contexts } = scriptedIO(['hello', 'again'], true);
  await runSession(io, 9999);
  expect(contexts).toHaveLength(2);
  expect(contexts.every(([, max]) => max === 9999)).toBe(true);
  expect(contexts[1]![0]).toBeGreaterThan(contexts[0]![0]);
});

test('historyBudget reserves ~25% headroom under the context window', () => {
  expect(historyBudget(16384)).toBe(12288); // 75% of 16k
  expect(historyBudget(100)).toBe(512);     // floor for tiny windows
});

test('runSession reports usage against the context window, not the trim budget', async () => {
  const { io, contexts } = scriptedIO(['hello', 'again'], true);
  await runSession(io, 1000, 16000); // trim budget 1000, real window 16000
  expect(contexts.every(([, max]) => max === 16000)).toBe(true);
});

test('runSession runs multiple turns and feeds full history back to the model', async () => {
  const { io, replies, invoked } = scriptedIO(['hello', 'again'], true);
  const history = await runSession(io, 100_000);

  expect(replies).toEqual(['echo:hello', 'echo:again']);
  expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(invoked[1]!.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
});

test('runSession quits on Ctrl+C (ExitPromptError) without throwing', async () => {
  const { io, replies } = scriptedIO([], true);
  await expect(runSession(io, 100_000)).resolves.toBeDefined();
  expect(replies).toEqual([]);
});

test('runSession quits on /exit and skips blank input', async () => {
  const { io, replies } = scriptedIO(['', '   ', 'hi', '/exit']);
  await runSession(io, 100_000);
  expect(replies).toEqual(['echo:hi']);
});

test('runSession trims and reports when the conversation outgrows the budget', async () => {
  const { io, infos } = scriptedIO(['x'.repeat(400), 'y'.repeat(400), 'z'.repeat(40)], true);
  await runSession(io, 120);
  expect(infos.some((s) => /dropped \d+ older/.test(s))).toBe(true);
});
