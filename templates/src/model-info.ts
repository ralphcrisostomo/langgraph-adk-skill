import type { Config } from './config';

// Sensible last-resort window if neither the endpoint nor env tells us anything.
export const DEFAULT_CONTEXT_TOKENS = 8192;

interface ModelsResponse {
  data?: Array<{ id?: string; max_model_len?: number; context_length?: number }>;
}

// Resolve the model's real context window (in tokens):
//   1. the live OpenAI-compatible endpoint (`/models` exposes `max_model_len`),
//   2. the MODEL_CONTEXT_TOKENS env var (fallback — e.g. for cloud providers),
//   3. DEFAULT_CONTEXT_TOKENS.
export async function resolveContextWindow(config: Config): Promise<number> {
  if (config.baseUrl) {
    try {
      const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`, {
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : undefined,
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const body = (await res.json()) as ModelsResponse;
        const entry = body.data?.find((m) => m.id === config.model) ?? body.data?.[0];
        const len = entry?.max_model_len ?? entry?.context_length;
        if (typeof len === 'number' && len > 0) return len;
      }
    } catch {
      // network/parse failure -> fall through to env / default
    }
  }

  const fromEnv = Number(process.env.MODEL_CONTEXT_TOKENS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;

  return DEFAULT_CONTEXT_TOKENS;
}
