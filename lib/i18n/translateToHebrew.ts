import { resolveOpenAIConfig, isOpenAIConfigured } from "@/lib/openai/config";

async function translate(text: string, systemPrompt: string, label: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed || !isOpenAIConfigured()) return null;

  try {
    const { apiKey, parseModel } = resolveOpenAIConfig();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: parseModel,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: trimmed },
        ],
      }),
      // This is awaited directly on the dashboard's render path for an
      // Arabic-locale viewer (today's alerts) with no fallback timer of its
      // own — an unbounded hang here would hang the whole page. A bounded
      // timeout keeps the "best-effort, never block" contract this module
      // documents true for SLOWNESS, not just outright failure.
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error(`[${label}] OpenAI error`, res.status, await res.text().catch(() => ""));
      return null;
    }

    const data = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim() ? content.trim() : null;
  } catch (err) {
    console.error(`[${label}] failed`, err);
    return null;
  }
}

// Translates worker-authored Arabic free text (task subject/description,
// comments, attendance notes) to Hebrew so office/admin — who never see
// Arabic — can read it. Same OpenAI call pattern as app/api/tasks/parse-voice.
//
// Best-effort by design: this must never block or fail the caller's save, so
// any problem (missing key, network, empty text) just returns null and the
// caller skips setting the `*_he` column. The read side always falls back to
// the original text when `*_he` is null.
export async function translateToHebrew(text: string): Promise<string | null> {
  return translate(
    text,
    "Translate the given Arabic text into Hebrew. Return only the translated text, with no quotes, labels, or commentary.",
    "translateToHebrew"
  );
}

// The reverse direction: computed, Hebrew-only server text (e.g. system alert
// banners built from live data, not stored per-locale) translated on the fly
// for an Arabic-locale worker. Best-effort — on any failure the caller should
// fall back to showing the original Hebrew rather than blocking the page.
export async function translateToArabic(text: string): Promise<string | null> {
  return translate(
    text,
    "Translate the given Hebrew text into Arabic. Return only the translated text, with no quotes, labels, or commentary.",
    "translateToArabic"
  );
}
