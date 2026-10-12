"use client";

import { useState } from "react";
import { ChevronDownIcon, ProductIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { SectionCount } from "@/components/ui/section-card";

/**
 * The load list inside the הובלה card.
 *
 * On a phone the card owns the full width and every line is printed. On desktop
 * the card shares its height with לקוח and תשלום, so the lines that fit are
 * shown and the rest sit behind the toggle — which lives in the section's own
 * title row, next to the count, rather than costing a row of its own.
 */
export function ItemsToMoveList({
  items,
  visibleOnDesktop = 2,
}: {
  items: string[];
  /** How many lines fit alongside the other cards before folding the rest. */
  visibleOnDesktop?: number;
}) {
  const [open, setOpen] = useState(false);
  const hiddenCount = Math.max(items.length - visibleOnDesktop, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ProductIcon className="h-4 w-4 text-primary" />
          פריטים להעברה
        </span>
        <span className="flex items-center gap-1.5">
          {/* A count beside a title: the grey pill every section's count wears
              (owner, 2026-10-11). The toggle is a less important action — the
              soft style (dashed outline), its label a noun. */}
          <SectionCount count={items.length} />
          {hiddenCount > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="soft"
              className="hidden h-6 gap-1 px-2 text-xs lg:inline-flex"
              onClick={() => setOpen((prev) => !prev)}
            >
              {open ? "הצגת פחות" : `הצגת עוד ${hiddenCount}`}
              <ChevronDownIcon
                className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </Button>
          ) : null}
        </span>
      </div>

      <ul className="mt-1 divide-y divide-border/60 text-sm">
        {items.map((item, index) => (
          <li
            key={`${item}-${index}`}
            className={index >= visibleOnDesktop && !open ? "py-1.5 lg:hidden" : "py-1.5"}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
