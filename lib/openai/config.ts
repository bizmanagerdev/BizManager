// OpenAI configuration, resolved from the environment — mirrors lib/ai/config.ts
// (Anthropic). Used for speech-to-text transcription (the mic / DictateButton),
// since Anthropic has no audio API. Routes audio through our own backend so it
// works even on filtered networks that block Google/Microsoft speech endpoints.

export type OpenAIConfig = {
  apiKey: string;
  transcribeModel: string;
  parseModel: string;
};

// True when an API key is present, so routes can return a clear "not configured"
// error instead of failing opaquely.
export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function resolveOpenAIConfig(): OpenAIConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error("הגדרת OpenAI חסרה בשרת (OPENAI_API_KEY).");
  }
  // Defaults to the current best transcription model; override with
  // OPENAI_TRANSCRIBE_MODEL (e.g. whisper-1) without a code change.
  const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "gpt-4o-transcribe";
  // Cheap, structured-output-capable model for field extraction (voice → task).
  const parseModel = process.env.OPENAI_PARSE_MODEL?.trim() || "gpt-4o-mini";
  return { apiKey, transcribeModel, parseModel };
}
