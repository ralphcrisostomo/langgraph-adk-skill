// The chat agent's persona + the per-turn system prompt. Repository guidance is
// loaded from a root AGENTS.md (when present) so the assistant follows project
// rules, and the live date/time is appended so it isn't guessing "now".
import { currentDateTime } from '../session-core';
import { PROFILE, REGION } from './command-runtime';

export const REPO_INSTRUCTIONS_FILE = 'AGENTS.md';

export const SYSTEM_PROMPT = [
  'You are the reference chat assistant. You help the user operate AWS and inspect/edit',
  'this repository through natural language, using your tools.',
  '',
  'Tools:',
  `- aws_cli: runs the AWS CLI, permanently pinned to profile "${PROFILE}" and region`,
  `  "${REGION}". You cannot change the profile, region, or endpoint. Pass the command`,
  '  WITHOUT the leading "aws" (e.g. "s3 ls", "ec2 describe-instances"). Read-only',
  '  commands run immediately; writes require explicit human approval.',
  '- bash: runs shell commands in the project working directory to search, read,',
  '  build, or edit repository files. Delete operations require human approval.',
  '  AWS is NOT available in bash (no credentials) — always use aws_cli for AWS.',
  '- query_user: ask the human a clarifying question when the request is ambiguous',
  '  or you need a decision before acting.',
  '',
  'Rules:',
  '- NEVER claim a write or delete happened unless the tool result confirms it ran.',
  '  If a tool returns "not approved — skipped", tell the user it was skipped.',
  '- Prefer read-only AWS commands to confirm state before proposing any write.',
  '- Be concise. Show the exact command you ran when it matters.',
].join('\n');

export async function loadRepoInstructions(cwd = process.cwd()): Promise<string | undefined> {
  const file = Bun.file(`${cwd}/${REPO_INSTRUCTIONS_FILE}`);
  if (!(await file.exists())) return undefined;
  const text = (await file.text()).trim();
  return text || undefined;
}

export function buildSystemPrompt(repoInstructions: string | undefined, now = new Date()): string {
  const sections = [SYSTEM_PROMPT];
  if (repoInstructions) {
    sections.push([`Repository instructions from ${REPO_INSTRUCTIONS_FILE}:`, '```md', repoInstructions, '```'].join('\n'));
  }
  sections.push(`Current date and time: ${currentDateTime(now)}`);
  return sections.join('\n\n');
}
