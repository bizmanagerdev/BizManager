import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isOpenAIConfigured, resolveOpenAIConfig } from "@/lib/openai/config";
import { toHebrewError } from "@/lib/error-messages";

// Transcribe a short voice recording to Hebrew text. The browser records audio
// (MediaRecorder) and uploads it here; we forward it to OpenAI server-to-server.
// That keeps speech traffic off the user's device/network — so it works through
// content filters that block the browser's built-in (Google/Microsoft) speech.

export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024; // OpenAI's audio upload limit.

export async function POST(req: Request) {
  try {
    // Any signed-in app user (active + system access, not worker_no_access).
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    if (!isOpenAIConfigured()) {
      return NextResponse.json(
        { error: "תמלול קולי אינו מוגדר בשרת (חסר OPENAI_API_KEY)." },
        { status: 503 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "לא התקבלה הקלטה." }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "ההקלטה ריקה." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "ההקלטה ארוכה מדי." }, { status: 413 });
    }

    const langRaw = form.get("language");
    const language = typeof langRaw === "string" && langRaw.trim() ? langRaw.trim() : "he";

    // A short context hint biases spelling toward our Hebrew business vocabulary
    // (names, domains) — improves accuracy on domain words. Callers may override.
    const promptRaw = form.get("prompt");
    const prompt =
      typeof promptRaw === "string" && promptRaw.trim()
        ? promptRaw.trim()
        : "תמלול בעברית של הקלטה קצרה במערכת ניהול עסק: משימות, לקוחות, פרויקטים, נכסים, גבייה, הזמנות, תשלומים, צ׳קים, תאריכים ושעות.";

    const { apiKey, transcribeModel } = resolveOpenAIConfig();

    const upstream = new FormData();
    upstream.set("file", file, file.name || "audio.webm");
    upstream.set("model", transcribeModel);
    upstream.set("language", language);
    upstream.set("prompt", prompt);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[transcribe] OpenAI error", res.status, detail);
      return NextResponse.json({ error: "תמלול ההקלטה נכשל. נסו שוב." }, { status: 502 });
    }

    const json = (await res.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof json.text === "string" ? json.text.trim() : "";

    return NextResponse.json({ text });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "תמלול ההקלטה נכשל.") }, { status: 500 });
  }
}
