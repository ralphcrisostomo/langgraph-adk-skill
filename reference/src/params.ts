import type { Action, ParamDef } from './actions/_types';

export interface PromptQuestion {
  type: string;
  name: string;
  message: string;
  choices?: unknown[];
  default?: unknown;
  validate?: (value: unknown) => true | string;
}

export type PromptFn = (questions: PromptQuestion[]) => Promise<Record<string, unknown>>;

function coerce(value: unknown, type: ParamDef['type']): unknown {
  if (type === 'number') return Number(value);
  if (type === 'confirm') return value === true || value === 'true';
  return value;
}

function toQuestion(def: ParamDef): PromptQuestion {
  return {
    type: def.type ?? 'input',
    name: def.name,
    message: def.message,
    choices: def.choices,
    default: def.default,
    validate: (value: unknown) => {
      if (def.required && (value === undefined || value === '' || value === null)) {
        return `${def.name} is required`;
      }
      return def.validate ? def.validate(coerce(value, def.type)) : true;
    },
  };
}

export async function resolveParams(
  defs: ParamDef[],
  flags: Record<string, unknown>,
  prompt: PromptFn,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  const missing: ParamDef[] = [];

  for (const def of defs) {
    if (def.name in flags && flags[def.name] !== undefined) {
      const value = coerce(flags[def.name], def.type);
      if (def.type === 'number' && typeof value === 'number' && Number.isNaN(value)) {
        throw new Error(`Invalid --${def.name}: expected a number`);
      }
      if (def.required && (value === undefined || value === '' || value === null)) {
        throw new Error(`Missing required --${def.name}`);
      }
      if (def.validate) {
        const result = def.validate(value);
        if (result !== true) throw new Error(`Invalid --${def.name}: ${result}`);
      }
      resolved[def.name] = value;
    } else {
      missing.push(def);
    }
  }

  if (missing.length > 0) {
    const answers = await prompt(missing.map(toQuestion));
    // inquirer returns already-typed answers (number/boolean); flag values are strings and get coerced above
    Object.assign(resolved, answers);
  }
  return resolved;
}

export async function selectAction(
  actions: Action[],
  flags: Record<string, unknown>,
  prompt: PromptFn,
): Promise<Action> {
  // bare --action (no value) parses as boolean true -> falls through to the interactive menu
  if (typeof flags.action === 'string') {
    const found = actions.find((a) => a.name === flags.action);
    if (!found) throw new Error(`Unknown action: ${flags.action}`);
    return found;
  }
  const answer = await prompt([
    {
      type: 'select',
      name: 'action',
      message: 'Choose an action',
      choices: actions.map((a) => ({ name: `${a.name} — ${a.description}`, value: a.name })),
    },
  ]);
  return actions.find((a) => a.name === answer.action)!;
}
