// One standard for every icon button in the top bar, so they read as a set:
// same hit area, same glyph size, same stroke weight, same hover.
//
// The bar is WHITE (2026-08-19), so the glyph takes the PAGE's foreground —
// muted at rest, since a row of full-strength navy glyphs on white is louder
// than anything they sit beside. Hover is the LIGHT sky tint (accent), not
// filled sky: a solid blue disc on a white bar reads as a pressed/active
// button, and the search glyph — which never had one — made the mismatch
// obvious (user, 2026-08-19: "they need to match, make them all the light
// one"). Filled-sky hover was right when the bar was dark; it isn't now.
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
  "group h-[40px] w-[40px] [&_svg]:!size-[18px] rounded-full !bg-transparent !border-transparent !shadow-none !text-muted-foreground transition-all hover:!bg-accent hover:!text-accent-foreground hover:scale-110";

/** The one stroke weight for top-bar glyphs. */
export const TOPBAR_ICON_STROKE = 2.5;
