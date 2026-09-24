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
  "ביטוח",
  "מסמכי רכישה",
  "נסח טאבו",
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
  vehicle_photo: "צילום רכב",
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

// ────────────────────────────────────────────────────────────────────────────
// File KIND — derived from the extension, never stored.
//
// A file's kind ("this is an image") is not a category ("this is an insurance
// policy"). The archive has always derived it from the extension; these helpers
// are the one place that does so, replacing the copy in the documents page and
// the four duplicated `isImageAttachment` implementations.
// ────────────────────────────────────────────────────────────────────────────

export type FileKind =
  | "pdf"
  | "image"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "video"
  | "archive"
  | "other";

const FILE_KIND_EXTENSIONS: Record<Exclude<FileKind, "other">, readonly string[]> = {
  pdf: ["pdf"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif", "avif"],
  document: ["doc", "docx", "txt", "rtf", "odt"],
  spreadsheet: ["xls", "xlsx", "csv", "ods"],
  presentation: ["ppt", "pptx", "key"],
  video: ["mp4", "mov", "webm", "mkv", "avi", "m4v"],
  archive: ["zip", "rar", "7z", "tar", "gz"],
};

export function inferFileKind(name: string | null | undefined): FileKind {
  const value = (typeof name === "string" ? name.trim() : "").toLowerCase();
  const ext = value.includes(".") ? value.split(".").pop() ?? "" : "";
  if (!ext) return "other";
  for (const [kind, extensions] of Object.entries(FILE_KIND_EXTENSIONS)) {
    if (extensions.includes(ext)) return kind as FileKind;
  }
  return "other";
}

export function isImageFileName(name: string | null | undefined): boolean {
  return inferFileKind(name) === "image";
}

// True when a stored document is a picture. Extension first; the `"photo"`
// substring is the LEGACY fallback for rows whose file_name is missing or
// extensionless — it matches the system codes (project_photo, vehicle_photo)
// and ad-hoc ones (receipt_photo, site_photo) that tests pin. "צילום" is the
// Hebrew equivalent, which the old extension-or-"photo" check never caught.
export function isImageDocument(
  doc: { file_name?: string | null; document_type?: string | null } | null | undefined
): boolean {
  if (!doc) return false;
  if (isImageFileName(doc.file_name)) return true;
  const type = (doc.document_type ?? "").trim();
  if (!type) return false;
  return type.includes("photo") || type === "צילום";
}

// ────────────────────────────────────────────────────────────────────────────
// SOURCE — where a file came from. Read-only provenance, never user-picked.
//
// These used to be stored in `document_type`, which is why the archive listed
// "צרופת משימה" beside "חשבונית" as though they answered the same question.
// They answer a different one, so they live in `documents.source` now and read
// as provenance ("from a task"), not as a filing category.
// ────────────────────────────────────────────────────────────────────────────

const DOCUMENT_SOURCE_LABELS: Record<string, string> = {
  manual_upload: "הועלה ידנית",
  task_attachment: "מתוך משימה",
  expense_attachment: "מתוך הוצאה",
  payment_attachment: "מתוך תשלום",
  session_attachment: "מתוך דיווח שעות",
  project_document: "מתוך פרויקט",
  project_photo: "מתוך פרויקט",
  loan_document: "מתוך הלוואה",
  card_statement: "מייבוא דף אשראי",
  bank_statement: "מייבוא דף בנק",
  order_delivery_image: "מתוך משלוח",
  vehicle_photo: "מתוך רכב",
  general_document: "הועלה ידנית",
  morning: "ממורנינג",
};

export function getDocumentSourceLabel(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  return DOCUMENT_SOURCE_LABELS[raw] ?? null;
}

// A camera/WhatsApp filename ("1001262226.jpg", "IMG_4821.HEIC") is not a name —
// it identifies nothing to a person scanning a list. Detecting it lets the
// archive show what the document IS and who it belongs to instead.
const OPAQUE_NAME_PATTERNS = [
  /^\d{4,}$/i,                 // 1001262226
  /^img[-_ ]?\d+$/i,           // IMG_4821
  /^(pxl|dsc|dscn|dji|gopro)[-_ ]?\d+$/i,
  /^(photo|image|video|scan|document|file)[-_ ]?\d*$/i,
  /^whatsapp (image|video|document)/i,
  /^screenshot[-_ ]?/i,
  /^\d{4}-\d{2}-\d{2}[-_ ]?\d*$/,
];

/**
 * A name that is clearly a FILE rather than something a person wrote:
 * "ShipmentInvoice-Customer_No96992_Invoice_No1-471_260915_013257", "file (8)".
 * These pass isOpaqueDocumentName (they are not camera-roll shaped) yet carry no
 * meaning in a list, so when we know the type and the entity we can do better.
 */
export function isFilenameLikeName(name: string | null | undefined): boolean {
  const base = stripFileExtension((name ?? "").trim());
  if (!base) return true;
  // A machine id survives being next to Hebrew: "רשיון רכב 131357_260820_927"
  // is a camera's filename with a label glued on, not something anyone typed.
  // Checked BEFORE the Hebrew test, which would otherwise wave it through.
  if (/\d{3,}[_-]\d{3,}/.test(base)) return true;
  // Anything else with Hebrew in it was almost certainly typed by a person.
  if (/[֐-׿]/.test(base)) return false;
  if (/^file\s*\(?\d*\)?$/i.test(base)) return true;
  // Machine naming: an underscore, a long unbroken token, or several digit runs.
  if (base.includes("_")) return true;
  if (!base.includes(" ") && base.length > 18) return true;
  return (base.match(/\d{4,}/g) ?? []).length >= 2;
}

export function isOpaqueDocumentName(name: string | null | undefined): boolean {
  const raw = (name ?? "").trim();
  if (!raw) return true;
  // Strip a trailing extension, and the "jpg.1001262226" shape the archive
  // produces when the extension leads.
  const base = raw
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/^[a-z0-9]{1,5}\./i, "")
    .trim();
  if (!base) return true;
  return OPAQUE_NAME_PATTERNS.some((pattern) => pattern.test(base));
}

