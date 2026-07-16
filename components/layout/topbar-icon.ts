// One standard for every icon button in the top bar, so they read as a set:
// same hit area, same glyph size, same stroke weight, same hover.
//
// Note on sizing: Button's base class carries `[&_svg]:size-4`, a descendant
// rule that outranks plain utilities — so per-icon `h-6 w-6`-style classes are
// silently dead and every glyph lands at 16px regardless. Don't add size classes
// to top-bar icons; if you need a different size, use `!` (and expect it to look
// out of place next to its neighbours).

/** Ghost, circular, transparent — the shared top-bar icon button shell. Use with size="icon-sm". */
export const TOPBAR_ICON_BUTTON =
  "group rounded-full !bg-transparent !border-transparent !shadow-none text-foreground transition-all hover:!bg-accent hover:scale-110";

/** The one stroke weight for top-bar glyphs. */
export const TOPBAR_ICON_STROKE = 2.5;
