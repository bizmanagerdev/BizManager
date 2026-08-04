"use client";


// Small presentational helpers shared by the loans page and the installment-plan
// section, so both render money, dates and form fields identically.

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

export function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
