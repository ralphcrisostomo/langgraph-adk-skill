import { test, expect } from 'bun:test';
import { resolveParams, selectAction } from '../src/params';
import type { Action, ParamDef } from '../src/actions/_types';

const action = (name: string): Action => ({ name, description: name, params: [], run: async () => {} });

// Flag path only — when values come from flags, no Ink prompt is rendered.
test('resolveParams coerces and validates flag values without prompting', async () => {
  const defs: ParamDef[] = [
    { name: 'count', message: 'Count', type: 'number' },
    { name: 'yes', message: 'Yes?', type: 'confirm' },
    { name: 'name', message: 'Name', type: 'input' },
  ];
  const values = await resolveParams(defs, { count: '3', yes: 'true', name: 'ada' });
  expect(values).toEqual({ count: 3, yes: true, name: 'ada' });
});

test('resolveParams rejects a non-numeric number flag', async () => {
  const defs: ParamDef[] = [{ name: 'count', message: 'Count', type: 'number' }];
  await expect(resolveParams(defs, { count: 'abc' })).rejects.toThrow(/expected a number/);
});

test('resolveParams enforces required flags and validators', async () => {
  const req: ParamDef[] = [{ name: 'x', message: 'X', type: 'input', required: true }];
  await expect(resolveParams(req, { x: '' })).rejects.toThrow(/Missing required/);

  const val: ParamDef[] = [
    { name: 'x', message: 'X', type: 'input', validate: (v) => (v === 'ok' ? true : 'bad') },
  ];
  await expect(resolveParams(val, { x: 'nope' })).rejects.toThrow(/Invalid --x: bad/);
});

test('selectAction resolves a named action from --action without the menu', async () => {
  const actions = [action('a'), action('b')];
  expect((await selectAction(actions, { action: 'b' })).name).toBe('b');
  await expect(selectAction(actions, { action: 'zzz' })).rejects.toThrow(/Unknown action/);
});
