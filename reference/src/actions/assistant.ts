import type { Action } from './_types';
import { runSession, contextBar, type SessionIO, type ChatMsg } from './ping-llm';
import inquirer from 'inquirer';
import minimist from 'minimist';

const SYSTEM: ChatMsg = { role: 'system', content: 'You are a helpful, concise assistant.' };
const MAX_HISTORY_TOKENS = Number(process.env.ASSISTANT_MAX_HISTORY_TOKENS ?? 8000);

// Returns the one-shot input when `--input "…"` was supplied, otherwise undefined
// (which means: run as an interactive session). Exported so it can be unit-tested.
export function oneShotInput(argv: Record<string, unknown>): string | undefined {
  return typeof argv.input === 'string' && argv.input.trim() ? String(argv.input) : undefined;
}

// Reference "both" turn-shape action: one-shot when --input is supplied, otherwise
// an interactive session. The session path reuses runSession from ping-llm, so it
// inherits Ctrl+C / `/exit` quit and token-budget history trimming for free.
export const assistant: Action = {
  name: 'assistant',
  description: 'Ask the model: pass --input "…" for a one-shot answer, or run with no input for an interactive session (Ctrl+C or /exit to quit)',
  params: [], // mode is chosen at runtime: --input -> one-shot, otherwise session
  run: async (_values, ctx) => {
    // One turn = one model call over the running conversation.
    const ask = async (convo: ChatMsg[]): Promise<string> => {
      ctx.spinner.start(ctx.log.cyan('thinking…'));
      try {
        const res = await ctx.llm.invoke([SYSTEM, ...convo] as any);
        return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
      } finally {
        ctx.spinner.stop();
      }
    };

    const oneShot = oneShotInput(minimist(process.argv.slice(2)));

    if (oneShot !== undefined) {
      const text = await ask([{ role: 'user', content: oneShot }]);
      console.log(text ? ctx.log.bold(text) : ctx.log.dim('(no reply)'));
      return;
    }

    console.log(ctx.log.dim('Assistant session — ask anything. /exit or Ctrl+C to quit.'));
    const io: SessionIO = {
      ask: async () => {
        const ans = await inquirer.prompt([
          { type: 'input', name: 'q', message: ctx.log.cyan('you ›') },
        ]);
        return String(ans.q ?? '');
      },
      // runSession prepends its own generic system message; drop it (we add SYSTEM in ask()).
      invoke: async (messages) => ask(messages.filter((m) => m.role !== 'system')),
      onReply: (text) => console.log(`${ctx.log.bold('assistant ›')} ${text}\n`),
      onInfo: (text) => console.log(ctx.log.dim(`  ${text}`)),
      onError: (text) => console.log(ctx.log.red(`error: ${text}`)),
      onContext: (used, max) => {
        const ratio = max > 0 ? used / max : 0;
        const color = ratio < 0.7 ? ctx.log.green : ratio < 0.9 ? ctx.log.yellow : ctx.log.red;
        console.log(color(contextBar(used, max)));
      },
    };

    await runSession(io, MAX_HISTORY_TOKENS);
    console.log(ctx.log.dim('Session ended. 👋'));
  },
};
