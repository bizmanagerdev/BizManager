import type { SupabaseClient } from "@supabase/supabase-js";
import { fuzzyTextMatch } from "@/lib/search/customerMatch";

// Shared helpers that resolve a PARENT entity's ids from matches on its CHILD
// records, so a list/search that only queries the parent view can still surface
// a row because of something written on a child (an order's product line, a
// project task's subject, a task comment). Mirrors findMatchingCustomers: a
// cheap indexed ilike pass, resilient to missing tables.
//
// Each helper returns the matched ids AND, per id, the field label + text that
// matched — so the caller can tell the user *why* a row surfaced.

type Row = Record<string, unknown>;

/** Why a parent surfaced: a short field label (Hebrew) + the matching text. */
export type ChildMatch = { label: string; snippet: string };
export type ChildMatchResult = { ids: string[]; contextById: Map<string, ChildMatch> };

/** A searchable text column + the Hebrew label shown when it's the reason for a hit. */
export type TextColumn = { name: string; label: string };

const EMPTY: ChildMatchResult = { ids: [], contextById: new Map() };

// LIKE wildcards (% _) and PostgREST's or() delimiter (,) would otherwise change
// the meaning of the pattern — strip them to spaces so the query matches literally.
function sanitize(rawQuery: string) {
  return rawQuery.replace(/[%,]/g, " ").trim();
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function includesLoose(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Generic "which rows of a table match this free text" — the fuzzy engine behind
 * notes/description search on customers, projects, cars, orders, etc. Two passes,
 * same shape as findMatchingCustomers:
 *   1. Indexed ILIKE across the given columns — exact/substring, WHOLE table.
 *   2. Only if that finds nothing: a bounded fuzzy scan (typo / letter-swap) over
 *      the most-recent `scanLimit` rows.
 * Returns matched ids + the column label & text that matched (for the "why" line).
 * Resilient: a missing table / RLS error just yields no matches.
 */
export async function findMatchingRowIds(
  supabase: SupabaseClient,
  opts: {
    table: string;
    columns: TextColumn[];
    query: string;
    idColumn?: string;
    limit?: number;
    scanLimit?: number;
    scanOrderColumn?: string;
    eq?: { column: string; value: string | number | boolean };
  }
): Promise<ChildMatchResult> {
  const query = sanitize(opts.query);
  if (!query || opts.columns.length === 0) return EMPTY;

  const idColumn = opts.idColumn ?? "id";
  const limit = opts.limit ?? 300;
  const scanLimit = opts.scanLimit ?? 800;
  const selectList = [idColumn, ...opts.columns.map((c) => c.name)].join(",");
  const contextById = new Map<string, ChildMatch>();

  const record = (row: Row, matches: (value: string) => boolean) => {
    const id = str(row[idColumn]);
    if (!id || contextById.has(id)) return;
    for (const col of opts.columns) {
      const value = str(row[col.name]);
      if (value && matches(value)) {
        contextById.set(id, { label: col.label, snippet: value });
        return;
      }
    }
  };

  // Fast path: indexed substring match across the whole table.
  let fast = supabase.from(opts.table).select(selectList);
  if (opts.eq) fast = fast.eq(opts.eq.column, opts.eq.value);
  const { data: fastData } = await fast
    .or(opts.columns.map((c) => `${c.name}.ilike.%${query}%`).join(","))
    .limit(limit);
  const lowerQuery = query.toLowerCase();
  for (const row of (fastData ?? []) as unknown as Row[]) record(row, (v) => v.toLowerCase().includes(lowerQuery));

  // Fuzzy fallback: only when substring matching found nothing.
  if (contextById.size === 0) {
    let scan = supabase.from(opts.table).select(selectList);
    if (opts.eq) scan = scan.eq(opts.eq.column, opts.eq.value);
    if (opts.scanOrderColumn) scan = scan.order(opts.scanOrderColumn, { ascending: false });
    const { data: scanData } = await scan.range(0, scanLimit - 1);
    for (const row of (scanData ?? []) as unknown as Row[]) record(row, (v) => fuzzyTextMatch(v, query));
  }

  return { ids: [...contextById.keys()].slice(0, limit), contextById };
}

/**
 * Order ids whose CONTENT matches the query, beyond the customer snapshot:
 *  - the order's own `notes` (where per-order comments are appended as a log), and
 *  - a line item — its product (name / SKU / barcode) or the line's own note.
 * Lets "חיפוש" on the orders list / global search find an order by a comment
 * written on it or by what's inside it, not just the customer.
 */
export async function findOrderIdsMatchingContent(
  supabase: SupabaseClient,
  rawQuery: string,
  limit = 300
): Promise<ChildMatchResult> {
  const query = sanitize(rawQuery);
  if (!query) return EMPTY;

  const contextById = new Map<string, ChildMatch>();
  const setCtx = (orderId: string, label: string, snippet: string) => {
    if (orderId && snippet && !contextById.has(orderId)) contextById.set(orderId, { label, snippet });
  };

  // Products matching by name/sku/barcode → their order lines → orders.
  const { data: products } = await supabase
    .from("products")
    .select("id,name")
    .or(`name.ilike.%${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%`)
    .limit(500);
  const productNameById = new Map<string, string>();
  for (const p of (products ?? []) as Row[]) {
    const id = str(p.id);
    if (id) productNameById.set(id, str(p.name));
  }
  const productIds = [...productNameById.keys()];

  const [orderNotes, itemsByProduct, itemsByNote] = await Promise.all([
    // Order comments live inside the order's notes field (see orders/add-comment)
    // — fuzzy (typo-tolerant) via the shared engine.
    findMatchingRowIds(supabase, { table: "orders", columns: [{ name: "notes", label: "הערה" }], query, limit }),
    productIds.length > 0
      ? supabase.from("order_items").select("order_id,product_id").in("product_id", productIds).limit(2000)
      : Promise.resolve({ data: [] as Row[] }),
    supabase.from("order_items").select("order_id,notes").ilike("notes", `%${query}%`).limit(2000),
  ]);

  for (const [id, ctx] of orderNotes.contextById) setCtx(id, ctx.label, ctx.snippet);
  for (const r of (itemsByProduct.data ?? []) as Row[]) {
    setCtx(str(r.order_id), "מוצר", productNameById.get(str(r.product_id)) ?? "");
  }
  for (const r of (itemsByNote.data ?? []) as Row[]) setCtx(str(r.order_id), "הערת פריט", str(r.notes));

  return { ids: [...contextById.keys()].slice(0, limit), contextById };
}

/**
 * Project ids reached through the project's own free text (name / notes /
 * items-to-move — fuzzy), a matching TASK (subject / description), or a matching
 * TASK COMMENT. Lets the projects list / global search find a project by anything
 * written on it or on one of its tasks/comments.
 */
export async function findProjectIdsMatchingContent(
  supabase: SupabaseClient,
  rawQuery: string,
  limit = 300
): Promise<ChildMatchResult> {
  const query = sanitize(rawQuery);
  if (!query) return EMPTY;

  const contextById = new Map<string, ChildMatch>();
  const setCtx = (projectId: string, label: string, snippet: string) => {
    if (projectId && snippet && !contextById.has(projectId)) contextById.set(projectId, { label, snippet });
  };

  // The project's own text (name / notes / items to move) — fuzzy.
  const ownText = await findMatchingRowIds(supabase, {
    table: "projects",
    columns: [
      { name: "notes", label: "הערה" },
      { name: "items_to_move", label: "פריטים" },
      { name: "name", label: "שם" },
    ],
    query,
    limit,
  });
  for (const [id, ctx] of ownText.contextById) setCtx(id, ctx.label, ctx.snippet);

  // Tasks whose own text matches, that belong to a project.
  const { data: taskRows } = await supabase
    .from("tasks")
    .select("project_id,subject,description")
    .not("project_id", "is", null)
    .or(`subject.ilike.%${query}%,description.ilike.%${query}%`)
    .limit(1000);
  for (const r of (taskRows ?? []) as Row[]) {
    const subject = str(r.subject);
    const description = str(r.description);
    const snippet = includesLoose(subject, query) ? subject : description || subject;
    setCtx(str(r.project_id), "משימה", snippet);
  }

  // Comments matching → their task → that task's project.
  const { data: commentRows } = await supabase
    .from("task_comments")
    .select("task_id,body")
    .ilike("body", `%${query}%`)
    .limit(1000);
  const bodyByTaskId = new Map<string, string>();
  for (const r of (commentRows ?? []) as Row[]) {
    const taskId = str(r.task_id);
    if (taskId && !bodyByTaskId.has(taskId)) bodyByTaskId.set(taskId, str(r.body));
  }
  const taskIds = [...bodyByTaskId.keys()];
  if (taskIds.length > 0) {
    const { data: commentTaskRows } = await supabase
      .from("tasks")
      .select("id,project_id")
      .in("id", taskIds)
      .not("project_id", "is", null);
    for (const r of (commentTaskRows ?? []) as Row[]) {
      setCtx(str(r.project_id), "תגובה", bodyByTaskId.get(str(r.id)) ?? "");
    }
  }

  return { ids: [...contextById.keys()].slice(0, limit), contextById };
}
