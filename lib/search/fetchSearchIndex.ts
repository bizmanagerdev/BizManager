import type { SearchIndexKind } from "@/app/api/search-index/[kind]/route";

/**
 * Load one of the type-ahead indexes (customers / orders / projects) from
 * /api/search-index — a plain GET, so it runs alongside the page's other
 * requests instead of queueing like a server action. Throws on failure, so the
 * hooks can fall back to their offline snapshot.
 */
export async function fetchSearchIndex<T>(kind: SearchIndexKind): Promise<T[]> {
  const response = await fetch(`/api/search-index/${kind}`, { cache: "no-store" });
  const json = (await response.json().catch(() => ({}))) as { rows?: T[]; error?: string };
  if (!response.ok || !Array.isArray(json.rows)) {
    throw new Error(json.error || "טעינת רשימת החיפוש נכשלה.");
  }
  return json.rows;
}
