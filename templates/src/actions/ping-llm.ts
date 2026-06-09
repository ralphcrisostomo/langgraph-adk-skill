import type { Action } from './_types';

export const pingLlm: Action = {
  name: 'ping-llm',
  description: 'Send a one-line prompt to the configured model and print the reply',
  params: [
    {
      name: 'prompt',
      message: 'Prompt to send',
      type: 'input',
      required: true,
      default: 'Say hello in one short sentence.',
    },
  ],
  run: async (values, ctx) => {
    ctx.spinner.start(ctx.log.cyan('Calling model…'));
    const res = await ctx.llm.invoke(String(values.prompt));
    ctx.spinner.succeed(ctx.log.green('Model responded'));
    const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    console.log(ctx.log.bold(content));
  },
};
