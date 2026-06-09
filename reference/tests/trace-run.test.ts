import { test, expect } from 'bun:test';
import { runGraphVerbose } from '../src/trace';

function fakeGraph(events: Array<[string, any]>) {
  return {
    stream: async (_input: unknown, _opts: unknown) => ({
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e;
      },
    }),
  };
}

test('runGraphVerbose drives the spinner across tool events and returns the last update', async () => {
  const calls: string[] = [];
  const spinner: any = {
    text: '',
    start: (t: string) => { calls.push(`start:${t ?? ''}`); return spinner; },
    succeed: (t: string) => { calls.push(`succeed:${t ?? ''}`); return spinner; },
    fail: (t: string) => { calls.push(`fail:${t ?? ''}`); return spinner; },
    stopAndPersist: (o: any) => { calls.push(`persist:${o?.text ?? ''}`); return spinner; },
  };
  const graph = fakeGraph([
    ['updates', { planner: { step: 1 } }],
    ['tools', { event: 'on_tool_start', name: 'search', input: { q: 'x' } }],
    ['tools', { event: 'on_tool_end', name: 'search' }],
    ['updates', { finisher: { step: 2 } }],
  ]);

  const last = await runGraphVerbose(graph as any, { messages: [] }, spinner);

  expect(calls.some((c) => c.startsWith('persist:'))).toBe(true);   // node lines persisted
  expect(calls.some((c) => c.startsWith('start:'))).toBe(true);     // tool-start
  expect(calls.some((c) => c.startsWith('succeed:'))).toBe(true);   // tool-end
  expect(last).toEqual({ finisher: { step: 2 } });                  // last updates chunk
});
