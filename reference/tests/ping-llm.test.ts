import { test, expect } from 'bun:test';
import { pingLlm } from '../src/actions/ping-llm';
import type { Ctx } from '../src/actions/_types';

test('ping-llm prints the model reply', async () => {
  const out: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => out.push(a.map(String).join(' '));
  const spinner: any = { start: () => spinner, succeed: () => spinner, fail: () => spinner, stopAndPersist: () => spinner, text: '' };
  const ctx = {
    llm: { invoke: async () => ({ content: 'hello there' }) } as any,
    log: Object.assign((s: string) => s, { cyan: (s: string) => s, green: (s: string) => s, bold: (s: string) => s }) as any,
    spinner,
    getDocs: async () => '',
  } as Ctx;
  try {
    await pingLlm.run({ prompt: 'hi' }, ctx);
  } finally {
    console.log = orig;
  }
  expect(out.join('\n')).toContain('hello there');
});

test('ping-llm declares a prompt param', () => {
  expect(pingLlm.params.map((p) => p.name)).toContain('prompt');
});
