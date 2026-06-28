import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { resolveOpenAIConfig, isOpenAIConfigured } from "@/lib/openai/config";
import { parseDateToIso, type ParsedTxn } from "@/lib/financial/cardImport";

export const maxDuration = 120; // PDF understanding can take a while.

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_TXNS = 2000;

const SYSTEM_PROMPT = `אתה מחלץ עסקאות מדפי פירוט של כרטיסי אשראי ישראליים (ויזה כאל, ישראכרט, מקס, לאומי קארד וכו').
הקובץ עשוי לכלול כמה כרטיסים — כל עסקה משויכת לכרטיס שתחת הכותרת שלו (שם הכרטיס + 4 ספרות אחרונות).
לכל עסקה החזר:
- transaction_date: תאריך העסקה (מתי בוצעה הרכישה) בפורמט YYYY-MM-DD. אם לא קיים, השאר ריק.
- billing_date: תאריך החיוב (מתי חויב הכרטיס) בפורמט YYYY-MM-DD. אם לא קיים, השאר ריק.
- merchant: שם בית העסק.
- amount: סכום החיוב בש"ח. זיכוי/החזר = מספר שלילי.
- currency: מטבע המקור (למשל USD) אם זו עסקה במט"ח, אחרת ILS.
- original_amount: הסכום במטבע המקור אם זו עסקה במט"ח, אחרת null.
- card_label: שם הכרטיס + 4 ספרות אחרונות (אם ידוע), אחרת מחרוזת ריקה.
- installment: אם זה תשלום מתוך פריסה ("תשלום 2 מתוך 6") החזר "2/6", אחרת null.
אל תכלול שורות סיכום, יתרות, או ריביות שאינן עסקאות. החזר רק עסקאות אמיתיות.`;

// OpenAI structured-output schema (strict): nullable fields use a ["type","null"]
// union and stay required, per OpenAI's strict json_schema rules.
const TRANSACTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          transaction_date: { type: "string", description: "YYYY-MM-DD or empty string" },
          billing_date: { type: "string", description: "YYYY-MM-DD or empty string" },
          merchant: { type: "string" },
          amount: { type: "number", description: "ILS charge amount; negative for refunds" },
          currency: { type: "string", description: "ILS or original currency code" },
          original_amount: { type: ["number", "null"] },
          card_label: { type: "string" },
          installment: { type: ["string", "null"] },
        },
        required: [
          "transaction_date",
          "billing_date",
          "merchant",
          "amount",
          "currency",
          "original_amount",
          "card_label",
          "installment",
        ],
      },
    },
  },
  required: ["transactions"],
} as const;

type RawTxn = {
  transaction_date?: unknown;
  billing_date?: unknown;
  merchant?: unknown;
  amount?: unknown;
  currency?: unknown;
  original_amount?: unknown;
  card_label?: unknown;
  installment?: unknown;
};

function normalizeTxn(r: RawTxn): ParsedTxn | null {
  const amount = typeof r.amount === "number" ? r.amount : Number(r.amount);
  if (!Number.isFinite(amount) || amount === 0) return null;
  const txnDate = parseDateToIso(r.transaction_date) ?? "";
  const billingDate = parseDateToIso(r.billing_date) ?? "";
  if (!txnDate && !billingDate) return null;
  const merchant = String(r.merchant ?? "").trim() || "ללא שם";
  const currency = String(r.currency ?? "").trim() || "ILS";
  const originalAmount =
    typeof r.original_amount === "number" && Number.isFinite(r.original_amount) ? r.original_amount : null;
  const installmentRaw = typeof r.installment === "string" ? r.installment.trim() : "";
  return {
    billingDate,
    txnDate,
    amount,
    merchant,
    card: String(r.card_label ?? "").trim(),
    currency: currency === "ILS" ? null : currency,
    originalAmount,
    installment: installmentRaw || null,
  };
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;

    if (!isOpenAIConfigured()) {
      return NextResponse.json(
        { error: "חילוץ חכם אינו מוגדר בשרת (חסר OPENAI_API_KEY)." },
        { status: 503 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "חסר קובץ PDF." }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "הקובץ ריק." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `הקובץ גדול מדי (מקסימום ${MAX_BYTES / (1024 * 1024)}MB).` }, { status: 413 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const { apiKey, pdfModel } = resolveOpenAIConfig();

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: pdfModel,
        max_tokens: 16000,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "חלץ את כל העסקאות מדף הפירוט הזה." },
              {
                type: "file",
                file: {
                  filename: file.name || "statement.pdf",
                  file_data: `data:application/pdf;base64,${base64}`,
                },
              },
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "transactions_result", strict: true, schema: TRANSACTIONS_SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[parse-statement-pdf] OpenAI error", res.status, detail);
      return NextResponse.json({ error: "חילוץ הקובץ נכשל. נסו שוב." }, { status: 502 });
    }

    const data = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "לא זוהו עסקאות בקובץ." }, { status: 422 });
    }

    let parsed: { transactions?: RawTxn[] };
    try {
      parsed = JSON.parse(content) as { transactions?: RawTxn[] };
    } catch {
      return NextResponse.json({ error: "לא זוהו עסקאות בקובץ." }, { status: 422 });
    }

    const raw = (parsed.transactions ?? []).slice(0, MAX_TXNS);
    const transactions = raw.map(normalizeTxn).filter((t): t is ParsedTxn => t !== null);

    return NextResponse.json({ transactions });
  } catch (err: unknown) {
    const message = toHebrewError(err, "חילוץ הקובץ נכשל.");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
