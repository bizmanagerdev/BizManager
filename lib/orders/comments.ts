// Order comments WITHOUT any schema change: the order's existing free-text
// `notes` field doubles as a small comment log. Each comment is stored as a
// header line "<author> · <date>" followed by the body, and comments are joined
// by a divider line. This keeps `notes` human-readable everywhere it is already
// shown (delivery queue, notes editor, …) while letting the order dialog parse
// it back into an attributed thread.

export type OrderComment = {
  author_name: string | null;
  /** Already display-formatted ("DD/MM/YYYY HH:MM"), or null for legacy notes. */
  created_at: string | null;
  body: string;
};

const SEPARATOR = "\n―――\n";

/** Format "now" as a short Israel-local timestamp, regardless of server timezone. */
export function formatOrderCommentTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Parse the notes field into a list of comments (oldest → newest). */
export function parseOrderComments(notes: string | null | undefined): OrderComment[] {
  const text = (notes ?? "").trim();
  if (!text) return [];
  return text
    .split(SEPARATOR)
    .map((chunk) => {
      const c = chunk.replace(/^\n+|\n+$/g, "");
      const newline = c.indexOf("\n");
      const firstLine = newline === -1 ? c : c.slice(0, newline);
      const rest = newline === -1 ? "" : c.slice(newline + 1);
      // A real header looks like "<author> · <date…>" where the date starts
      // D/M/Y. The Hebrew (he-IL) timestamp separates with DOTS ("24.07.2026,
      // 12:26"), so accept "." "/" or "-" — matching only slashes silently
      // dropped every attributed comment back to an unattributed legacy note.
      const header = firstLine.match(/^(.+?) · (\d{1,2}[./-]\d{1,2}[./-]\d{2,4}.*)$/);
      if (header) {
        return { author_name: header[1].trim() || null, created_at: header[2].trim(), body: rest.trim() };
      }
      // No header → a legacy plain note: treat the whole block as one comment.
      return { author_name: null, created_at: null, body: c.trim() };
    })
    .filter((comment) => comment.body.length > 0 || comment.author_name);
}

/** Append one comment to the notes log and return the new notes string. */
export function appendOrderComment(
  notes: string | null | undefined,
  comment: { author_name: string | null; created_at: string; body: string }
): string {
  const block = `${comment.author_name ?? "משתמש"} · ${comment.created_at}\n${comment.body.trim()}`;
  const base = (notes ?? "").trim();
  return base ? `${base}${SEPARATOR}${block}` : block;
}

/** Serialize one comment back into its notes block (inverse of the parser). */
function serializeOrderComment(comment: OrderComment): string {
  const hasHeader = Boolean(comment.author_name || comment.created_at);
  if (!hasHeader) return comment.body.trim();
  return `${comment.author_name ?? "משתמש"} · ${comment.created_at ?? ""}\n${comment.body.trim()}`;
}

/** Serialize a full comment list back into the notes string (drops empty ones). */
export function serializeOrderComments(comments: OrderComment[]): string {
  return comments
    .map(serializeOrderComment)
    .filter((block) => block.trim().length > 0)
    .join(SEPARATOR);
}

/**
 * Locate a comment inside a parsed list by content (author + timestamp + body)
 * rather than by index, so an edit/delete can't hit the wrong one if the thread
 * shifted between load and action. Returns -1 when it's no longer present.
 */
export function findOrderCommentIndex(comments: OrderComment[], target: OrderComment): number {
  return comments.findIndex(
    (comment) =>
      (comment.author_name ?? null) === (target.author_name ?? null) &&
      (comment.created_at ?? null) === (target.created_at ?? null) &&
      comment.body === target.body
  );
}
