// One standard for every icon button in the top bar, so they read as a set:
// same hit area, same glyph size, same stroke weight, same hover.
//
// The bar shares the SIDEBAR's surface (see TopBar), so the glyph takes the
// sidebar foreground. Hover is SECONDARY (sky): the sidebar's own accent is a
// near-black navy, which on a near-black bar is no feedback at all.
//
// The 40px box is deliberate and shared — every control on the bar (icons, the
// avatar) is the same square, so they align on one line.
//
// PIXELS, not rem, and the glyph size is pinned too. The bar is CHROME: it lives
// in a fixed 60px rail and has to hold a title beside these buttons. rem here
// meant the per-account text scale ([[responsive-text-scaling]]) resized it —
// at 1.5x on a phone the root font is ~25px, so `h-10` became a 62px button that
// overflowed the bar and squeezed the title down to a couple of letters. Reading
// text scales; the frame around it doesn't.
//
// Note on sizing: Button's base class carries `[&_svg]:size-4`, a descendant
// rule that outranks plain utilities — so per-icon `h-6 w-6`-style classes are
// silently dead and every glyph lands at 16px regardless. Don't add size classes
// to top-bar icons; if you need a different size, use `!` (and expect it to look
// out of place next to its neighbours).

/** Ghost, circular, transparent — the shared top-bar icon button shell. Use with size="icon-sm". */
export const TOPBAR_ICON_BUTTON =
  "group h-[40px] w-[40px] [&_svg]:!size-[18px] rounded-full !bg-transparent !border-transparent !shadow-none !text-sidebar-foreground transition-all hover:!bg-secondary hover:!text-secondary-foreground hover:scale-110";

/** The one stroke weight for top-bar glyphs. */
export const TOPBAR_ICON_STROKE = 2.5;
