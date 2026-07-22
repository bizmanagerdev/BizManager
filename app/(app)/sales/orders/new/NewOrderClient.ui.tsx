import { Fragment, type ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAYMENT_TERMS_OPTIONS } from "@/lib/paymentTerms";

// Pure helpers, option constants, and the two presentational pieces of the
// order wizard (stepper + summary row), lifted out of NewOrderClient so the
// component file holds wizard state + orchestration only. No component state here.

export type Step = 1 | 2 | 3 | 4;

export type CustomerOption = {
  id: string;
  name: string;
  nameForInvoice: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  requiresPrepayment: boolean;
  contacts?: Array<{ full_name: string; phone: string | null; email: string | null }>;
};

export function getString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function getNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function toPositiveInt(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

export function toNonNegativeInt(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

export function mapCustomerSearchResult(row: Record<string, unknown>): CustomerOption | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;

  const contacts = Array.isArray(row.contacts)
    ? (row.contacts as Array<Record<string, unknown>>).map((c) => ({
        full_name: typeof c.full_name === "string" ? c.full_name : "",
        phone: typeof c.phone === "string" ? c.phone : null,
        email: typeof c.email === "string" ? c.email : null,
      }))
    : undefined;

  return {
    id,
    name: (typeof row.name === "string" && row.name.trim() ? row.name.trim() : null) ?? "לקוח",
    nameForInvoice: typeof row.name_for_invoice === "string" && row.name_for_invoice.trim() ? row.name_for_invoice.trim() : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    whatsapp: typeof row.whatsapp === "string" ? row.whatsapp : null,
    email: typeof row.email === "string" ? row.email : null,
    address: typeof row.address === "string" ? row.address : null,
    city: typeof row.address === "string" ? extractCityFromAddress(row.address) : null,
    requiresPrepayment: row.requires_prepayment === true,
    contacts,
  };
}

export const ORDER_STATUS_OPTIONS = [
  { value: "draft", label: "פתוח" },
  { value: "confirmed", label: "מאושר" },
  { value: "processing", label: "בטיפול" },
  { value: "out_for_delivery", label: "במשלוח" },
  { value: "delivered", label: "סופק" },
  { value: "completed", label: "הושלם" },
  { value: "closed", label: "סגור" },
  { value: "cancelled", label: "בוטל" },
] as const;

export const WIZARD_STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "לקוח" },
  { n: 2, label: "מוצרים" },
  { n: 3, label: "תשלום ופרטים" },
  { n: 4, label: "סקירה" },
];

export const STEP_HEADINGS: Record<Step, { title: string; subtitle: string }> = {
  1: { title: "למי ההזמנה?", subtitle: "חיפוש ברשימת הלקוחות הקיימים או הוספת לקוח חדש." },
  2: { title: "בניית ההזמנה", subtitle: "הוספת מוצרים, עדכון כמות, מחיר והנחות בעגלה." },
  3: { title: "תשלום ופרטים", subtitle: "חשבונית, תאריך, אופן התשלום והתשלומים בפועל." },
  4: { title: "סקירה וסיכום", subtitle: "בדיקת הסכומים והפרטים לפני יצירת ההזמנה." },
};

export function termsLabel(value: string) {
  return PAYMENT_TERMS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** Top progress indicator: numbered steps with labels, connected by a track. RTL-aware. */
export function WizardStepper({
  current,
  canClick,
  onStepClick,
}: {
  current: Step;
  canClick: (n: Step) => boolean;
  onStepClick: (n: Step) => void;
}) {
  return (
    <div className="flex items-start">
      {WIZARD_STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        const clickable = canClick(s.n);
        return (
          <Fragment key={s.n}>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                disabled={!clickable}
                onClick={() => clickable && onStepClick(s.n)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                  active && "border-primary text-primary",
                  done && "border-primary bg-primary text-primary-foreground",
                  !active && !done && "border-border text-muted-foreground",
                  clickable && !active ? "cursor-pointer hover:border-primary/60" : "cursor-default"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : s.n}
              </button>
              <div
                className={cn(
                  "w-14 text-center text-[10px] font-medium leading-tight",
                  active || done ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {s.label}
              </div>
            </div>
            {i < WIZARD_STEPS.length - 1 ? (
              <div
                className={cn(
                  "mx-1 mt-[14px] h-0.5 flex-1 rounded-full sm:mx-2",
                  done ? "bg-primary" : "bg-border"
                )}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

export function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{value}</span>
    </div>
  );
}
