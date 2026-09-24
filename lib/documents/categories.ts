import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { DOCUMENT_CATEGORIES, getDocumentCategoryLabel } from "@/lib/documents";

// ────────────────────────────────────────────────────────────────────────────
// The document-category registry (public.document_categories).
//
// A category is a ROW that carries behavior, not a string in an array:
//   tracks_expiry → the document_expiry alert rule
//   required_for  → the "מסמכים חסרים" checklist on an entity page
//   is_money_doc  → should end up linked to an expense/payment
//
// `code` is what lives in documents.document_type and is IMMUTABLE; `label` is
// what an admin renames. Renaming a label must never change stored data.
//
// Every read falls back to FALLBACK_DOCUMENT_CATEGORIES when the table is
// absent, so the app behaves exactly as it did before the migration runs —
// the same tolerance lib/notifications/alert-config.ts applies to its config.
// ────────────────────────────────────────────────────────────────────────────

export type DocumentCategoryKind = "user" | "system";

/** Entities that can declare required documents. Transactional entities
 *  (order/task/payment) are deliberately excluded — a permanent "missing"
 *  marker on every one of them would be pure noise. */
export const CHECKLIST_ENTITY_TYPES = ["vehicle", "property", "project", "customer"] as const;
export type ChecklistEntityType = (typeof CHECKLIST_ENTITY_TYPES)[number];

export type DocumentCategoryRow = {
  code: string;
  label: string;
  kind: DocumentCategoryKind;
  tracks_expiry: boolean;
  expiry_lead_days: number;
  required_for: string[];
  is_money_doc: boolean;
  is_photo: boolean;
  active: boolean;
  sort_order: number;
};

const SELECT =
  "code,label,kind,tracks_expiry,expiry_lead_days,required_for,is_money_doc,is_photo,active,sort_order";

// Behavior for the seeded rows. MIRRORS the seed in
// supabase/migrations/20260922132453_document_categories.sql — keep the two in
// step, this is what the app uses until that migration runs.
const SEED_EXPIRY = new Set<string>(["ביטוח", "תעודה/רישיון", "חוזה/הסכם"]);
// Only papers that record ONE movement. A statement is a batch (and links via
// card_statements.document_id, not document_links); a quote is an offer with no
// movement behind it yet.
const SEED_MONEY = new Set<string>([
  "חשבונית",
  "חשבונית מס/קבלה",
  "קבלה",
  "אישור תשלום",
  "צק",
  "קנס",
]);
const SEED_REQUIRED: Record<string, ChecklistEntityType[]> = {
  ביטוח: ["vehicle"],
  "תעודה/רישיון": ["vehicle"],
  "מסמכי רכישה": ["property"],
  "נסח טאבו": ["property"],
};

export const FALLBACK_DOCUMENT_CATEGORIES: DocumentCategoryRow[] = DOCUMENT_CATEGORIES.map(
  (code, i) => ({
    code,
    label: code,
    kind: "user" as const,
    tracks_expiry: SEED_EXPIRY.has(code),
    expiry_lead_days: 30,
    required_for: SEED_REQUIRED[code] ?? [],
    is_money_doc: SEED_MONEY.has(code),
    is_photo: code === "צילום",
    active: true,
    sort_order: (i + 1) * 10,
  })
);

function normalizeRow(raw: Record<string, unknown>): DocumentCategoryRow | null {
  const code = typeof raw.code === "string" ? raw.code.trim() : "";
  if (!code) return null;
  const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : code;
  const leadDays = Number(raw.expiry_lead_days);
  return {
    code,
    label,
    kind: raw.kind === "system" ? "system" : "user",
    tracks_expiry: raw.tracks_expiry === true,
    expiry_lead_days: Number.isFinite(leadDays) ? Math.min(365, Math.max(0, leadDays)) : 30,
    required_for: Array.isArray(raw.required_for)
      ? raw.required_for.filter((v): v is string => typeof v === "string")
      : [],
    is_money_doc: raw.is_money_doc === true,
    is_photo: raw.is_photo === true,
    active: raw.active !== false,
    sort_order: Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : 0,
  };
}

/** Every registry row, ordered. Falls back to the seeded defaults when the
 *  table does not exist yet, so nothing breaks pre-migration. */
export async function fetchDocumentCategories(
  client?: SupabaseClient
): Promise<DocumentCategoryRow[]> {
  const supabase = client ?? createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("document_categories")
    .select(SELECT)
    .order("sort_order", { ascending: true });
  if (error || !data) return FALLBACK_DOCUMENT_CATEGORIES;
  const rows = (data as Record<string, unknown>[])
    .map(normalizeRow)
    .filter((r): r is DocumentCategoryRow => r !== null);
  return rows.length > 0 ? rows : FALLBACK_DOCUMENT_CATEGORIES;
}

/** The categories a user may pick from — active, user-facing ones only.
 *  System codes are registered for their LABELS, never offered in a picker. */
