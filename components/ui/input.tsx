import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Base text input.
 *
 * IMPORTANT — `type="number"` is deliberately never rendered. Inside the
 * Android WebView (our Capacitor shell) the Samsung Keyboard inserts its
 * top-row digits via IME composition, and a native `<input type="number">`
 * silently REJECTS composed text — so digits never appear while directly
 * committed symbol keys (# / *) do. That made every money/quantity field
 * unusable on Samsung phones in the installed app.
 *
 * So when a caller passes `type="number"` we transparently render a text
 * input with a numeric `inputMode` (still pops the numeric keypad) and
 * normalize the locale decimal comma to a dot before handing the event to
 * the caller's onChange. `min`/`max`/`step` become inert (they were only
 * ever used for the keypad hint, never read back via valueAsNumber).
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, type, inputMode, onChange, ...props }, ref) => {
  const isNumeric = type === "number";
  const resolvedType = isNumeric ? "text" : type;
  // Decimal keypad for money/measurements; callers wanting integers can still
  // pass inputMode="numeric" explicitly.
  const resolvedInputMode = isNumeric ? inputMode ?? "decimal" : inputMode;

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isNumeric && e.target.value.includes(",")) {
        // Samsung's Hebrew keypad emits a comma decimal separator; normalize
        // it so Number()/parseFloat downstream don't choke.
        e.target.value = e.target.value.replace(/,/g, ".");
      }
      onChange?.(e);
    },
    [isNumeric, onChange]
  );

  return (
    <input
      type={resolvedType}
      inputMode={resolvedInputMode}
      onChange={handleChange}
      className={cn(
        "flex h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-base shadow-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";
