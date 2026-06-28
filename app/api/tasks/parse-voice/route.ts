import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { resolveOpenAIConfig, isOpenAIConfigured } from "@/lib/openai/config";

// Turn a spoken Hebrew task instruction (already transcribed) into structured
// task fields, so the create card can pre-fill itself. Uses OpenAI structured
// outputs (json_schema, strict) so we get a guaranteed shape back — same OpenAI
// key as transcription, no extra account.

export const maxDuration = 30;

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const SYSTEM_PROMPT = `אתה ממלא טופס "משימה חדשה" ממשפט שנאמר בעברית במערכת לניהול עסק.
חלץ מהתמלול את השדות הבאים. שדה שלא נאמר במפורש — החזר מחרוזת ריקה (priority ברירת מחדל "medium").
- subject: כותרת קצרה וברורה למשימה (חובה).
- description: פרטים נוספים אם נאמרו.
- due_date: אם נאמר מועד, כולל יחסי ("מחר", "מחרתיים", "יום ראשון הבא"), חשב אותו לפי התאריך והשעה הנוכחיים שיסופקו, והחזר בפורמט YYYY-MM-DD.
- due_time: שעה אם נאמרה, בפורמט 24 שעות HH:MM.
- priority: low / medium / high / urgent. "דחוף"/"בהול" => urgent. "חשוב" => high.
- business_domain: בחר את הקוד המתאים ביותר מתוך רשימת התחומים שתסופק (code => שם). אם אין התאמה — ריק.
- assigned_user_id: אם נאמר שם של אחראי, התאם אותו לאחד המשתמשים ברשימה (id => שם) והחזר את ה-id. אם אין התאמה ודאית — ריק.
- city: שם עיר אם נאמר.
החזר אך ורק את אובייקט ה-JSON עם השדות הללו.`;

const TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string", description: "כותרת קצרה למשימה" },
    description: { type: "string", description: "פרטים נוספים, או מחרוזת ריקה" },
    due_date: { type: "string", description: "YYYY-MM-DD או מחרוזת ריקה" },
    due_time: { type: "string", description: "HH:MM (24 שעות) או מחרוזת ריקה" },
    priority: { type: "string", enum: [...PRIORITIES] },
    business_domain: { type: "string", description: "קוד תחום מתוך הרשימה, או מחרוזת ריקה" },
    assigned_user_id: { type: "string", description: "מזהה המשתמש האחראי, או מחרוזת ריקה" },
    city: { type: "string", description: "עיר, או מחרוזת ריקה" },
  },
  required: [
    "subject",
    "description",
    "due_date",
    "due_time",
    "priority",
    "business_domain",
    "assigned_user_id",
    "city",
  ],
} as const;

type Option = { id?: unknown; label?: unknown; code?: unknown };

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    if (!isOpenAIConfigured()) {
      return NextResponse.json(
        { error: "מילוי חכם אינו מוגדר בשרת (חסר OPENAI_API_KEY)." },
        { status: 503 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      transcript?: unknown;
      users?: unknown;
      domains?: unknown;
      today?: unknown;
      nowLabel?: unknown;
    };

    const transcript = asString(body.transcript);
    if (!transcript) {
      return NextResponse.json({ error: "לא התקבל תמלול." }, { status: 400 });
    }

    const users = Array.isArray(body.users)
      ? (body.users as Option[])
          .map((u) => ({ id: asString(u.id), label: asString(u.label) }))
          .filter((u) => u.id && u.label)
      : [];
    const domains = Array.isArray(body.domains)
      ? (body.domains as Option[])
          .map((d) => ({ code: asString(d.code), label: asString(d.label) }))
          .filter((d) => d.code && d.label)
      : [];

    const today = asString(body.today);
    const nowLabel = asString(body.nowLabel);

    const userList = users.length
      ? users.map((u) => `${u.id} => ${u.label}`).join("\n")
      : "(אין משתמשים)";
    const domainList = domains.length
      ? domains.map((d) => `${d.code} => ${d.label}`).join("\n")
      : "(אין תחומים)";

    const userText = [
      nowLabel ? `התאריך והשעה כעת: ${nowLabel}.` : null,
      today ? `תאריך היום בפורמט מספרי: ${today}.` : null,
      `תחומים אפשריים (code => שם):\n${domainList}`,
      `משתמשים (id => שם):\n${userList}`,
      `התמלול: "${transcript}"`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const { apiKey, parseModel } = resolveOpenAIConfig();

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: parseModel,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userText },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "task_fields", strict: true, schema: TASK_SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[parse-voice] OpenAI error", res.status, detail);
      return NextResponse.json({ error: "מילוי המשימה נכשל. נסו שוב." }, { status: 502 });
    }

    const data = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "לא הצלחנו להבין את המשימה. נסו שוב." }, { status: 422 });
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(content) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "לא הצלחנו להבין את המשימה. נסו שוב." }, { status: 422 });
    }

    // Validate everything against the allowed values; never trust the model blindly.
    const priorityRaw = asString(raw.priority);
    const priority = (PRIORITIES as readonly string[]).includes(priorityRaw) ? priorityRaw : "medium";

    const domainRaw = asString(raw.business_domain);
    const business_domain = domains.some((d) => d.code === domainRaw) ? domainRaw : "";

    const assignedRaw = asString(raw.assigned_user_id);
    const assigned_user_id = users.some((u) => u.id === assignedRaw) ? assignedRaw : "";

    const dueDateRaw = asString(raw.due_date);
    const due_date = /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? dueDateRaw : "";

    const dueTimeRaw = asString(raw.due_time);
    const due_time = /^\d{2}:\d{2}$/.test(dueTimeRaw) ? dueTimeRaw : "";

    return NextResponse.json({
      task: {
        subject: asString(raw.subject),
        description: asString(raw.description),
        due_date,
        due_time,
        priority,
        business_domain,
        assigned_user_id,
        city: asString(raw.city),
      },
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "מילוי המשימה נכשל.") }, { status: 500 });
  }
}