export function selectableCategories(rows: DocumentCategoryRow[]): DocumentCategoryRow[] {
  return rows.filter((r) => r.active && r.kind === "user");
}

export function categoriesTrackingExpiry(rows: DocumentCategoryRow[]): DocumentCategoryRow[] {
  return rows.filter((r) => r.active && r.tracks_expiry);
}

export function requiredCategoriesFor(
  rows: DocumentCategoryRow[],
  entityType: ChecklistEntityType
): DocumentCategoryRow[] {
  return rows.filter((r) => r.active && r.required_for.includes(entityType));
}

export function moneyCategoryCodes(rows: DocumentCategoryRow[]): Set<string> {
  return new Set(rows.filter((r) => r.is_money_doc).map((r) => r.code));
}

/** Registry label first, then the legacy hardcoded maps — so a row whose code
 *  is not (yet) registered still reads in Hebrew instead of raw English. */
export function categoryLabel(rows: DocumentCategoryRow[], code: string | null | undefined): string {
  const raw = (code ?? "").trim();
  if (!raw) return "ללא קטגוריה";
  return rows.find((r) => r.code === raw)?.label ?? getDocumentCategoryLabel(raw);
}

// ── Admin writes ────────────────────────────────────────────────────────────
// Per-row upsert, NOT the delete-then-insert that saveDunningStages uses:
// documents.document_type references `code`, so a hard delete would orphan real
// rows. Deactivating is the only way to retire a category.

export type DocumentCategoryDraft = Pick<
  DocumentCategoryRow,
  "code" | "label" | "tracks_expiry" | "expiry_lead_days" | "required_for" | "is_money_doc" | "sort_order"
>;

export async function saveDocumentCategory(draft: DocumentCategoryDraft): Promise<boolean> {
  const code = draft.code.trim();
  const label = draft.label.trim();
  if (!code || !label) return false;
  const { error } = await createSupabaseBrowserClient()
    .from("document_categories")
    .upsert(
      {
        code,
        label,
        tracks_expiry: draft.tracks_expiry,
        expiry_lead_days: Math.min(365, Math.max(0, Math.floor(draft.expiry_lead_days) || 30)),
        required_for: draft.required_for.filter((v) =>
          (CHECKLIST_ENTITY_TYPES as readonly string[]).includes(v)
        ),
        is_money_doc: draft.is_money_doc,
        sort_order: Math.floor(draft.sort_order) || 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "code" }
    );
  return !error;
}

export async function setDocumentCategoryActive(code: string, active: boolean): Promise<boolean> {
  const { error } = await createSupabaseBrowserClient()
    .from("document_categories")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("code", code);
  return !error;
}

/** How many documents still carry this code — shown before deactivating, so an
 *  admin never retires a category without seeing what it would orphan. */
export async function countDocumentsUsingCategory(code: string): Promise<number> {
  const { count, error } = await createSupabaseBrowserClient()
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("document_type", code);
  return error ? 0 : count ?? 0;
}

/** Stored `document_type` values that no registry row claims, with how many
 *  documents use each. Surfaced in the editor so an unknown value can be
 *  promoted or remapped instead of sitting in the archive unnoticed. */
export async function findOrphanCategories(
  rows: DocumentCategoryRow[]
): Promise<Array<{ code: string; count: number }>> {
  const known = new Set(rows.map((r) => r.code));
  const { data, error } = await createSupabaseBrowserClient()
    .from("documents")
    .select("document_type")
    .not("document_type", "is", null)
    .neq("document_type", "")
    .range(0, 4999);
  if (error) return [];

  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const code = typeof row.document_type === "string" ? row.document_type.trim() : "";
    if (!code || known.has(code)) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return Array.from(counts, ([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
}

// ── What a category looks like ──────────────────────────────────────────────

/** The glyph families a category can wear on a thumbnail. */
export type DocumentCategoryIcon = "camera" | "money" | "expiry" | "document";

/**
 * Which glyph stands for a category, derived from the BEHAVIOUR the admin gave
 * it rather than from a hardcoded list — a category added next year gets a
 * sensible icon without anyone editing this file.
 *
 * The regex tail is for the system codes that never became registry rows
 * (`order_delivery_image`, `vehicle_photo`, `project_photo`): they are the
 * photos the gallery is mostly made of, so they must not all read as "file".
 */
export function categoryIcon(
  rows: DocumentCategoryRow[],
  code: string | null | undefined
): DocumentCategoryIcon {
  const key = (code ?? "").trim();
  if (!key) return "document";
  const row = rows.find((entry) => entry.code === key);
  if (row) {
    if (row.is_photo) return "camera";
    if (row.is_money_doc) return "money";
    if (row.tracks_expiry) return "expiry";
    return "document";
  }
  if (/photo|image|צילום/i.test(key)) return "camera";
  if (/statement|צק|חשבונית|קבלה|תשלום/i.test(key)) return "money";
  return "document";
}
