// One task per line — the parsing rules for the quick-add box.
//
// People paste and dictate real lists, so the input arrives with numbering,
// bullets, blank lines and stray whitespace. Strip that rather than creating a
// task literally called "1. לבדוק את הדירה".

/** Split free text into task subjects: one per non-empty line, list markers removed. */
export function parseTaskLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-–—*•]|\d+[.)])\s+?/, "").trim())
    .filter(Boolean);
}
