/**
 * Append a dictation to existing free-text content (notes, comments,
 * descriptions). Unlike `appendDictatedLines` (task subjects, which are
 * really a list of separate items), prose fields get the transcript joined
 * as a continuing sentence, not split into lines.
 */
export function appendDictatedText(existing: string, dictated: string): string {
  const addition = dictated.trim();
  if (!addition) return existing;
  return existing.trim() ? `${existing.replace(/\s*$/, "")} ${addition}` : addition;
}
