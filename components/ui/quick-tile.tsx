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

/** Compact variant for the top-bar + menu, where the grid sits in a popover. */
export const QUICK_TILE_CLASS_SM =
  "h-auto aspect-square w-[4.5rem] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-transparent !bg-secondary p-1.5 text-center text-[0.7rem] leading-tight !text-secondary-foreground shadow-md shadow-secondary/30 !whitespace-normal focus:!bg-secondary/90 hover:!bg-secondary/90";

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
        className={cn(sm ? "!h-7 !w-7" : "!h-9 !w-9", tone && TONE_CLASS[tone])}
        strokeWidth={tone ? 2.4 : 2.2}
      />
      <span className="font-semibold">{label}</span>
    </>
  );
}
