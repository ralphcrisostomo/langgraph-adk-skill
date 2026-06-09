// Pure, React-free session helpers shared by the Ink session UI and actions.

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

export const SYSTEM: ChatMsg = { role: 'system', content: 'You are a helpful, concise assistant.' };

export const QUIT_WORDS = new Set(['/exit', '/quit', 'exit', 'quit']);

// Rough token estimate (~4 chars/token) — good enough to decide when to trim.
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

// Keep the most recent turns whose combined estimate fits `maxTokens`, dropping the
// oldest first. Never drops the latest message, even if it alone exceeds the budget.
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

// Reserve ~25% of the model's context window for the system prompt + the response;
// trim conversation history to the remaining ~75%.
export function historyBudget(contextWindow: number): number {
  return Math.max(512, Math.floor(contextWindow * 0.75));
}

// Compact token count for display (3200 -> "3.2k").
function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ccstatusline-style usage bar, e.g. "Context: [█████░░░░░] 4.0k/16.4k (25%)".
// `max` is the model's real context window (oldest turns are trimmed before it fills).
export function contextBar(used: number, max: number, width = 20): string {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const filled = Math.round(ratio * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `Context: [${bar}] ${fmtTokens(used)}/${fmtTokens(max)} (${Math.round(ratio * 100)}%)`;
}

// Tokens currently "loaded": system prompt + the conversation so far.
export function usedTokens(history: ChatMsg[]): number {
  return history.reduce((n, m) => n + estimateTokens(m.content), estimateTokens(SYSTEM.content));
}
