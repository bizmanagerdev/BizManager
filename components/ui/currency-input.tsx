import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Money entry field: a regular Input with a fixed ₪ (shekel) marker.
 *
 * The app is RTL and amounts are right-aligned, so the ₪ sits on the RIGHT,
 * immediately after the number — reading "1,234.50 ₪" like the he-IL currency
 * formatter. `pr-6` reserves just enough room so the value butts up against the
 * marker instead of hiding under it.
 *
 * For fixed-width fields pass `containerClassName` (e.g. "w-32") and keep the
 * input at `w-full`, so the marker stays anchored to the input, not the cell.
 */
export const CurrencyInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof Input> & { containerClassName?: string }
>(({ className, containerClassName, inputMode, ...props }, ref) => {
  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        ref={ref}
        inputMode={inputMode ?? "decimal"}
        className={cn("pr-6 text-right", className)}
        {...props}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm text-muted-foreground"
      >
        ₪
      </span>
    </div>
  );
});
CurrencyInput.displayName = "CurrencyInput";
