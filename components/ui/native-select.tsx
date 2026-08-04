"use client";

// The app's dropdown. Before this existed there were 162 hand-styled <select>
// elements across 57 files in 33 different class combinations — five heights,
// three corner radii — so a dropdown rarely matched the Input sitting next to
// it. This wears exactly the Input's clothes.
//
// Native on purpose: the OS picker is the right control on a phone, and it
// stays keyboard- and screen-reader-correct for free. When a list is long
// enough to need typing, reach for SearchableSelect instead.

import * as React from "react";
import { cn } from "@/lib/utils";

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select"> & {
    /** Compact row height for toolbars and table cells. */
    dense?: boolean;
  }
>(({ className, dense = false, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "w-full border border-input bg-background/80 shadow-sm ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      dense
        ? "h-9 rounded-lg px-3 text-sm"
        : // Matches Input exactly, so a select and a text field in the same form
          // line up on height, radius and padding.
          "h-11 rounded-xl px-4 py-2 text-base md:text-sm",
      className
    )}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";
