// Shared between the server-side projects search (loadProjects.ts) and the
// client-side instant search index (useProjectSearchIndex.ts) so a typed
// Hebrew label like "הובלה" resolves to the same project_type enum values in
// both places.
//
// project_type is a Postgres ENUM (project_type_enum), so it has no ILIKE
// operator — filtering it with `ilike` raises
// "operator does not exist: project_type_enum ~~* unknown" and the whole search
// fails. Match the typed text against the type's Hebrew label (and its raw
// value) instead, then filter with `in.(…)` on the resolved values.
export const PROJECT_TYPE_LABELS: Record<string, string> = {
  logistics: "לוגיסטיקה",
  moving: "הובלה",
  construction: "שיפוצים",
  home: "בית",
  other: "אחר",
};

export function projectTypesMatching(rawQuery: string): string[] {
  const needle = rawQuery.trim().toLowerCase();
  if (!needle) return [];
  return Object.entries(PROJECT_TYPE_LABELS)
    .filter(([value, label]) => label.includes(needle) || value.includes(needle))
    .map(([value]) => value);
}
