import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Config } from './config';

export function createModel(config: Config): BaseChatModel {
  if (config.provider === 'anthropic') {
    return new ChatAnthropic({ model: config.model, apiKey: config.apiKey });
  }
  // local and openai are both OpenAI-compatible; local points configuration.baseURL at the endpoint
  return new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey ?? 'not-needed',
    configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
  });
}
