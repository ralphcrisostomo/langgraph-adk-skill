import { test, expect } from 'bun:test';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { createModel } from '../src/llm';

test('local + openai providers build a ChatOpenAI', () => {
  const local = createModel({ provider: 'local', model: 'm', baseUrl: 'http://x/v1', apiKey: 'not-needed', promptLabel: 'you', cwd: '.' });
  expect(local).toBeInstanceOf(ChatOpenAI);
  const oa = createModel({ provider: 'openai', model: 'gpt-x', apiKey: 'sk-x', promptLabel: 'you', cwd: '.' });
  expect(oa).toBeInstanceOf(ChatOpenAI);
});

test('anthropic provider builds a ChatAnthropic', () => {
  const a = createModel({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-x', promptLabel: 'you', cwd: '.' });
  expect(a).toBeInstanceOf(ChatAnthropic);
});
