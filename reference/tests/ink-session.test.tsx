import { test, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { SessionApp } from '../src/ink/SessionApp';
import type { ChatMsg } from '../src/session-core';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('Ink SessionApp renders the pinned context bar and input prompt', () => {
  const respond = async () => 'hi';
  const { lastFrame, unmount } = render(<SessionApp contextWindow={16000} respond={respond} />);
  const frame = lastFrame() ?? '';
  try {
    expect(frame).toContain('Context: [');
    expect(frame).toContain('/16.0k');
    expect(frame).toContain('you ›');
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
    <SessionApp contextWindow={16000} respond={respond} promptLabel="you" />,
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
