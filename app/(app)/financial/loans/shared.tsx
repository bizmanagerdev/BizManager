"use client";

import type { LoanStatus } from "@/lib/loans";
import { israelDateKey } from "@/lib/timezone";
import { formatShortDate } from "@/lib/date";

// Small presentational helpers shared by the loans page and the installment-plan
// section, so both render money, dates and form fields identically.

/** Status → badge tone, used by both the loans list and the loan detail page. */
export function statusColor(status: LoanStatus) {
  switch (status) {
    case "repaid":
      return "success" as const;
    case "partially_repaid":
      return "info" as const;
    case "written_off":
      return "neutral" as const;
    default:
      return "warning" as const;
  }
}

export const METHOD_OPTIONS = [
  { value: "", label: "—" },
  { value: "cash", label: "מזומן" },
  { value: "bank_transfer", label: "העברה בנקאית" },
  { value: "check", label: "צ׳ק" },
  { value: "bit", label: "ביט" },
  { value: "credit_card", label: "כרטיס אשראי" },
  { value: "other", label: "אחר" },
];

export function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

// A loan/repayment day, read as the day itself (lib/date) — `new Date("2026-10-14")`
// on the device's clock showed 13/10 on a phone set to US time.
export function formatDate(value: string | null) {
  return formatShortDate(value, "—");
}

export function todayIso() {
  return israelDateKey();
}

export function StatBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "debt" | "asset";
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-0.5 text-xl font-semibold tabular-nums " +
          (tone === "debt" ? "text-destructive" : tone === "asset" ? "text-success" : "")
        }
        dir="ltr"
      >
        {value}
      </div>
    </div>
  );
}

// Re-exported so the loans screens keep importing their form bits from one
// place, while the markup itself is the app-wide shared Field.
export { Field } from "@/components/ui/field";
