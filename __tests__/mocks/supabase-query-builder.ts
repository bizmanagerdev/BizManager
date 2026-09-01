/**
 * A minimal fake Supabase query builder for API route contract tests. Each
 * `.from(table)` call gets its own chainable builder that resolves to a
 * configured response via `.maybeSingle()`/`.single()`/`await`, and records
 * every `.insert(values)`/`.update(values)`/`.delete()` call so a test can
 * assert on what was actually about to be persisted — not just the mocked
 * return.
 *
 * A table's config can be a single response (used for both the initial read
 * and any later write on that same table+chain), or `{ read, write }` when a
 * test needs the write step to resolve differently — e.g. a route that reads
 * a row via `.select()`, then separately calls `.update()` on a fresh
 * `.from(table)` chain, and the update itself should fail.
 */
export type MockResp = { data: unknown; error: unknown };
export type MockTableConfig = MockResp | { read?: MockResp; write?: MockResp };

export function makeSupabase(config: Record<string, MockTableConfig> = {}) {
  const calls = {
    insert: {} as Record<string, unknown[]>,
    update: {} as Record<string, unknown[]>,
    delete: {} as Record<string, number>,
  };

  const from = (table: string) => {
    const cfg = config[table] ?? { data: null, error: null };
    const isSplit = cfg !== null && typeof cfg === "object" && ("read" in cfg || "write" in cfg);
    const readResp: MockResp = isSplit ? ((cfg as { read?: MockResp }).read ?? { data: null, error: null }) : (cfg as MockResp);
    const writeResp: MockResp = isSplit ? ((cfg as { write?: MockResp }).write ?? readResp) : readResp;
    let resp = readResp;

    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "gte", "lte", "in", "order", "limit", "is"]) {
      builder[m] = () => builder;
    }
    builder.insert = (values: unknown) => {
      (calls.insert[table] ??= []).push(values);
      resp = writeResp;
      return builder;
    };
    builder.update = (values: unknown) => {
      (calls.update[table] ??= []).push(values);
      resp = writeResp;
      return builder;
    };
    builder.delete = () => {
      calls.delete[table] = (calls.delete[table] ?? 0) + 1;
      resp = writeResp;
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve(resp);
    builder.single = () => Promise.resolve(resp);
    builder.then = (onF: (v: MockResp) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(resp).then(onF, onR);
    return builder;
  };

  return { from, calls };
}
