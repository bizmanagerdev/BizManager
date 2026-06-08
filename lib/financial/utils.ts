import { isExpenseBusinessDomain, type ExpenseBusinessDomain } from "@/lib/expenses";
import type { FinancialEntry, FinancialEntryType, FinancialSourceKind } from "./types";

export function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const isoPrefix = trimmed.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(isoPrefix) ? isoPrefix : null;
}

export function normalizeDomain(value: string | null | undefined): ExpenseBusinessDomain | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isExpenseBusinessDomain(trimmed) ? trimmed : null;
}

export function normalizeCustomerId(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeText(value: string | null | undefined) {
  if (!value) return "";
  return value.trim().toLowerCase();
}

export function normalizePositiveInteger(value: number | string | null | undefined, fallback = 1) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 1) return fallback;
  return Math.floor(numeric);
}

export function addDaysToIso(isoDate: string, days: number) {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function addMonthsToIso(isoDate: string, months: number) {
  const base = new Date(`${isoDate}T00:00:00Z`);
  base.setUTCMonth(base.getUTCMonth() + months);
  return base.toISOString().slice(0, 10);
}

export function normalizePaymentMethod(method: string | null | undefined) {
  const raw = typeof method === "string" ? method.trim() : "";
  if (!raw) return "";
  const normalized = raw.toLowerCase();
  if (normalized === "check" || normalized === "cheque" || raw.includes("צ'ק")) return "check";
  return normalized;
}

export function normalizePaymentStatus(status: string | null | undefined) {
  const value = typeof status === "string" ? status.trim().toLowerCase() : "";
  return value || null;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function isFutureEntry(entry: FinancialEntry, referenceDate: string) {
  return entry.flowDate > referenceDate || entry.stage !== "posted";
}

export function domainToSourceKind(domain: ExpenseBusinessDomain | null): FinancialSourceKind | null {
  if (domain === "logistics_projects") return "project";
  if (domain === "property_management") return "property";
  if (domain === "sales") return "order";
  return null;
}

export function chunkStrings(values: string[], chunkSize: number) {
  const chunks: string[][] = [];
  for (let start = 0; start < values.length; start += chunkSize) {
    chunks.push(values.slice(start, start + chunkSize));
  }
  return chunks;
}

export function isMissingColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : null;
  return (
    code === "42703" &&
    typeof message === "string" &&
    message.toLowerCase().includes(columnName.toLowerCase())
  );
}

export function isPermissionDeniedError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : null;
  const message = "message" in error ? error.message : null;
  return (
    code === "42501" ||
    (typeof message === "string" &&
      (message.toLowerCase().includes("permission denied") ||
        message.toLowerCase().includes("row-level security")))
  );
}

export function normalizeStatusValue(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function monthKeyFromIso(isoDate: string | null | undefined) {
  const normalized = normalizeDate(isoDate);
  return normalized ? normalized.slice(0, 7) : "";
}

export function nextMonthDueDate(isoDate: string | null | undefined, dayOfMonth: number) {
  const normalized = normalizeDate(isoDate);
  if (!normalized) return null;
  const [yearText, monthText] = normalized.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const baseMonthIndex = month;
  const nextYear = baseMonthIndex === 12 ? year + 1 : year;
  const nextMonth = baseMonthIndex === 12 ? 1 : baseMonthIndex + 1;
  return recurringExpenseClampedDate(nextYear, nextMonth, dayOfMonth);
}

export function recurringExpenseClampedDate(year: number, month: number, day: number) {
  const safeMonth = Math.min(Math.max(month, 1), 12);
  const lastDay = new Date(Date.UTC(year, safeMonth, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(day, 1), lastDay);
  return `${year}-${String(safeMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export function filterByType(entries: FinancialEntry[], type: FinancialEntryType) {
  return entries.filter((e) => e.type === type);
}
