import { test, expect } from 'bun:test';
import { assistant, oneShotInput } from '../src/actions/assistant';

test('assistant is a parameterless "both"-mode action', () => {
  expect(assistant.name).toBe('assistant');
  expect(assistant.params).toHaveLength(0); // no auto-prompt, so "no input" -> session
});

test('oneShotInput selects one-shot only when --input carries text', () => {
  expect(oneShotInput({ input: 'who am I' })).toBe('who am I');
  expect(oneShotInput({ input: '   ' })).toBeUndefined(); // blank -> session
  expect(oneShotInput({ input: true })).toBeUndefined();  // bare --input flag -> session
  expect(oneShotInput({})).toBeUndefined();               // no flag -> session
});
