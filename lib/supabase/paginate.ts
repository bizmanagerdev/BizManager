// Fetch ALL rows of a Supabase query by paging through them — no silent
// truncation. Replaces the `.range(0, 50000)` hard caps scattered across the
// reporting/aggregation libs: those quietly DROP rows (and silently corrupt
// totals) the moment a table grows past the ceiling. Paging is correct at any
// size. The `page` thunk must apply `.range(from, to)` to the built query.
//
//   const rows = await fetchAllPaged<Row>((from, to) =>
//     supabase.from("payments").select("...").gte("payment_date", since).range(from, to)
//   );

const DEFAULT_PAGE_SIZE = 1000;

export async function fetchAllPaged<T = Record<string, unknown>>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    // A short page means we've reached the end — stop.
    if (chunk.length < pageSize) break;
  }
  return rows;
}

/**
 * Same paging, but returns the Supabase-style `{ data, error }` shape instead of
 * throwing — a drop-in replacement for an existing `.range(0, N)` query inside a
 * `Promise.all` whose results are checked via `.error` / consumed via `.data`.
 * Lets capped scans become unbounded WITHOUT touching the surrounding error
 * handling (used for the payroll loader, which is sensitive).
 */
export async function fetchAllPagedResult<T = Record<string, unknown>>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
  try {
    return { data: await fetchAllPaged<T>(page, pageSize), error: null };
  } catch (error) {
    // Preserve the original error's message so existing `.error.message` checks work.
    const message =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : "query failed";
    return { data: null, error: { message } };
  }
}
