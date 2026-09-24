// ────────────────────────────────────────────────────────────────────────────
// Why a search result matched.
//
// The ranked filing SUGGESTIONS that used to live here went with the סידור
// mode they fed: a document that needs a person now says so on its own card,
// and is filed from there.
// ────────────────────────────────────────────────────────────────────────────


export type MatchableDocument = {
  title: string;
  file_name: string | null;
  document_type: string | null;
  customers: Array<{ label: string }>;
  projects: Array<{ label: string }>;
  properties: Array<{ label: string }>;
  tags: Array<{ label: string }>;
};

/**
 * The field a query hit, when it was NOT the title. Returns null when the title
 * already explains the match, so the line only appears where it adds something.
 */
export function describeMatch(doc: MatchableDocument, query: string): string | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  if (doc.title.toLowerCase().includes(needle)) return null;

  const hit = (label: string) => label.toLowerCase().includes(needle);
  const customer = doc.customers.find((c) => hit(c.label));
  if (customer) return `לקוח: ${customer.label}`;
  const project = doc.projects.find((p) => hit(p.label));
  if (project) return `פרויקט: ${project.label}`;
  const property = doc.properties.find((p) => hit(p.label));
  if (property) return `נכס: ${property.label}`;
  const tag = doc.tags.find((t) => hit(t.label));
  if (tag) return `תגית: ${tag.label}`;
  if ((doc.document_type ?? "").toLowerCase().includes(needle)) {
    return `קטגוריה: ${doc.document_type}`;
  }
  if ((doc.file_name ?? "").toLowerCase().includes(needle)) return `שם הקובץ: ${doc.file_name}`;
  return null;
}
