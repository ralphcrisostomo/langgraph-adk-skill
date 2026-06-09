import { test, expect } from 'bun:test';
import { resolveParams, selectAction, type PromptFn } from '../src/params';
import type { Action, ParamDef } from '../src/actions/_types';

const defs: ParamDef[] = [
  { name: 'title', message: 'Title', type: 'input', required: true },
  { name: 'count', message: 'Count', type: 'number', required: true },
];

test('uses flags when present and only prompts for missing params', async () => {
  const asked: ParamDef[] = [];
  const prompt: PromptFn = async (qs) => {
    for (const q of qs) asked.push(q as ParamDef);
    return { count: 5 };
  };
  const values = await resolveParams(defs, { title: 'Fix auth' }, prompt);
  expect(values).toEqual({ title: 'Fix auth', count: 5 });
  expect(asked.map((q) => q.name)).toEqual(['count']); // title came from flags
});

test('coerces numeric flags', async () => {
  const prompt: PromptFn = async () => ({});
  const values = await resolveParams(defs, { title: 't', count: '7' }, prompt);
  expect(values.count).toBe(7);
});

test('rejects an invalid flag value via validate', async () => {
  const guarded: ParamDef[] = [
    { name: 'n', message: 'N', type: 'number', validate: (v) => (Number(v) > 0 ? true : 'must be > 0') },
  ];
  const prompt: PromptFn = async () => ({});
  await expect(resolveParams(guarded, { n: '-1' }, prompt)).rejects.toThrow(/must be > 0/);
});

test('selectAction picks by --action flag', async () => {
  const actions = [{ name: 'a', description: '', params: [], run: async () => {} }] as Action[];
  const prompt: PromptFn = async () => ({ action: 'never' });
  const chosen = await selectAction(actions, { action: 'a' }, prompt);
  expect(chosen.name).toBe('a');
});

test('selectAction prompts a list when no flag', async () => {
  const actions = [
    { name: 'a', description: '', params: [], run: async () => {} },
    { name: 'b', description: '', params: [], run: async () => {} },
  ] as Action[];
  const prompt: PromptFn = async () => ({ action: 'b' });
  const chosen = await selectAction(actions, {}, prompt);
  expect(chosen.name).toBe('b');
});

test('selectAction throws on unknown --action', async () => {
  const actions = [{ name: 'a', description: '', params: [], run: async () => {} }] as Action[];
  const prompt: PromptFn = async () => ({});
  await expect(selectAction(actions, { action: 'zzz' }, prompt)).rejects.toThrow(/Unknown action/);
});

test('rejects a required param passed as an empty flag', async () => {
  const defs2 = [{ name: 'title', message: 'Title', type: 'input' as const, required: true }];
  const prompt: PromptFn = async () => ({});
  await expect(resolveParams(defs2, { title: '' }, prompt)).rejects.toThrow(/title/);
});

test('rejects a non-numeric value for a number param', async () => {
  const defs2 = [{ name: 'count', message: 'Count', type: 'number' as const }];
  const prompt: PromptFn = async () => ({});
  await expect(resolveParams(defs2, { count: 'abc' }, prompt)).rejects.toThrow(/count/);
});