/** Drop a trailing file extension for display. "הלר בית 6.xlsx" reads badly in
 *  RTL — the Latin extension lands mid-sentence — and the file kind is already
 *  shown by the icon. The raw name stays in `file_name`. */
/**
 * The marks a copy leaves on a name. Two shapes, both from the phone rather than
 * from a person: the " (2)" a download folder adds to a repeat, and the counter
 * glued straight onto a word ("הנשיא1") that a camera roll or a share sheet adds.
 *
 * Deliberately narrow. The digits are only dropped where they are ATTACHED to a
 * word — a number standing on its own is content ("הלר בית 7.26", "מסמך 2024"),
 * and a name is not improved by losing it.
 */
export function stripCopyMarkers(name: string): string {
  const cleaned = name
    .replace(/\s*\(\d+\)/g, "")
    .replace(/(\p{L})\d+(?=\s|$)/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || name.trim();
}

export function stripFileExtension(name: string): string {
  const trimmed = name.trim();
  const withoutExt = trimmed.replace(/\.[a-z]{2,5}$/i, "").trim();
  return withoutExt || trimmed;
}

/**
 * A filename cut into the part that reads right-to-left and the part that reads
 * left-to-right, so each can be given its own direction.
 *
 * Without this, a Hebrew page reorders the Latin tail of a filename and
 * "1104276.jpg" renders as ".jpg1104276" — the extension jumps to the front.
 * Marking the whole string LTR is wrong the other way, because then a Hebrew
 * name inside it reads backwards. So: a name with no Hebrew is simply LTR, and
 * a mixed name keeps its Hebrew head in the page's direction while its Latin
 * tail — digits, underscores, extension and all — travels as ONE isolated run.
 */
export function splitFileNameForDisplay(name: string): { rtl: string; ltr: string } {
  const trimmed = name.trim();
  if (!/[֐-׿]/.test(trimmed)) return { rtl: "", ltr: trimmed };
  const match = /[A-Za-z0-9_.\-()\s]+$/.exec(trimmed);
  if (!match) return { rtl: trimmed, ltr: "" };
  const ltr = match[0].trim();
  const rtl = trimmed.slice(0, match.index).trim();
  // A tail that is only punctuation is not worth isolating.
  if (!ltr || !rtl) return { rtl: trimmed, ltr: "" };
  return { rtl, ltr };
}

/** A file's size in the units a person reads, or null when it is unknown. */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
  return `${(mb / 1024).toFixed(1)}GB`;
}

/**
 * What to show as a document's name in a list. Falls back from the stored title
 * to "<what it is> · <who it belongs to>" when the title is just a filename.
 */
export function buildDocumentDisplayName(
  storedName: string | null | undefined,
  categoryCode: string | null | undefined,
  entityLabel: string | null | undefined
): string {
  const stored = (storedName ?? "").trim();
  const category = (categoryCode ?? "").trim() ? getDocumentCategoryLabel(categoryCode) : "";
  const entity = (entityLabel ?? "").trim();

  // A filename beats nothing, but "<what it is> · <whose it is>" beats a
  // filename — so it only wins when we have neither of those.
  const canDescribe = Boolean(category || entity);
  const useStored =
    stored && !isOpaqueDocumentName(stored) && !(canDescribe && isFilenameLikeName(stored));
  if (useStored) return stripCopyMarkers(stripFileExtension(stored));

  if (category && entity) return `${category} · ${entity}`;
  if (category) return category;
  if (entity) return entity;
  return stored || "מסמך";
}
