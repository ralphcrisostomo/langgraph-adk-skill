import { test, expect } from 'bun:test';
import { formatEvent } from '../src/trace';

test('updates mode yields a node line from the first key', () => {
  expect(formatEvent('updates', { drafter: { messages: [] } })).toEqual({ kind: 'node', text: 'drafter' });
});

test('updates mode with empty object yields null', () => {
  expect(formatEvent('updates', {})).toBeNull();
});

test('tool lifecycle events map to kinds', () => {
  expect(formatEvent('tools', { event: 'on_tool_start', name: 'search', input: { q: 'x' } }))
    .toMatchObject({ kind: 'tool-start' });
  expect(formatEvent('tools', { event: 'on_tool_event', name: 'search', data: { message: 'half' } }))
    .toEqual({ kind: 'tool-event', text: 'half' });
  expect(formatEvent('tools', { event: 'on_tool_end', name: 'search' }))
    .toEqual({ kind: 'tool-end', text: 'search' });
  expect(formatEvent('tools', { event: 'on_tool_error', name: 'search' }))
    .toEqual({ kind: 'tool-error', text: 'search' });
});

test('unknown event yields null', () => {
  expect(formatEvent('tools', { event: 'on_tool_other' })).toBeNull();
});
