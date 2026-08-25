"use client";

// A tappable "pick one" row — the building block every one-question-per-stage
// wizard step (IncomeDialog, CollectPaymentDialog) uses for domain/method/
// account/receivable/etc. pickers, instead of a native <select>. Lifted out
// once it was about to appear in a second file — same look everywhere a step
// wizard offers a set of visible, tap-to-advance options.

import { isValidElement, type ComponentPropsWithoutRef, type ComponentType, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type OptionIcon = ComponentType<{ className?: string }> | ReactNode;

function renderOptionIcon(icon: OptionIcon) {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  const Icon = icon as ComponentType<{ className?: string }>;
  return <Icon className="h-5 w-5" />;
}

/** Superset of ExpenseDialog's old private `expCard` (boxed icon, stacked
 *  label/sub, numbered badge, 4 selection tones) — merged in here so every
 *  atomic-step dialog (Income, CollectPayment, Expense) renders option cards
 *  from the same component instead of near-identical parallel copies. */
export function OptionRow({
  selected,
  onClick,
  icon,
  label,
  sub,
  badge,
  tone = "brand",
  ...rest
}: {
  selected: boolean;
  onClick: () => void;
  icon?: OptionIcon;
  label: string;
  sub?: string;
  badge?: number;
  tone?: "brand" | "paid" | "partial" | "unpaid";
} & Omit<ComponentPropsWithoutRef<"button">, "onClick" | "type" | "className">) {
  const selectedCls =
    tone === "paid"
      ? "border-success/20 bg-success text-success-foreground shadow-sm shadow-success/25"
      : tone === "partial"
        ? "border-warning/20 bg-warning text-warning-foreground shadow-sm shadow-warning/25"
        : tone === "unpaid"
          ? "border-destructive/20 bg-destructive text-destructive-foreground shadow-sm shadow-destructive/25"
          : "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/25";
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-right transition-all duration-200",
        selected ? selectedCls : "border-border bg-accent/40 text-accent-foreground hover:bg-accent"
      )}
    >
      {icon ? (
        <span
          className={cn(
            "flex h-9 w-9 flex-none items-center justify-center rounded-lg",
            selected ? "bg-white/15" : "bg-muted text-primary"
          )}
        >
          {renderOptionIcon(icon)}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {sub ? <span className={cn("block text-xs", selected ? "opacity-80" : "text-muted-foreground")}>{sub}</span> : null}
      </span>
      {badge != null ? (
        <span
          className={cn(
            "flex h-5 w-5 flex-none items-center justify-center rounded border text-[11px] font-bold tabular-nums",
            selected ? "border-current/30" : "text-muted-foreground"
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/** The per-step "question" heading — a bold question, optionally a muted
 *  sub-line. Used to carry a small icon+label "eyebrow" above the question
 *  (matching ExpenseDialog express mode's old `expEyebrow`+`expTitle`) — the
 *  stepper right above already names the current step, so the eyebrow just
 *  repeated it a second time; dropped (user report, 2026-08-25: "this is
 *  duplicate ... remove the eyebrow"). Same removal in ExpenseDialog itself. */
export function StepHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h2 className="text-center text-xl font-semibold leading-tight tracking-tight">{title}</h2>
      {sub ? (
        <p className="mb-3 mt-0.5 text-center text-sm text-muted-foreground">{sub}</p>
      ) : (
        <div className="mb-2" />
      )}
    </>
  );
}

function shiftDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DATE_SHORTCUTS = [
  ["היום", 0],
  ["אתמול", -1],
  ["שלשום", -2],
] as const;

/** "Today / yesterday / day before" one-tap picks under a date step's own
 *  <DateInput> — tapping one both sets the date AND advances (a typed custom
 *  date still needs the step's own Next button). Same pattern ExpenseDialog's
 *  express date step uses. */
export function DateQuickPicks({ onPick }: { onPick: (date: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      {DATE_SHORTCUTS.map(([label, days]) => (
        <button
          key={label}
          type="button"
          onClick={() => onPick(shiftDate(days))}
          className="rounded-full border border-input bg-background px-4 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
