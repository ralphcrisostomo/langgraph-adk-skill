import type { Action } from './_types';
import inquirer from 'inquirer';

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

// Rough token estimate (~4 chars/token) — good enough to decide when to trim.
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

// Keep the most recent turns whose combined estimate fits `maxTokens`, dropping the
// oldest first. Never drops the latest message (the current question), even if it
// alone exceeds the budget.
export function trimHistory(
  history: ChatMsg[],
  maxTokens: number,
): { kept: ChatMsg[]; dropped: number } {
  const kept = [...history];
  let total = kept.reduce((n, m) => n + estimateTokens(m.content), 0);
  let dropped = 0;
  while (total > maxTokens && kept.length > 1) {
    total -= estimateTokens(kept[0]!.content);
    kept.shift();
    dropped++;
  }
  return { kept, dropped };
}

// Compact token count for display (3200 -> "3.2k").
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ccstatusline-style usage bar, e.g. "Context: [█████░░░░░] 2.0k/8.0k (25%)".
// `max` is the history token budget — when usage hits ~100%, oldest turns are trimmed.
export function contextBar(used: number, max: number, width = 20): string {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const filled = Math.round(ratio * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `Context: [${bar}] ${fmtTokens(used)}/${fmtTokens(max)} (${Math.round(ratio * 100)}%)`;
}

const SYSTEM: ChatMsg = { role: 'system', content: 'You are a helpful, concise assistant.' };
const MAX_HISTORY_TOKENS = Number(process.env.PING_MAX_HISTORY_TOKENS ?? 8000);
const QUIT_WORDS = new Set(['/exit', '/quit', 'exit', 'quit']);

// I/O seam so the loop is testable without inquirer or a live model.
export interface SessionIO {
  ask: () => Promise<string>;                       // user input; throws ExitPromptError on Ctrl+C
  invoke: (messages: ChatMsg[]) => Promise<string>; // model call -> reply text
  onReply: (text: string) => void;
  onInfo: (text: string) => void;
  onError: (text: string) => void;
  onContext?: (used: number, max: number) => void;  // optional usage indicator, per turn
}

// Drives a multi-turn chat session, trimming old turns to stay under `maxTokens`.
// Returns when the user quits (Ctrl+C -> ExitPromptError, or a /exit word).
export async function runSession(io: SessionIO, maxTokens: number): Promise<ChatMsg[]> {
  const history: ChatMsg[] = [];
  const usedTokens = () =>
    history.reduce((n, m) => n + estimateTokens(m.content), estimateTokens(SYSTEM.content));

  while (true) {
    let userText: string;
    try {
      userText = (await io.ask()).trim();
    } catch (err) {
      if (err instanceof Error && err.name === 'ExitPromptError') break;
      throw err;
    }

    if (!userText) continue;
    if (QUIT_WORDS.has(userText.toLowerCase())) break;

    history.push({ role: 'user', content: userText });

    // Drop the oldest turns when the conversation outgrows the context budget.
    const { kept, dropped } = trimHistory(history, maxTokens);
    if (dropped > 0) {
      history.splice(0, history.length, ...kept);
      io.onInfo(`…context full: dropped ${dropped} older message(s)`);
    }

    try {
      const reply = await io.invoke([SYSTEM, ...history]);
      history.push({ role: 'assistant', content: reply });
      io.onReply(reply);
    } catch (err) {
      io.onError(err instanceof Error ? err.message : String(err));
      history.pop(); // drop the user message whose call failed so we can retry cleanly
    }

    io.onContext?.(usedTokens(), maxTokens);
  }

  return history;
}

// Renders the context usage bar, colored by how full the window is.
function logContext(ctx: { log: any }, used: number, max: number): void {
  const ratio = max > 0 ? used / max : 0;
  const color = ratio < 0.7 ? ctx.log.green : ratio < 0.9 ? ctx.log.yellow : ctx.log.red;
  console.log(color(contextBar(used, max)));
}

export const pingLlm: Action = {
  name: 'ping-llm',
  description: 'Interactive chat session with the configured model (Ctrl+C or /exit to quit; trims old turns to fit context)',
  params: [],
  run: async (_values, ctx) => {
    console.log(ctx.log.dim('Chat session started — type a message, /exit or Ctrl+C to quit.'));

    const io: SessionIO = {
      ask: async () => {
        const ans = await inquirer.prompt([
          { type: 'input', name: 'q', message: ctx.log.cyan('you ›') },
        ]);
        return String(ans.q ?? '');
      },
      invoke: async (messages) => {
        ctx.spinner.start(ctx.log.cyan('thinking…'));
        try {
          const res = await ctx.llm.invoke(messages as any);
          return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
        } finally {
          ctx.spinner.stop();
        }
      },
      onReply: (text) => console.log(`${ctx.log.bold('assistant ›')} ${text}\n`),
      onInfo: (text) => console.log(ctx.log.dim(`  ${text}`)),
      onError: (text) => console.log(ctx.log.red(`model error: ${text}`)),
      onContext: (used, max) => logContext(ctx, used, max),
    };

    await runSession(io, MAX_HISTORY_TOKENS);
    console.log(ctx.log.dim('Session ended. 👋'));
  },
};
