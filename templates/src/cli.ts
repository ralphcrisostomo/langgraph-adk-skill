import chalk from 'chalk';
import { actions } from './actions';
import { loadConfig } from './config';
import { createModel } from './llm';
import { resolveContextWindow } from './model-info';
import { selectAction, resolveParams } from './params';
import type { Ctx } from './actions/_types';

export async function runCli(argv: Record<string, unknown>): Promise<void> {
  // --list: print actions and exit (non-interactive; no model needed)
  if (argv.list) {
    for (const a of actions) console.log(`${chalk.bold(a.name)} — ${a.description}`);
    return;
  }

  const config = loadConfig();
  const llm = createModel(config);
  const contextWindow = await resolveContextWindow(config);
  const getDocs = async (_query: string): Promise<string> => {
    throw new Error('getDocs is a wiring point — connect context7 here');
  };
  const ctx: Ctx = { llm, log: chalk, getDocs, contextWindow };

  try {
    const action = await selectAction(actions, argv);
    const values = await resolveParams(action.params, argv);
    await action.run(values, ctx);
  } catch (err) {
    // Ctrl+C at an Ink prompt surfaces as ExitPromptError — quit quietly.
    if (err instanceof Error && err.name === 'ExitPromptError') {
      console.log(chalk.dim('Quit.'));
      return;
    }
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    if (typeof argv.action === 'string') process.exitCode = 1;
  }
}
