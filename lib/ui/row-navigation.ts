// Skip row-level navigation when the click/keydown originated on an interactive
// element inside the row (so per-row buttons/links still work as expected).
export function shouldIgnoreRowNavigation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("a, button, input, textarea, select, label"));
}
