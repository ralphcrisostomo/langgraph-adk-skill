/** @jsxImportSource react */
// Pin React JSX so the CLI transpiles correctly when run as a global bin from any
// directory — Bun resolves jsxImportSource from the launch cwd's tsconfig otherwise.
import type { Action, Ctx } from './_types';
import { render } from 'ink';
import minimist from 'minimist';
import { createAgent } from 'langchain';
import { tool } from '@langchain/core/tools';
import * as z from 'zod';
import { SessionApp, type RespondHelpers } from '../ink/SessionApp';
import { askConfirm, askText } from '../ui';
import { printContextBar, type ChatMsg } from '../session-core';
import { streamAgent, stepText, type TraceLine } from '../trace';
import { tokenize } from './shell-tokens';
import { isApproval, isWriteCommand, stripManagedFlags } from './aws-cli-core';
import { assignsAwsEnv, containsRawAws, requestsDelete } from './bash-core';
import { formatResult, PROFILE, REGION, runAws, runBash } from './command-runtime';
import { buildSystemPrompt, loadRepoInstructions } from './repo-instructions';

// Per-turn seams the tools call into. They are bound to the run mode: an Ink
// session routes them through the persistent footer input; a one-shot run uses a
// transient Ink prompt on a TTY, or auto-denies/blanks when no human is present.
interface Seams {
  approve: (question: string) => Promise<boolean>;
  ask: (question: string) => Promise<string>;
}

function buildTools(seams: Seams) {
  const awsCli = tool(
    async function* (input: { command: string }) {
      const raw = (input.command ?? '').trim();
      if (!raw) return 'No AWS command provided.';
      yield { message: `aws ${raw}` };
      const args = stripManagedFlags(tokenize(raw));
      if (args.length === 0) return 'No AWS command provided.';
      if (isWriteCommand(args)) {
        const ok = await seams.approve(`Run AWS WRITE under profile ${PROFILE} (${REGION}):\n  aws ${args.join(' ')}\nProceed?`);
        if (!ok) return 'Write not approved — skipped. The command did NOT run; report it as skipped.';
      }
      return formatResult(await runAws(args));
    },
    {
      name: 'aws_cli',
      description:
        `Run an AWS CLI command, pinned to profile "${PROFILE}" and region "${REGION}" (you cannot change them). ` +
        'Provide the command WITHOUT the leading "aws", e.g. "s3 ls" or "ec2 describe-instances". ' +
        'Read-only commands run immediately; writes require human approval.',
      schema: z.object({ command: z.string().describe('AWS CLI command without the leading "aws"') }),
    },
  );

  const bash = tool(
    async function* (input: { command: string }) {
      const command = (input.command ?? '').trim();
      if (!command) return 'No command provided.';
      if (containsRawAws(command) || assignsAwsEnv(command)) {
        return 'Refused: use the aws_cli tool for AWS. bash cannot invoke aws or set AWS_* variables.';
      }
      yield { message: command.length > 60 ? `${command.slice(0, 57)}…` : command };
      if (requestsDelete(command)) {
        const ok = await seams.approve(`Run delete in the repo:\n  ${command}\nProceed?`);
        if (!ok) return 'Delete not approved — skipped. The command did NOT run; report it as skipped.';
      }
      return formatResult(await runBash(command));
    },
    {
      name: 'bash',
      description:
        'Run a shell command in the project working directory to inspect or edit repository files ' +
        '(search, read, build, git). Delete operations require human approval. ' +
        'AWS commands are NOT allowed here — use aws_cli.',
      schema: z.object({ command: z.string().describe('Shell command to run from the repo root') }),
    },
  );

  const queryUser = tool(
    async (input: { question: string }) => {
      const q = (input.question ?? '').trim();
      if (!q) return 'No question provided.';
      const answer = await seams.ask(q);
      return answer.trim() ? answer : '(no answer given)';
    },
    {
      name: 'query_user',
      description:
        'Ask the human a clarifying question and wait for their typed answer. ' +
        'Use when the request is ambiguous or you need a decision before acting.',
      schema: z.object({ question: z.string().describe('The question to ask the human') }),
    },
  );

  return [awsCli, bash, queryUser];
}

// Build a fresh agent per turn so the system prompt picks up the current AGENTS.md
// and date/time, and so each turn binds its own approval seams.
async function buildAgent(ctx: Ctx, seams: Seams) {
  const repoInstructions = await loadRepoInstructions();
  return createAgent({
    model: ctx.llm,
    tools: buildTools(seams),
    systemPrompt: buildSystemPrompt(repoInstructions),
  });
}

// Pull the final assistant text out of the last streamed update chunk.
function extractFinalText(result: unknown): string {
  const lastChunk = (result ?? {}) as Record<string, unknown>;
  const state = Array.isArray((lastChunk as { messages?: unknown }).messages)
    ? lastChunk
    : Object.values(lastChunk).find((v) => v && Array.isArray((v as { messages?: unknown }).messages)) ?? {};
  const messages = ((state as { messages?: unknown[] }).messages ?? []) as Array<{ content?: unknown }>;
  const final = messages[messages.length - 1]?.content ?? '';
  return typeof final === 'string' ? final : JSON.stringify(final);
}

// One-shot when `--input "…"` carries text, otherwise an interactive session.
export function oneShotInput(argv: Record<string, unknown>): string | undefined {
  return typeof argv.input === 'string' && argv.input.trim() ? String(argv.input) : undefined;
}

export const chat: Action = {
  name: 'chat',
  description: `Chat to drive AWS (profile ${PROFILE}) and the repo — one-shot with --input, else a session`,
  params: [], // mode is chosen at runtime: --input -> one-shot, otherwise session
  run: async (_values, ctx) => {
    const oneShot = oneShotInput(minimist(process.argv.slice(2)));

    if (oneShot !== undefined) {
      const tty = process.stdout.isTTY === true && process.stdin.isTTY === true;
      const seams: Seams = {
        // No human on a pipe/CI -> deny writes (reads still run); on a TTY, prompt.
        approve: tty ? (q) => askConfirm(q, 'cancel') : async () => false,
        ask: tty ? (q) => askText(q) : async () => '',
      };
      const agent = await buildAgent(ctx, seams);
      const result = await streamAgent(
        agent,
        { messages: [{ role: 'user', content: oneShot }] },
        (line: TraceLine) => console.log(ctx.log.dim(`  ${stepText(line)}`)),
      );
      const text = extractFinalText(result);
      console.log(text ? ctx.log.bold(text) : ctx.log.dim('(no reply)'));
      printContextBar(
        ctx.log,
        ctx.contextWindow,
        [
          { role: 'user', content: oneShot },
          { role: 'assistant', content: text },
        ],
        ctx.model,
      );
      return;
    }

    if (!process.stdout.isTTY) {
      console.log(ctx.log.yellow('chat session needs a TTY. Use --input "…" for a one-shot answer.'));
      return;
    }

    const respond = async (messages: ChatMsg[], helpers: RespondHelpers): Promise<string> => {
      const seams: Seams = {
        approve: (q) => helpers.ask(q).then(isApproval),
        ask: (q) => helpers.ask(q),
      };
      const agent = await buildAgent(ctx, seams);
      const result = await streamAgent(
        agent,
        { messages: messages.map((m) => ({ role: m.role, content: m.content })) },
        (line) => helpers.onStep(stepText(line)),
      );
      return extractFinalText(result);
    };

    const app = render(
      <SessionApp contextWindow={ctx.contextWindow} model={ctx.model} respond={respond} promptLabel={ctx.promptLabel} />,
    );
    await app.waitUntilExit();
  },
};
