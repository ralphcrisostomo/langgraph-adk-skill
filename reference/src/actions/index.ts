import type { Action } from './_types';
import { chat } from './chat';
import { assistant } from './assistant';

// Registry: the skill appends new actions here when adding one.
export const actions: Action[] = [chat, assistant];
