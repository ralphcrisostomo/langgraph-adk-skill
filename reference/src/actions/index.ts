import type { Action } from './_types';
import { pingLlm } from './ping-llm';
import { assistant } from './assistant';

// Registry: the skill appends new actions here when adding one.
export const actions: Action[] = [pingLlm, assistant];
