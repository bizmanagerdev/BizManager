import type { FinancialAttachment } from "@/lib/payments";
import { offlineUpload } from "@/lib/offline-upload";

// Pure date / number / formatting helpers + the attachment upload util, lifted
// out of DashboardActions so the component file holds UI + state, not utilities.

type Row = Record<string, unknown>;

export function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

export function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeDateOnly(value: string | null | undefined) {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : "";
}

export function nowLocal(offsetMinutes = 0) {
  const value = new Date();
  value.setSeconds(0, 0);
  value.setMinutes(value.getMinutes() + offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function toIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function durationHours(clockIn: string, clockOut: string) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
  const hours = (end - start) / 3600000;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

// Note: week-bucketing date helpers (toDateOnly / startOfWeek / addDays / isSameDay)
// live in lib/dashboard/week.ts — the single source of truth shared with buildWeekView.

export function formatWeekRangeLabel(start: Date, end: Date) {
  return `${new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" }).format(start)} - ${new Intl.DateTimeFormat(
    "he-IL",
    { day: "numeric", month: "long", year: "numeric" }
  ).format(end)}`;
}

export function shortWeekDay(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "short" }).format(date);
}

export const WEEK_PALETTE = [
  { bar: "bg-info", chip: "bg-info-soft text-info-soft-foreground" },
  { bar: "bg-success", chip: "bg-success-soft text-success-soft-foreground" },
  { bar: "bg-warning", chip: "bg-warning-soft text-warning-soft-foreground" },
  { bar: "bg-secondary", chip: "bg-accent text-accent-foreground" },
  { bar: "bg-destructive", chip: "bg-destructive-soft text-destructive-soft-foreground" },
  { bar: "bg-info/70", chip: "bg-info-soft/70 text-info-soft-foreground" },
  { bar: "bg-palette-orange-4", chip: "bg-palette-orange-10 text-primary-1" },
] as const;

export function formatIls(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function isImageAttachment(attachment: Pick<FinancialAttachment, "file_name" | "document_type">) {
  const name = attachment.file_name?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(name) || attachment.document_type?.includes("photo");
}

export async function uploadFinancialAttachment(
  entityType: "expense" | "payment" | "session",
  entityId: string,
  file: File
) {
  const result = await offlineUpload("/api/financial-attachments/upload", {
    fields: { entity_type: entityType, entity_id: entityId },
    file,
    label: file.name,
  });
  // Queued for later — the receipt syncs when the connection returns
  // (ConnectionToasts announces it); no attachment row to show yet.
  if (result.queued) return null;
  if (!result.ok) {
    throw new Error(result.error || "Upload failed");
  }
  const data = result.data as { attachment?: FinancialAttachment | null } | null;
  return data?.attachment ?? null;
}
