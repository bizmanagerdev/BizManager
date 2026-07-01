import { Fragment, type ReactNode } from "react";

// Wrap every case-insensitive occurrence of `query` inside `text` in a <mark>, so
// the user can see exactly what matched. Pure (no hooks) — safe in both server and
// client components. Highlighting is a literal substring pass: it lights up the
// common case (notes/comments/names contain the typed text) and simply returns the
// text unchanged when the match was fuzzy rather than an exact substring.
export function highlightText(text: string, query: string): ReactNode {
  const needle = query.trim();
  if (!needle || !text) return text;

  const haystack = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let index = haystack.indexOf(lowerNeedle, from);
  let key = 0;

  if (index === -1) return text;

  while (index !== -1) {
    if (index > from) parts.push(<Fragment key={key++}>{text.slice(from, index)}</Fragment>);
    parts.push(
      <mark key={key++} className="rounded bg-yellow-200/80 px-0.5 text-inherit dark:bg-yellow-500/30">
        {text.slice(index, index + needle.length)}
      </mark>
    );
    from = index + needle.length;
    index = haystack.indexOf(lowerNeedle, from);
  }
  if (from < text.length) parts.push(<Fragment key={key++}>{text.slice(from)}</Fragment>);
  return parts;
}

/** The "why it matched" line: a short field label + the matching text, highlighted. */
export function MatchReason({
  label,
  snippet,
  query,
  className,
}: {
  label: string;
  snippet: string;
  query: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="font-medium">{label}:</span> {highlightText(snippet, query)}
    </div>
  );
}
