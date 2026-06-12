import { resolve } from 'node:path';

export type Provider = 'local' | 'openai' | 'anthropic';

export interface Config {
  provider: Provider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  promptLabel: string; // session prompt label, e.g. "you" -> "you › "
  cwd: string; // absolute working dir actions run in (CWD env, default "." = launch dir)
}

const PROVIDERS: readonly Provider[] = ['local', 'openai', 'anthropic'];

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const provider = (env.LLM_PROVIDER ?? 'local') as Provider;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Invalid LLM_PROVIDER: ${provider} (expected ${PROVIDERS.join(' | ')})`);
  }
  const model = env.LLM_MODEL ?? 'google/gemma-4-26B-A4B-it';
  const baseUrl = env.LLM_BASE_URL ?? (provider === 'local' ? 'http://localhost:8000/v1' : undefined);
  const apiKey = env.LLM_API_KEY ?? (provider === 'local' ? 'not-needed' : undefined);
  const promptLabel = env.PROMPT_LABEL?.trim() || 'you';
  // Working dir actions run in; relative values resolve from the launch dir. Defaults
  // to "." (no change) — set CWD to point actions at a different directory.
  const cwd = resolve(env.CWD?.trim() || '.');
  return { provider, model, baseUrl, apiKey, promptLabel, cwd };
}
