import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Ora } from 'ora';
import type { ChalkInstance } from 'chalk';

export interface ParamDef {
  name: string;
  message: string;                 // inquirer prompt text
  type?: 'input' | 'number' | 'confirm' | 'select';
  choices?: unknown[];
  required?: boolean;
  default?: unknown;
  validate?: (value: unknown) => true | string;
}

export interface Ctx {
  llm: BaseChatModel;
  log: ChalkInstance;
  spinner: Ora;
  getDocs: (query: string) => Promise<string>;
}

export interface Action {
  name: string;
  description: string;
  params: ParamDef[];
  run(values: Record<string, unknown>, ctx: Ctx): Promise<void>;
}
