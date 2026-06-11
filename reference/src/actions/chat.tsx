import type { Action } from './_types';
import { render } from 'ink';
import { SessionApp } from '../ink/SessionApp';
import { systemMessage, type ChatMsg } from '../session-core';

export const chat: Action = {
  name: 'chat',
  description: 'Interactive chat session with the model',
  params: [],
  run: async (_values, ctx) => {
    if (!process.stdout.isTTY) {
      console.log(ctx.log.yellow('chat needs an interactive terminal (TTY).'));
      return;
    }

    const respond = async (messages: ChatMsg[]) => {
      const res = await ctx.llm.invoke([systemMessage(), ...messages] as never);
      return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    };

    const app = render(
      <SessionApp contextWindow={ctx.contextWindow} model={ctx.model} respond={respond} promptLabel="you" />,
    );
    await app.waitUntilExit();
  },
};
