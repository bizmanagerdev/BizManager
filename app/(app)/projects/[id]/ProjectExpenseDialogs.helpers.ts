import { toHebrewError } from "@/lib/error-messages";
import { offlineUpload } from "@/lib/offline-upload";
import {
  EXPENSE_CATEGORY_OPTIONS_WITH_WAGE,
  EXPENSE_OTHER_CATEGORY,
  EXPENSE_WORKER_WAGE_CATEGORY,
} from "@/lib/expenses";
import type { FinancialAttachment } from "@/lib/payments";

// Pure formatting/getter/date helpers + the upload call, lifted out of
// ProjectExpenseDialogs so the dialog file holds form state + JSX only. Kept
// self-contained (no cross-import of the parent module at runtime).

export function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatIls(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function getString(row: Record<string, unknown> | null, key: string) {
  if (!row) return null;
  const value = row[key];
  return typeof value === "string" ? value : null;
}

export function isImageAttachment(attachment: Pick<FinancialAttachment, "file_name" | "document_type">) {
  const name = attachment.file_name?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(name) || attachment.document_type?.includes("photo");
}

export async function uploadFinancialAttachment(entityType: "expense" | "payment" | "session", entityId: string, file: File) {
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

export function getErrorMessage(error: unknown) {
  return toHebrewError(error, "");
}

// Categories come from the shared source of truth in lib/expenses.
export const PROJECT_EXPENSE_CATEGORY_OPTIONS = EXPENSE_CATEGORY_OPTIONS_WITH_WAGE;
export const OTHER_PROJECT_EXPENSE_CATEGORY = EXPENSE_OTHER_CATEGORY;
export const EMPLOYEE_WAGE_CATEGORY = EXPENSE_WORKER_WAGE_CATEGORY;

export function toLocalDateTimeValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dateOnly(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  return match ? match[1] : "";
}

export function projectDateOrToday(projectStartDate: string | null | undefined) {
  return dateOnly(projectStartDate) || new Date().toISOString().slice(0, 10);
}

export function projectLocalDateTime(projectStartDate: string | null | undefined, offsetMinutes = 0) {
  const baseDate = projectDateOrToday(projectStartDate);
  const now = new Date();
  const adjusted = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    0,
    0
  );
  adjusted.setMinutes(adjusted.getMinutes() + offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${baseDate}T${pad(adjusted.getHours())}:${pad(adjusted.getMinutes())}`;
}

export function projectLocalDateTimeWithTemplate(
  projectStartDate: string | null | undefined,
  templateDateTime: string | null | undefined,
  fallbackOffsetMinutes = 0
) {
  const baseDate = projectDateOrToday(projectStartDate);
  if (!templateDateTime) return projectLocalDateTime(projectStartDate, fallbackOffsetMinutes);
  const template = new Date(templateDateTime);
  if (Number.isNaN(template.getTime())) {
    return projectLocalDateTime(projectStartDate, fallbackOffsetMinutes);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${baseDate}T${pad(template.getHours())}:${pad(template.getMinutes())}`;
}

export function toIsoDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
