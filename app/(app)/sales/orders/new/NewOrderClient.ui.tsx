import { PAYMENT_TERMS_OPTIONS } from "@/lib/paymentTerms";
import { omitUnknownPlace } from "@/lib/ui/cities";

// Pure helpers and option constants, lifted out of NewOrderClient so the
// component file holds wizard state + orchestration only. No component state
// here. The stepper and summary row it used to own now live in
// components/ui/step-wizard.tsx and components/ui/summary.tsx, shared with the
// customer and project wizards.

export type Step =
  | "customer"
  | "branch"
  | "items"
  | "invoice"
  | "collection"
  | "paymentTerms"
  | "dueDate"
  | "payments"
  | "orderDate"
  | "orderStatus"
  | "deliveryDate"
  | "notes"
  | "summary";

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
  branches?: Array<{ id: string; name: string; address: string | null; phone: string | null }>;
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
  const branches = Array.isArray(row.branches)
    ? (row.branches as Array<Record<string, unknown>>)
        .map((b) => ({
          id: typeof b.id === "string" ? b.id : "",
          name: typeof b.name === "string" ? b.name : "",
          address: typeof b.address === "string" ? b.address : null,
          phone: typeof b.phone === "string" ? b.phone : null,
        }))
        .filter((b) => b.id)
    : undefined;

  return {
    id,
    name: (typeof row.name === "string" && row.name.trim() ? row.name.trim() : null) ?? "לקוח",
    nameForInvoice: typeof row.name_for_invoice === "string" && row.name_for_invoice.trim() ? row.name_for_invoice.trim() : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    whatsapp: typeof row.whatsapp === "string" ? row.whatsapp : null,
    email: typeof row.email === "string" ? row.email : null,
    address: typeof row.address === "string" ? omitUnknownPlace(row.address) : null,
    city: typeof row.address === "string" ? omitUnknownPlace(extractCityFromAddress(row.address)) : null,
    requiresPrepayment: row.requires_prepayment === true,
    contacts,
    branches,
  };
}

export const ORDER_STATUS_OPTIONS = [
  { value: "draft", label: "פתוח" },
  { value: "confirmed", label: "מאושר" },
  { value: "processing", label: "בטיפול" },
  { value: "out_for_delivery", label: "במשלוח" },
  { value: "partially_delivered", label: "סופק חלקית" },
  { value: "delivered", label: "סופק" },
  { value: "completed", label: "הושלם" },
  { value: "closed", label: "סגור" },
  { value: "cancelled", label: "בוטל" },
] as const;

export const STEP_LABEL: Record<Step, string> = {
  customer: "לקוח",
  branch: "סניף",
  items: "מוצרים",
  invoice: "חשבונית",
  collection: "גבייה",
  paymentTerms: "תשלום",
  dueDate: "פירעון",
  payments: "תשלומים",
  orderDate: "תאריך",
  orderStatus: "סטטוס",
  deliveryDate: "אספקה",
  notes: "הערות",
  summary: "סיכום",
};

export function termsLabel(value: string) {
  return PAYMENT_TERMS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

