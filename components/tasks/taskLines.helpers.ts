// A task name that arrives as a LIST.
//
// People paste or dictate a day's work into the name field — one thing per line,
// often numbered or bulleted. Rather than a separate "bulk" screen, the normal
// create dialog notices the extra lines and offers to split them.
//
// Strip the markers, or you get a task literally called "1. לבדוק את הדירה".

/** Split free text into task subjects: one per non-empty line, list markers removed. */
export function parseTaskLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-–—*•]|\d+[.)])\s+?/, "").trim())
    .filter(Boolean);
}

/** Is this name actually a list? (More than one real line.) */
export function isMultiLineSubject(text: string): boolean {
  return parseTaskLines(text).length > 1;
}

/**
 * Turn ONE dictation into one line per task.
 *
 * Speech has no Enter key: saying five things gives back a single sentence like
 * "לבדוק את הדירה, לדבר עם הקבלן ולתקן את האמבטיה". Recording each row
 * separately (record → stop → record) is exactly what people won't do, so split
 * on the pauses the transcriber punctuates.
 *
 * Splits on , ; and newlines, and on "." — but NOT a decimal point, or "3.5
 * שעות" becomes two tasks. A wrong split is cheap: the create dialog lists the
 * lines and asks before creating anything.
 */
export function splitDictationToLines(text: string): string[] {
  return text
    .split(/\s*(?:[,;\n]|\.(?!\d))\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Append a dictation to the existing text as new line(s). */
export function appendDictatedLines(existing: string, dictated: string): string {
  const lines = splitDictationToLines(dictated);
  if (lines.length === 0) return existing;
  const addition = lines.join("\n");
  return existing.trim() ? `${existing.replace(/\s*$/, "")}\n${addition}` : addition;
}
