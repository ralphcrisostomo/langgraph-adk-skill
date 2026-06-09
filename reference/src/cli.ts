import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { actions } from './actions';
import { loadConfig } from './config';
import { createModel } from './llm';
import { selectAction, resolveParams, type PromptFn } from './params';
import type { Ctx } from './actions/_types';

const prompt: PromptFn = (questions) => inquirer.prompt(questions as any) as Promise<Record<string, unknown>>;

export async function runCli(argv: Record<string, unknown>): Promise<void> {
  // --list: print actions and exit (non-interactive; no model needed)
  if (argv.list) {
    for (const a of actions) console.log(`${chalk.bold(a.name)} — ${a.description}`);
    return;
  }

  const config = loadConfig();
  const llm = createModel(config);
  const spinner = ora();
  const getDocs = async (_query: string): Promise<string> => {
    throw new Error('getDocs is a wiring point — connect context7 here');
  };
  const ctx: Ctx = { llm, log: chalk, spinner, getDocs };

  const action = await selectAction(actions, argv, prompt);
  const values = await resolveParams(action.params, argv, prompt);

  try {
    await action.run(values, ctx);
  } catch (err) {
    spinner.fail(chalk.red(err instanceof Error ? err.message : String(err)));
    if (typeof argv.action === 'string') process.exitCode = 1;
  }
}
