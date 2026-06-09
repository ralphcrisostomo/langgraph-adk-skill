import type { Action } from './_types';
import { render } from 'ink';
import minimist from 'minimist';
import { SessionApp } from '../ink/SessionApp';
import { withSpinner } from '../ui';
import { SYSTEM, type ChatMsg } from '../session-core';

// Returns the one-shot input when `--input "…"` was supplied, otherwise undefined
// (which means: run as an interactive session). Exported so it can be unit-tested.
export function oneShotInput(argv: Record<string, unknown>): string | undefined {
  return typeof argv.input === 'string' && argv.input.trim() ? String(argv.input) : undefined;
}

// Reference "both" turn-shape action on the Ink runtime: one-shot when --input is
// supplied, otherwise an interactive Ink session with a pinned context footer.
export const assistant: Action = {
  name: 'assistant',
  description: 'Ask the model: pass --input "…" for a one-shot answer, or run with no input for an interactive Ink session (Ctrl+C or /exit to quit)',
  params: [], // mode is chosen at runtime: --input -> one-shot, otherwise session
  run: async (_values, ctx) => {
    const ask = async (messages: ChatMsg[]) => {
      const res = await ctx.llm.invoke([SYSTEM, ...messages] as never);
      return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    };

    const oneShot = oneShotInput(minimist(process.argv.slice(2)));
    if (oneShot !== undefined) {
      const text = await withSpinner('thinking…', () => ask([{ role: 'user', content: oneShot }]));
      console.log(text ? ctx.log.bold(text) : ctx.log.dim('(no reply)'));
      return;
    }

    if (!process.stdout.isTTY) {
      console.log(ctx.log.yellow('assistant session needs a TTY. Use --input "…" for a one-shot answer.'));
      return;
    }

    const app = render(
      <SessionApp contextWindow={ctx.contextWindow} respond={(messages) => ask(messages)} promptLabel="you" />,
    );
    await app.waitUntilExit();
  },
};
