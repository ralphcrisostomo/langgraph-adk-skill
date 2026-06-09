import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChalkInstance } from 'chalk';

export interface ParamDef {
  name: string;
  message: string;                 // prompt message text
  type?: 'input' | 'number' | 'confirm' | 'select';
  choices?: unknown[];
  required?: boolean;
  default?: unknown;
  validate?: (value: unknown) => true | string;
}

export interface Ctx {
  llm: BaseChatModel;
  log: ChalkInstance;
  getDocs: (query: string) => Promise<string>;
  contextWindow: number; // model's real context window in tokens (resolved at startup)
}

export interface Action {
  name: string;
  description: string;
  params: ParamDef[];
  run(values: Record<string, unknown>, ctx: Ctx): Promise<void>;
}
