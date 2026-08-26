import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { applyMoneyKeystroke, groupMoneyDigits, stripMoneyGrouping } from "@/lib/money";

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
 *
 * GROUPING: the amount is DISPLAYED with thousands separators (1,200,000) — the
 * shape `formatMoney` gives every amount the app prints — while `onChange` still
 * hands the parent a plain numeric string ("1200000"). Form state, validation
 * and server actions therefore need no change, and a pasted "₪1,200,000" now
 * parses instead of silently becoming null. The rules live in `lib/money.ts`.
 * Pass `groupThousands={false}` for a field that must show exactly what was
 * typed; an uncontrolled field (no `value`) keeps the plain behaviour too.
 */
export const CurrencyInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof Input> & { containerClassName?: string; groupThousands?: boolean }
>(({ className, containerClassName, inputMode, groupThousands = true, type, value, onChange, ...props }, ref) => {
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const pendingCaret = React.useRef<number | null>(null);
  const grouping = groupThousands && value !== undefined;

  const display = grouping ? groupMoneyDigits(stripMoneyGrouping(String(value ?? ""))) : value;

  // Re-grouping while typing moves the caret: React re-renders the field with
  // more (or fewer) separators than the browser had, and the cursor lands at the
  // end. Put it back where the digit the user just typed is.
  React.useLayoutEffect(() => {
    if (!grouping) return;
    const el = innerRef.current;
    if (!el) return;
    const next = String(display ?? "");
    if (el.value !== next) el.value = next;
    if (pendingCaret.current != null) {
      const at = Math.min(pendingCaret.current, next.length);
      if (document.activeElement === el) el.setSelectionRange(at, at);
      pendingCaret.current = null;
    }
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!grouping) {
      onChange?.(e);
      return;
    }
    const el = e.target;
    const typed = el.value;
    const caret = el.selectionStart ?? typed.length;
    const next = applyMoneyKeystroke(String(display ?? ""), typed, caret);
    pendingCaret.current = next.caret;

    // Hand the parent the ungrouped value...
    el.value = next.value;
    onChange?.(e);
    // ...then put the grouped text back right away. A keystroke that leaves the
    // parent's state where it was (a stray letter, a value it clamps) triggers no
    // re-render at all, so the effect above can't be the only thing restoring it.
    const grouped = groupMoneyDigits(next.value);
    if (el.value === next.value && el.value !== grouped) {
      el.value = grouped;
      const at = Math.min(next.caret, grouped.length);
      if (document.activeElement === el) el.setSelectionRange(at, at);
    }
  }

  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        // `Input` renders type="number" as text and rewrites every comma to a
        // dot; when we group we do both ourselves, so keep that rewrite away —
        // it would turn our "1,200" into "1.200".
        type={grouping ? undefined : type}
        value={display}
        onChange={handleChange}
        inputMode={inputMode ?? "decimal"}
        // Money fields look like credit-card / payment fields to autofill tools
        // (browser autofill, password managers, the "card-injection" coupon
        // extension seen in Sentry, Samsung Pass). Those hijack the field —
        // locking the value and swallowing typed digits. These opt-out flags
        // tell every major one to leave it alone.
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
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
