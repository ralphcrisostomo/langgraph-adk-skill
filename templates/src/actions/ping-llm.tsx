import type { Action } from './_types';
import { render } from 'ink';
import { SessionApp } from '../ink/SessionApp';
import { SYSTEM, type ChatMsg } from '../session-core';

export const pingLlm: Action = {
  name: 'ping-llm',
  description: 'Interactive chat session with the configured model (Ink UI; Ctrl+C or /exit to quit; trims old turns to fit context)',
  params: [],
  run: async (_values, ctx) => {
    if (!process.stdout.isTTY) {
      console.log(ctx.log.yellow('ping-llm needs an interactive terminal (TTY).'));
      return;
    }

    const respond = async (messages: ChatMsg[]) => {
      const res = await ctx.llm.invoke([SYSTEM, ...messages] as never);
      return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    };

    const app = render(<SessionApp contextWindow={ctx.contextWindow} respond={respond} promptLabel="you" />);
    await app.waitUntilExit();
  },
};
