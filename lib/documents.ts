// Document categories (קטגוריות מסמכים). A FIXED controlled list — uploads and
// edits pick from here instead of free-typing, so the archive stays consistent
// (no duplicate "חשבונית"/"חשבוניות"/"invoice" mess). Stored verbatim in
// documents.document_type.
export const DOCUMENT_CATEGORIES = [
  "חשבונית",
  "חשבונית מס/קבלה",
  "קבלה",
  "הצעת מחיר",
  "הזמנה",
  "חוזה/הסכם",
  "תעודת משלוח",
  "אישור תשלום",
  "צק",
  "תעודה/רישיון",
  "קנס",
  "צילום",
  "מסמך כללי",
  "אחר",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DEFAULT_DOCUMENT_CATEGORY: DocumentCategory = "מסמך כללי";

export function isDocumentCategory(value: string | null | undefined): value is DocumentCategory {
  return typeof value === "string" && (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

// System-generated document_type codes written by other flows across the app
// (order delivery photos, financial attachments, card statements, Morning docs,
// …). They're stored as English codes; map them to Hebrew so the archive reads
// cleanly. New manual uploads use the controlled Hebrew list above, so the code
// values below are the full set of legacy/system categories to translate.
const SYSTEM_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  order_delivery_image: "צילום משלוח",
  project_photo: "צילום פרויקט",
  project_document: "מסמך פרויקט",
  session_attachment: "צרופת דיווח שעות",
  expense_attachment: "צרופת הוצאה",
  payment_attachment: "אסמכתת תשלום",
  task_attachment: "צרופת משימה",
  card_statement: "דף חיוב אשראי",
  bank_statement: "דף עובר ושב",
  loan_document: "מסמך הלוואה",
  general_document: "מסמך כללי",
};

// Morning / GreenInvoice document type IDs (stored as `morning_<id>`).
const MORNING_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  "10": "הצעת מחיר",
  "305": "חשבונית מס",
  "320": "חשבונית מס/קבלה",
  "400": "קבלה",
};

// Convert any stored document_type (system code, morning_<id>, controlled Hebrew
// value, or custom text) to a Hebrew display label.
export function getDocumentCategoryLabel(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "ללא קטגוריה";
  if (raw in SYSTEM_DOCUMENT_TYPE_LABELS) return SYSTEM_DOCUMENT_TYPE_LABELS[raw]!;
  if (raw.startsWith("morning_")) {
    const id = raw.slice("morning_".length);
    return MORNING_DOCUMENT_TYPE_LABELS[id] ?? "מסמך מורנינג";
  }
  return raw;
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "svg"];

// Smart default for a new upload, by file type. The user can always override
// from the fixed list — this just pre-selects the most likely category.
export function inferDefaultDocumentCategory(fileName?: string | null): DocumentCategory {
  const ext = (fileName ?? "").toLowerCase().split(".").pop() ?? "";
  if (IMAGE_EXTENSIONS.includes(ext)) return "צילום";
  return DEFAULT_DOCUMENT_CATEGORY;
}
