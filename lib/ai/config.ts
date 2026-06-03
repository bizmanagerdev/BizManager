// Anthropic (Claude) configuration, resolved from the environment — mirrors the
// lib/morning/config.ts pattern. Used by the credit-card statement PDF parser as the
// fallback when local pdfjs extraction is low-confidence.

export type AnthropicConfig = {
  apiKey: string;
  model: string;
};

// True when an API key is present, so the UI can hide/disable the "smart extraction"
// option when the server isn't configured for it.
export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function resolveAnthropicConfig(): AnthropicConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("הגדרת Anthropic חסרה בשרת (ANTHROPIC_API_KEY).");
  }
  // Defaults to the most capable model; override with ANTHROPIC_MODEL (e.g. claude-sonnet-4-6
  // for lower cost) without a code change.
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-8";
  return { apiKey, model };
}
