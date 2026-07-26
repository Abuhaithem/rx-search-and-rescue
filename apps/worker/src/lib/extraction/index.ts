/**
 * Extraction provider factory. Selection + models come from env:
 *   EXTRACTION_PROVIDER          anthropic | openai | gemini (default anthropic)
 *   EXTRACTION_MODEL             per-provider default when unset
 *   EXTRACTION_ESCALATION_MODEL  per-provider default when unset; "" disables
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY
 * Called from createJobDeps() at job time — a missing key fails the job with
 * a clear error, never the worker process at import time.
 *
 * DeepSeek was evaluated as a fourth provider and ruled out: no BAA is
 * available, so PHI (client names + medication lists) cannot be sent there.
 * Do not add it without re-checking the compliance position.
 */
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createOpenAIProvider } from "./openai";
import type { ExtractionProvider, ExtractionProviderName } from "./types";

export * from "./types";
export {
  formularyLegendExtractionSchema,
  pharmacyDirectoryExtractionSchema,
} from "./schemas";
export { createAnthropicProvider } from "./anthropic";
export { createOpenAIProvider } from "./openai";
export { createGeminiProvider } from "./gemini";

const PROVIDER_NAMES: ExtractionProviderName[] = ["anthropic", "openai", "gemini"];

function requireKey(
  env: NodeJS.ProcessEnv,
  key: string,
  provider: ExtractionProviderName,
): string {
  const value = env[key];
  if (!value) {
    throw new Error(
      `EXTRACTION_PROVIDER is "${provider}" but ${key} is not set — add it to the worker environment`,
    );
  }
  return value;
}

export function getExtractionProvider(
  env: NodeJS.ProcessEnv = process.env,
): ExtractionProvider {
  const name = (env.EXTRACTION_PROVIDER ?? "anthropic") as ExtractionProviderName;
  if (!PROVIDER_NAMES.includes(name)) {
    throw new Error(
      `Unknown EXTRACTION_PROVIDER "${name}" (expected ${PROVIDER_NAMES.join(" | ")})`,
    );
  }

  const model = env.EXTRACTION_MODEL || undefined;
  // Unset → provider default; empty string → escalation disabled.
  const escalationRaw = env.EXTRACTION_ESCALATION_MODEL;
  const escalationModel =
    escalationRaw === undefined ? undefined : escalationRaw || null;

  switch (name) {
    case "anthropic":
      requireKey(env, "ANTHROPIC_API_KEY", name);
      return createAnthropicProvider({ model, escalationModel });
    case "openai":
      return createOpenAIProvider({
        apiKey: requireKey(env, "OPENAI_API_KEY", name),
        model,
        escalationModel: escalationModel ?? null,
      });
    case "gemini":
      return createGeminiProvider({
        apiKey: requireKey(env, "GEMINI_API_KEY", name),
        model,
        escalationModel,
      });
  }
}
