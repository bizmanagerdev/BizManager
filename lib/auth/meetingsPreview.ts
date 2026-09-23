// ─────────────────────────────────────────────────────────────────────────────
// TEMPORARY — /meetings (ישיבה שבועית) is being trialled by one person before
// the rest of the office sees it.
//
// TO OPEN IT UP: delete this file and its call sites. `rg meetingsPreview` /
// `rg canSeeMeetings` finds all of them — three pages, one API route, and the
// nav. Nothing else depends on it.
//
// This is a VISIBILITY gate on top of the real one, not a replacement for it:
// /meetings is still admin/office by role (requireStaffPage) and still
// RLS-gated in the database. Removing this file returns the page to exactly
// the access it was built with.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whose account may see it. Matched against `users.email`, case-insensitively.
 * If the trial account signs in with a different address than the one here,
 * this is the single line to change.
 */
const MEETINGS_PREVIEW_EMAILS = ["faigy2549@gmail.com"];

const ALLOWED = new Set(MEETINGS_PREVIEW_EMAILS.map((email) => email.trim().toLowerCase()));

export function canSeeMeetings(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  // A viewer whose email hasn't loaded yet is NOT in the trial: the nav would
  // rather show one tab too few for a moment than flash a page at someone who
  // cannot open it.
  return normalized.length > 0 && ALLOWED.has(normalized);
}
