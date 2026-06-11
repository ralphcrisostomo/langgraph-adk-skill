import { test, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { SessionApp } from '../src/ink/SessionApp';
import type { ChatMsg } from '../src/session-core';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('Ink SessionApp renders the model line, pinned context bar and input prompt', () => {
  const respond = async () => 'hi';
  const { lastFrame, unmount } = render(
    <SessionApp contextWindow={16000} model="acme/test-model" respond={respond} />,
  );
  const frame = lastFrame() ?? '';
  try {
    expect(frame).toContain('Model: acme/test-model');
    expect(frame).toContain('Context: [');
    expect(frame).toContain('/16.0k');
    expect(frame).toContain('you ›');
  } finally {
    unmount();
  }
});

test('Ink SessionApp /clear resets history without calling respond and drops the next turn back to a fresh history', async () => {
  const seen: ChatMsg[][] = [];
  const respond = async (messages: ChatMsg[]) => {
    seen.push([...messages]);
    return 'reply';
  };
  const { stdin, lastFrame, unmount } = render(
    <SessionApp contextWindow={16000} model="acme/test-model" respond={respond} promptLabel="you" />,
  );
  try {
    stdin.write('first');
    await delay(20);
    stdin.write('\r');
    await delay(60);
    expect(seen).toHaveLength(1); // one real turn so far

    stdin.write('/clear');
    await delay(20);
    stdin.write('\r');
    await delay(60);
    expect(seen).toHaveLength(1); // /clear never reaches respond
    expect(lastFrame() ?? '').toContain('context cleared');

    stdin.write('second');
    await delay(20);
    stdin.write('\r');
    await delay(60);
    expect(seen).toHaveLength(2);
    // history was wiped: the next turn carries only the new user message
    expect(seen[1]).toEqual([{ role: 'user', content: 'second' }]);
  } finally {
    unmount();
  }
});

test('Ink SessionApp resolves a mid-turn ask (approval prompt) when the human answers', async () => {
  // Regression: the footer used to swap between separate TextInput render branches,
  // so the approval input mounted mid-turn dropped keystrokes in a real TTY. With a
  // single persistent TextInput, helpers.ask must resolve with the typed answer.
  const answers: string[] = [];
  const respond = async (_m: ChatMsg[], helpers: { ask: (q: string) => Promise<string> }) => {
    const a = await helpers.ask('⚠ approve write? cmd [y/N]');
    answers.push(a);
    return `answered:${a}`;
  };
  const { stdin, lastFrame, unmount } = render(
    <SessionApp contextWindow={16000} model="acme/test-model" respond={respond} promptLabel="you" />,
  );
  try {
    stdin.write('go');
    await delay(20);
    stdin.write('\r'); // start the turn
    await delay(80);
    expect(lastFrame() ?? '').toContain('approve write?'); // pendingAsk shown
    stdin.write('y');
    await delay(20);
    stdin.write('\r'); // answer the approval
    await delay(100);
    expect(answers).toEqual(['y']);
    expect(lastFrame() ?? '').toContain('answered:y');
  } finally {
    unmount();
  }
});

test('Ink SessionApp runs a turn: shows the reply and updates the context bar', async () => {
  const seen: ChatMsg[][] = [];
  const respond = async (messages: ChatMsg[]) => {
    seen.push([...messages]);
    return 'four';
  };
  const { stdin, lastFrame, unmount } = render(
    <SessionApp contextWindow={16000} model="acme/test-model" respond={respond} promptLabel="you" />,
  );
  try {
    stdin.write('2+2?');
    await delay(20);
    stdin.write('\r'); // submit
    await delay(60);
    const frame = lastFrame() ?? '';
    expect(seen).toHaveLength(1);
    expect(seen[0]!.at(-1)).toEqual({ role: 'user', content: '2+2?' });
    expect(frame).toContain('assistant › four');
    expect(frame).toContain('Context: ['); // bar still pinned below history
  } finally {
    unmount();
  }
});
