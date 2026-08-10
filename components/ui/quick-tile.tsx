"use client";

// The square "quick action" tile, shared by the dashboard grid and the top-bar +
// menu so the two can never drift apart.
//
// Solid navy (primary) fill, white label, white glyph — except the two money
// actions, which keep the colors they have always had: red out, green in. That
// is the entire color story and it is settled. A neutral white-card version and
// a per-domain colored-glyph version were both tried and both rejected.

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

/** The tile shell. Put this on the <Button>; pass <QuickTileContent/> as children. */
export const QUICK_TILE_CLASS =
  "h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-secondary !text-secondary-foreground shadow-md shadow-secondary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-secondary/90";

/** Compact variant for the top-bar + menu, where the grid sits in a popover.
 *  The height is FIXED, not `aspect-square`: aspect-ratio is only a preferred
 *  size, so a label that wraps to a third line (העברה בין חשבונות) used to grow
 *  its tile and the grid came out ragged. Fixed h/w = every tile identical; the
 *  glyph + label block just centres in whatever room that leaves. */
export const QUICK_TILE_CLASS_SM =
  "h-[5.5rem] w-[5.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-transparent !bg-secondary p-2 text-center text-[0.7rem] leading-tight !text-secondary-foreground shadow-md shadow-secondary/30 !whitespace-normal focus:!bg-secondary/90 hover:!bg-secondary/90";

/** The only two colored glyphs. Everything else inherits the tile's white text. */
const TONE_CLASS = {
  expense: "text-destructive",
  income: "text-success",
} as const;

export function QuickTileContent({
  icon: Icon,
  label,
  tone,
  size = "md",
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  /** Omit for everything that isn't money — the glyph stays white. */
  tone?: keyof typeof TONE_CLASS;
  size?: "md" | "sm";
}) {
  const sm = size === "sm";
  return (
    <>
      <Icon
        className={cn(sm ? "!h-7 !w-7 shrink-0" : "!h-9 !w-9", tone && TONE_CLASS[tone])}
        strokeWidth={tone ? 2.4 : 2.2}
      />
      {/* The label sits right under the glyph on the tile's own `gap` — nothing
          reserves space for a second line. A flex-1 label box was tried so that
          glyphs would line up across a row regardless of label length, and it
          read as a hole between the glyph and its label. The fixed tile size is
          what keeps the tiles equal; this only has to stay tight. */}
      <span className="font-semibold">{label}</span>
    </>
  );
}
