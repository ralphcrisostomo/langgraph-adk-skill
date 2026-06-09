import type { Action, ParamDef } from './actions/_types';
import { askConfirm, askText, selectMenu } from './ui';

function coerce(value: unknown, type: ParamDef['type']): unknown {
  if (type === 'number') return Number(value);
  if (type === 'confirm') return value === true || value === 'true';
  return value;
}

// Prompt the user (via Ink) for a single missing parameter.
async function promptFor(def: ParamDef): Promise<unknown> {
  if (def.type === 'confirm') {
    return askConfirm(def.message, def.default === true ? 'confirm' : 'cancel');
  }
  if (def.type === 'select' && Array.isArray(def.choices)) {
    const options = def.choices.map((c) =>
      typeof c === 'object' && c !== null ? (c as { label: string; value: string }) : { label: String(c), value: String(c) },
    );
    return selectMenu(def.message, options);
  }
  const raw = await askText(def.message, {
    defaultValue: def.default != null ? String(def.default) : undefined,
  });
  return coerce(raw, def.type);
}

export async function resolveParams(
  defs: ParamDef[],
  flags: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

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
      resolved[def.name] = await promptFor(def);
    }
  }

  return resolved;
}

export async function selectAction(actions: Action[], flags: Record<string, unknown>): Promise<Action> {
  // bare --action (no value) parses as boolean true -> falls through to the menu
  if (typeof flags.action === 'string') {
    const found = actions.find((a) => a.name === flags.action);
    if (!found) throw new Error(`Unknown action: ${flags.action}`);
    return found;
  }
  const name = await selectMenu(
    'Choose an action',
    actions.map((a) => ({ label: `${a.name} — ${a.description}`, value: a.name })),
  );
  return actions.find((a) => a.name === name)!;
}
