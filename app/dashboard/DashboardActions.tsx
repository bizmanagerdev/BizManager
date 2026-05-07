"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Clock3,
  FolderKanban,
  ListTodo,
  PlayCircle,
  ShoppingCart,
} from "lucide-react";
import NewOrderClient from "@/app/sales/orders/new/NewOrderClient";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import type { UserRole } from "@/lib/auth/requireProfile";
import {
  EXPENSE_BUSINESS_DOMAINS,
  mapProjectTypeToExpenseDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import {
  calculateSessionLaborCost,
  getActiveSalaryAgreementForDate,
  type SalaryAgreementRow,
} from "@/lib/payroll";
import type { FinancialAttachment } from "@/lib/payments";
import type { CalendarEntry } from "@/lib/projectSchedule";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Row = Record<string, unknown>;

type ProjectOption = {
  id: string;
  name: string;
  type?: string;
  customerId: string;
  customerName: string;
};

type UserOption = {
  id: string;
  label: string;
  role?: UserRole;
};

type EntityOption = {
  id: string;
  name: string;
  subtitle?: string;
};

type OpenSessionInfo = {
  id: string;
  clock_in: string;
};

type PaymentChoice = "none" | "paid" | "partial";

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function nextMonth(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function nowLocal(offsetMinutes = 0) {
  const value = new Date();
  value.setSeconds(0, 0);
  value.setMinutes(value.getMinutes() + offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function toIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function durationHours(clockIn: string, clockOut: string) {
  const start = new Date(clockIn).getTime();
  const end = new Date(clockOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "";
  const hours = (end - start) / 3600000;
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

function toDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  value.setDate(value.getDate() - value.getDay());
  return value;
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isWithinDayRange(day: Date, start: Date, end: Date) {
  return day >= start && day <= end;
}

function formatWeekDay(date: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function formatWeekRangeLabel(start: Date, end: Date) {
  return `${new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" }).format(start)} - ${new Intl.DateTimeFormat(
    "he-IL",
    { day: "numeric", month: "long", year: "numeric" }
  ).format(end)}`;
}

function entryTypeLabel(kind: CalendarEntry["kind"]) {
  return kind === "task" ? "משימה" : "פרויקט";
}

function formatIls(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function isImageAttachment(attachment: Pick<FinancialAttachment, "file_name" | "document_type">) {
  const name = attachment.file_name?.toLowerCase() ?? "";
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i.test(name) || attachment.document_type?.includes("photo");
}

async function uploadFinancialAttachment(
  entityType: "expense" | "payment" | "session",
  entityId: string,
  file: File
) {
  const form = new FormData();
  form.set("entity_type", entityType);
  form.set("entity_id", entityId);
  form.set("file", file);

  const res = await fetch("/api/financial-attachments/upload", {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "Upload failed");
  }
  return (json?.attachment ?? null) as FinancialAttachment | null;
}

const fieldClass =
  "h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-sm shadow-sm outline-none transition-all focus:border-destructive/40 focus:ring-2 focus:ring-ring";

const DASHBOARD_EXPENSE_CATEGORY_OPTIONS = [
  "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3",
  "\u05e8\u05db\u05e9",
  "\u05ea\u05d7\u05d1\u05d5\u05e8\u05d4",
  "\u05d0\u05d5\u05db\u05dc",
  "\u05d0\u05d7\u05e8",
] as const;
const OTHER_EXPENSE_CATEGORY = "\u05d0\u05d7\u05e8";
const EMPLOYEE_WAGE_CATEGORY = "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3";
const HEBREW = {
  saveErrorUnknown: "\u05e9\u05d2\u05d9\u05d0\u05d4 \u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2\u05d4",
  cancel: "\u05d1\u05d9\u05d8\u05d5\u05dc",
  saving: "\u05e9\u05d5\u05de\u05e8...",
  customerFallback: "\u05dc\u05e7\u05d5\u05d7",
  selectCustomer: "\u05d1\u05d7\u05e8\u05d5 \u05dc\u05e7\u05d5\u05d7",
  selectProject: "\u05d1\u05d7\u05e8\u05d5 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  orderNew: "\u05d4\u05d6\u05de\u05e0\u05d4 \u05d7\u05d3\u05e9\u05d4",
  orderQuickOpen: "\u05e4\u05ea\u05d9\u05d7\u05ea \u05d8\u05d5\u05e4\u05e1 \u05d4\u05d6\u05de\u05e0\u05d4 \u05de\u05d4\u05d9\u05e8\u05d4",
  orderDialogDescription:
    "\u05e4\u05ea\u05d9\u05d7\u05ea \u05d4\u05d6\u05de\u05e0\u05d4 \u05de\u05ea\u05d5\u05da \u05d4\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3 \u05d1\u05dc\u05d9 \u05de\u05e2\u05d1\u05e8 \u05dc\u05de\u05e1\u05da \u05d4\u05de\u05db\u05d9\u05e8\u05d5\u05ea.",
  orderSaved: "\u05d4\u05d4\u05d6\u05de\u05e0\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4",
  projectNew: "\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d7\u05d3\u05e9",
  projectQuickCreate:
    "\u05d9\u05e6\u05d9\u05e8\u05d4 \u05de\u05d4\u05d9\u05e8\u05d4 \u05d1\u05dc\u05d9 \u05dc\u05e2\u05d6\u05d5\u05d1 \u05d0\u05ea \u05d4\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3",
  projectDialogDescription:
    "\u05d8\u05d5\u05e4\u05e1 \u05e7\u05e6\u05e8 \u05dc\u05e4\u05ea\u05d9\u05d7\u05d4 \u05de\u05d4\u05d9\u05e8\u05d4 \u05e9\u05dc \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d7\u05d3\u05e9.",
  projectName: "\u05e9\u05dd \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  customer: "\u05dc\u05e7\u05d5\u05d7",
  projectType: "\u05e1\u05d5\u05d2 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  logistics: "\u05dc\u05d5\u05d2\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4",
  moving: "\u05d4\u05d5\u05d1\u05dc\u05d4",
  construction: "\u05e9\u05d9\u05e4\u05d5\u05e6\u05d9\u05dd",
  status: "\u05e1\u05d8\u05d8\u05d5\u05e1",
  statusQuote: "\u05d4\u05e6\u05e2\u05ea \u05de\u05d7\u05d9\u05e8",
  statusPlanned: "\u05de\u05ea\u05d5\u05db\u05e0\u05df",
  statusActive: "\u05e4\u05e2\u05d9\u05dc",
  statusOnHold: "\u05d1\u05d4\u05de\u05ea\u05e0\u05d4",
  statusCompleted: "\u05d4\u05d5\u05e9\u05dc\u05dd",
  statusCancelled: "\u05d1\u05d5\u05d8\u05dc",
  basePrice: "\u05de\u05d7\u05d9\u05e8 \u05d1\u05e1\u05d9\u05e1",
  projectManager: "\u05de\u05e0\u05d4\u05dc \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  unassigned: "\u05dc\u05dc\u05d0 \u05e9\u05d9\u05d5\u05da",
  startDate: "\u05ea\u05d0\u05e8\u05d9\u05da \u05d4\u05ea\u05d7\u05dc\u05d4",
  endDate: "\u05ea\u05d0\u05e8\u05d9\u05da \u05e1\u05d9\u05d5\u05dd",
  notes: "\u05d4\u05e2\u05e8\u05d5\u05ea",
  saveProject: "\u05e9\u05de\u05d9\u05e8\u05ea \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  projectRequired:
    "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05dc\u05e7\u05d5\u05d7 \u05d5\u05dc\u05de\u05dc\u05d0 \u05e9\u05dd \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8.",
  projectCreateFailed: "\u05d9\u05e6\u05d9\u05e8\u05ea \u05d4\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e0\u05db\u05e9\u05dc\u05d4.",
  projectSaved: "\u05d4\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e0\u05e9\u05de\u05e8",
  taskNew: "\u05de\u05e9\u05d9\u05de\u05d4 \u05d7\u05d3\u05e9\u05d4",
  taskQuickAssign:
    "\u05e9\u05d9\u05d5\u05da \u05de\u05d4\u05d9\u05e8 \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e7\u05d9\u05d9\u05dd",
  taskDialogDescription:
    "\u05e4\u05ea\u05d9\u05d7\u05d4 \u05de\u05d4\u05d9\u05e8\u05d4 \u05e9\u05dc \u05de\u05e9\u05d9\u05de\u05d4 \u05d5\u05e9\u05d9\u05d5\u05da \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e7\u05d9\u05d9\u05dd.",
  project: "\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  subject: "\u05e0\u05d5\u05e9\u05d0",
  dueDate: "\u05ea\u05d0\u05e8\u05d9\u05da \u05d9\u05e2\u05d3",
  assignee: "\u05d0\u05d7\u05e8\u05d0\u05d9",
  selectAssignee: "\u05d1\u05d7\u05e8\u05d5 \u05d0\u05d7\u05e8\u05d0\u05d9",
  saveTask: "\u05e9\u05de\u05d9\u05e8\u05ea \u05de\u05e9\u05d9\u05de\u05d4",
  taskRequired:
    "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8, \u05d0\u05d7\u05e8\u05d0\u05d9, \u05ea\u05d0\u05e8\u05d9\u05da \u05d9\u05e2\u05d3 \u05d5\u05e0\u05d5\u05e9\u05d0.",
  taskCreateFailed: "\u05d9\u05e6\u05d9\u05e8\u05ea \u05d4\u05de\u05e9\u05d9\u05de\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4.",
  taskSaved: "\u05d4\u05de\u05e9\u05d9\u05de\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4",
  thisWeek: "\u05de\u05d4 \u05d9\u05e9 \u05d4\u05e9\u05d1\u05d5\u05e2",
  thisWeekOpen:
    "\u05de\u05e2\u05d1\u05e8 \u05de\u05d4\u05d9\u05e8 \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8\u05d9\u05dd \u05d5\u05dc\u05e2\u05d1\u05d5\u05d3\u05d4 \u05d4\u05e7\u05e8\u05d5\u05d1\u05d4",
  ordersByCity: "\u05d0\u05e1\u05e4\u05e7\u05ea \u05d4\u05d6\u05de\u05e0\u05d4",
  ordersByCityOpen:
    "\u05de\u05e2\u05d1\u05e8 \u05dc\u05e8\u05e9\u05d9\u05de\u05ea \u05de\u05e9\u05dc\u05d5\u05d7\u05d9\u05dd \u05db\u05d3\u05d9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05d4\u05d6\u05de\u05e0\u05d4 \u05dc\u05d0\u05d9\u05e9\u05d5\u05e8",
  expenseNew: "\u05d4\u05d5\u05e6\u05d0\u05d4 \u05d7\u05d3\u05e9\u05d4",
  expenseQuickRegister: "\u05e8\u05d9\u05e9\u05d5\u05dd \u05d4\u05d5\u05e6\u05d0\u05d4 \u05dc\u05e4\u05d9 \u05ea\u05d7\u05d5\u05dd",
  expenseDialogDescription:
    "\u05e8\u05d9\u05e9\u05d5\u05dd \u05d4\u05d5\u05e6\u05d0\u05d4 \u05d7\u05d3\u05e9\u05d4 \u05dc\u05e4\u05d9 \u05ea\u05d7\u05d5\u05dd, \u05e2\u05dd \u05e9\u05d9\u05d5\u05da \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8, \u05d4\u05d6\u05de\u05e0\u05d4 \u05d0\u05d5 \u05e0\u05db\u05e1 \u05dc\u05e4\u05d9 \u05d4\u05e6\u05d5\u05e8\u05da.",
  amount: "\u05e1\u05db\u05d5\u05dd",
  date: "\u05ea\u05d0\u05e8\u05d9\u05da",
  category: "\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4",
  selectCategory: "\u05d1\u05d7\u05e8\u05d5 \u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4",
  otherCategoryPrompt: "\u05de\u05d4 \u05d4\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4?",
  description: "\u05ea\u05d9\u05d0\u05d5\u05e8",
  includedInBase: "\u05e0\u05db\u05dc\u05dc \u05d1\u05d1\u05e1\u05d9\u05e1",
  billedToCustomer: "\u05dc\u05d7\u05d9\u05d5\u05d1 \u05dc\u05e7\u05d5\u05d7",
  includesVat: "\u05db\u05d5\u05dc\u05dc \u05de\u05e2\u05f4\u05de 18%",
  saveExpense: "\u05e9\u05de\u05d9\u05e8\u05ea \u05d4\u05d5\u05e6\u05d0\u05d4",
  expenseRequired:
    "\u05d9\u05e9 \u05dc\u05de\u05dc\u05d0 \u05d0\u05ea \u05db\u05dc \u05e9\u05d3\u05d5\u05ea \u05d4\u05d7\u05d5\u05d1\u05d4.",
  expenseInvalidAmount: "\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05e1\u05db\u05d5\u05dd \u05d4\u05d5\u05e6\u05d0\u05d4 \u05ea\u05e7\u05d9\u05df.",
  expenseCreateFailed: "\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05d4\u05d5\u05e6\u05d0\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4.",
  expenseSaved: "\u05d4\u05d4\u05d5\u05e6\u05d0\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4",
  incomeNew: "\u05d4\u05db\u05e0\u05e1\u05d4 \u05d7\u05d3\u05e9\u05d4",
  incomeQuickRegister: "\u05e8\u05d9\u05e9\u05d5\u05dd \u05ea\u05e9\u05dc\u05d5\u05dd \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  incomeDialogDescription:
    "\u05e8\u05d9\u05e9\u05d5\u05dd \u05d4\u05db\u05e0\u05e1\u05d4 \u05d7\u05d3\u05e9\u05d4 \u05db\u05ea\u05e9\u05dc\u05d5\u05dd \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8.",
  paymentMethod: "\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd",
  paymentDueDate: "\u05ea\u05d0\u05e8\u05d9\u05da \u05e4\u05d9\u05e8\u05e2\u05d5\u05df",
  bankTransfer: "\u05d4\u05e2\u05d1\u05e8\u05d4 \u05d1\u05e0\u05e7\u05d0\u05d9\u05ea",
  cash: "\u05de\u05d6\u05d5\u05de\u05df",
  check: "\u05e6'\u05e7",
  creditCard: "\u05db\u05e8\u05d8\u05d9\u05e1 \u05d0\u05e9\u05e8\u05d0\u05d9",
  other: "\u05d0\u05d7\u05e8",
  reference: "\u05d0\u05e1\u05de\u05db\u05ea\u05d0",
  saveIncome: "\u05e9\u05de\u05d9\u05e8\u05ea \u05d4\u05db\u05e0\u05e1\u05d4",
  incomeRequired:
    "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8, \u05ea\u05d0\u05e8\u05d9\u05da \u05d5\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd.",
  incomeInvalidAmount: "\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05e1\u05db\u05d5\u05dd \u05d4\u05db\u05e0\u05e1\u05d4 \u05ea\u05e7\u05d9\u05df.",
  incomeCreateFailed: "\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05d4\u05db\u05e0\u05e1\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4.",
  incomeSaved: "\u05d4\u05d4\u05db\u05e0\u05e1\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4",
  selfSessionStart: "\u05e4\u05ea\u05d9\u05d7\u05ea \u05de\u05e9\u05de\u05e8\u05ea",
  selfSessionHint: "\u05e4\u05ea\u05d9\u05d7\u05d4 \u05de\u05d9\u05d9\u05d3\u05d9\u05ea \u05dc\u05e2\u05e6\u05de\u05da",
  selfSessionOpenExists: "\u05db\u05d1\u05e8 \u05d9\u05e9 \u05de\u05e9\u05de\u05e8\u05ea \u05e4\u05ea\u05d5\u05d7\u05d4",
  selfSessionStarted: "\u05d4\u05de\u05e9\u05de\u05e8\u05ea \u05e0\u05e4\u05ea\u05d7\u05d4",
  selfSessionStartFailed: "\u05e4\u05ea\u05d9\u05d7\u05ea \u05d4\u05de\u05e9\u05de\u05e8\u05ea \u05e0\u05db\u05e9\u05dc\u05d4.",
  manualSessionNew: "\u05d4\u05d5\u05e1\u05e4\u05ea \u05de\u05e9\u05de\u05e8\u05ea \u05d9\u05d3\u05e0\u05d9\u05ea",
  manualSessionHint: "\u05e8\u05d9\u05e9\u05d5\u05dd \u05de\u05e9\u05de\u05e8\u05ea \u05e1\u05d2\u05d5\u05e8\u05d4 \u05de\u05d4\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3",
  manualSessionDescription:
    "\u05d4\u05d6\u05e0\u05ea \u05de\u05e9\u05de\u05e8\u05ea \u05d9\u05d3\u05e0\u05d9\u05ea \u05e2\u05dd \u05e9\u05e2\u05ea \u05d4\u05ea\u05d7\u05dc\u05d4 \u05d5\u05e1\u05d9\u05d5\u05dd.",
  worker: "\u05e2\u05d5\u05d1\u05d3",
  selectWorker: "\u05d1\u05d7\u05e8\u05d5 \u05e2\u05d5\u05d1\u05d3",
  domain: "\u05ea\u05d7\u05d5\u05dd",
  clockIn: "\u05e9\u05e2\u05ea \u05d4\u05ea\u05d7\u05dc\u05d4",
  totalHours: "\u05e1\u05d4\u05f4\u05db \u05e9\u05e2\u05d5\u05ea",
  clockOut: "\u05e9\u05e2\u05ea \u05e1\u05d9\u05d5\u05dd",
  saveManualSession: "\u05e9\u05de\u05d9\u05e8\u05ea \u05de\u05e9\u05de\u05e8\u05ea",
  manualSessionSaved: "\u05d4\u05de\u05e9\u05de\u05e8\u05ea \u05e0\u05e9\u05de\u05e8\u05d4",
  manualSessionFailed: "\u05e9\u05de\u05d9\u05e8\u05ea \u05d4\u05de\u05e9\u05de\u05e8\u05ea \u05e0\u05db\u05e9\u05dc\u05d4.",
  sessionInvalidWorker: "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e2\u05d5\u05d1\u05d3.",
  sessionInvalidProject: "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05dc\u05ea\u05d7\u05d5\u05dd \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8\u05d9\u05dd.",
  sessionInvalidProperty: "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e0\u05db\u05e1 \u05dc\u05ea\u05d7\u05d5\u05dd \u05e0\u05d9\u05d4\u05d5\u05dc \u05e0\u05db\u05e1\u05d9\u05dd.",
  sessionInvalidTimes: "\u05e9\u05e2\u05ea \u05d4\u05e1\u05d9\u05d5\u05dd \u05d7\u05d9\u05d9\u05d1\u05ea \u05dc\u05d4\u05d9\u05d5\u05ea \u05d0\u05d7\u05e8\u05d9 \u05e9\u05e2\u05ea \u05d4\u05d4\u05ea\u05d7\u05dc\u05d4.",
} as const;

export default function DashboardActions({
  customers,
  products,
  projects,
  orders,
  properties,
  users,
  currentUserId,
  currentUserRole,
  currentOpenSession,
  salaryAgreements,
  scheduleEntries,
  todayIso,
}: {
  customers: Row[];
  products: Row[];
  projects: ProjectOption[];
  orders: EntityOption[];
  properties: EntityOption[];
  users: UserOption[];
  currentUserId?: string;
  currentUserRole?: UserRole;
  currentOpenSession?: OpenSessionInfo | null;
  salaryAgreements: SalaryAgreementRow[];
  scheduleEntries: CalendarEntry[];
  todayIso: string;
}) {
  const router = useRouter();

  const [orderActionLocked, setOrderActionLocked] = useState(false);

  const [weekOverviewOpen, setWeekOverviewOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [manualSessionOpen, setManualSessionOpen] = useState(false);

  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectCustomerId, setProjectCustomerId] = useState("");
  const [projectType, setProjectType] = useState("logistics");
  const [projectStatus, setProjectStatus] = useState("planned");
  const [projectPrice, setProjectPrice] = useState("");
  const [projectManagerId, setProjectManagerId] = useState(currentUserId ?? "");
  const [projectStartDate, setProjectStartDate] = useState(getTodayDate());
  const [projectEndDate, setProjectEndDate] = useState(nextMonth(getTodayDate()));
  const [projectNotes, setProjectNotes] = useState("");

  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskProjectId, setTaskProjectId] = useState(projects[0]?.id ?? "");
  const [taskSubject, setTaskSubject] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDueDate, setTaskDueDate] = useState(getTodayDate());
  const [taskAssignedUserId, setTaskAssignedUserId] = useState(currentUserId ?? "");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskStatus, setTaskStatus] = useState("todo");

  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseBusinessDomain, setExpenseBusinessDomain] = useState<ExpenseBusinessDomain>("logistics_projects");
  const [expenseProjectId, setExpenseProjectId] = useState(projects[0]?.id ?? "");
  const [expenseOrderId, setExpenseOrderId] = useState("");
  const [expensePropertyId, setExpensePropertyId] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [expenseCategoryOther, setExpenseCategoryOther] = useState("");
  const [expenseDate, setExpenseDate] = useState(getTodayDate());
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [expenseIncludedInBase, setExpenseIncludedInBase] = useState(false);
  const [expenseBilledToCustomer, setExpenseBilledToCustomer] = useState(false);
  const [expenseWorkerUserId, setExpenseWorkerUserId] = useState("");
  const [expenseClockIn, setExpenseClockIn] = useState(nowLocal(-60));
  const [expenseClockOut, setExpenseClockOut] = useState(nowLocal());
  const [expenseLaborCost, setExpenseLaborCost] = useState("");
  const [expenseWorkerPaymentChoice, setExpenseWorkerPaymentChoice] = useState<PaymentChoice>("none");
  const [expenseWorkerPaidAmount, setExpenseWorkerPaidAmount] = useState("");
  const [expenseBillToCustomerAmount, setExpenseBillToCustomerAmount] = useState("");
  const [expenseAttachmentFiles, setExpenseAttachmentFiles] = useState<File[]>([]);
  const [expenseExistingAttachments, setExpenseExistingAttachments] = useState<FinancialAttachment[]>([]);

  const [incomeSubmitting, setIncomeSubmitting] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [incomeProjectId, setIncomeProjectId] = useState(projects[0]?.id ?? "");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState(getTodayDate());
  const [incomeMethod, setIncomeMethod] = useState("bank_transfer");
  const [incomeDueDate, setIncomeDueDate] = useState("");
  const [incomeRequiresSplit, setIncomeRequiresSplit] = useState(false);
  const [incomeReference, setIncomeReference] = useState("");
  const [incomeNotes, setIncomeNotes] = useState("");
  const [incomeAttachmentFiles, setIncomeAttachmentFiles] = useState<File[]>([]);
  const [incomeExistingAttachments, setIncomeExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [selfSessionSubmitting, setSelfSessionSubmitting] = useState(false);
  const [manualSessionSubmitting, setManualSessionSubmitting] = useState(false);
  const today = useMemo(() => toDateOnly(todayIso) ?? new Date(), [todayIso]);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const [manualSessionError, setManualSessionError] = useState<string | null>(null);
  const [manualSessionUserId, setManualSessionUserId] = useState("");
  const [manualSessionDomain, setManualSessionDomain] = useState<ExpenseBusinessDomain>("general_business");
  const [manualSessionProjectId, setManualSessionProjectId] = useState("");
  const [manualSessionPropertyId, setManualSessionPropertyId] = useState("");
  const [manualSessionNotes, setManualSessionNotes] = useState("");
  const [manualSessionClockIn, setManualSessionClockIn] = useState(nowLocal(-60));
  const [manualSessionClockOut, setManualSessionClockOut] = useState(nowLocal());
  const [manualSessionLaborCost, setManualSessionLaborCost] = useState("");
  const [manualSessionPaymentChoice, setManualSessionPaymentChoice] = useState<PaymentChoice>("none");
  const [manualSessionPaidAmount, setManualSessionPaidAmount] = useState("");

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const weeklyBuckets = useMemo(() => {
    return Array.from({ length: 7 }).map((_, index) => {
      const day = addDays(weekStart, index);
      const entries = scheduleEntries.filter((entry) => {
        const start = toDateOnly(entry.startDate);
        const end = toDateOnly(entry.endDate) ?? start;
        if (!start || !end) return false;
        return isWithinDayRange(day, start, end);
      });
      return {
        day,
        entries,
      };
    });
  }, [scheduleEntries, weekStart]);
  const weeklyEntryCount = useMemo(
    () => weeklyBuckets.reduce((sum, bucket) => sum + bucket.entries.length, 0),
    [weeklyBuckets]
  );
  const workerUsers = useMemo(
    () => users.filter((user) => user.role === "worker" || user.role === "worker_no_access"),
    [users]
  );
  const canManageWorkerSessions = currentUserRole === "admin";
  const manualSessionTargetId = canManageWorkerSessions ? manualSessionUserId : currentUserId ?? "";
  const manualSessionDuration = useMemo(
    () => durationHours(manualSessionClockIn, manualSessionClockOut),
    [manualSessionClockIn, manualSessionClockOut]
  );
  const manualSessionWorkedMinutes = useMemo(() => {
    const start = new Date(manualSessionClockIn).getTime();
    const end = new Date(manualSessionClockOut).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }, [manualSessionClockIn, manualSessionClockOut]);
  const activeManualSessionAgreement = useMemo(() => {
    if (!manualSessionTargetId) return null;
    const referenceDate = toIso(manualSessionClockIn);
    if (!referenceDate) return null;
    return getActiveSalaryAgreementForDate(
      salaryAgreements.filter((agreement) => agreement.user_id === manualSessionTargetId),
      new Date(referenceDate)
    );
  }, [manualSessionClockIn, manualSessionTargetId, salaryAgreements]);
  const suggestedManualSessionAmount = useMemo(() => {
    if (manualSessionLaborCost.trim()) {
      const parsed = Number(manualSessionLaborCost);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (manualSessionWorkedMinutes <= 0) return null;
    return calculateSessionLaborCost(activeManualSessionAgreement, manualSessionWorkedMinutes);
  }, [activeManualSessionAgreement, manualSessionLaborCost, manualSessionWorkedMinutes]);

  useEffect(() => {
    if (!canManageWorkerSessions || manualSessionPaymentChoice === "none" || suggestedManualSessionAmount === null) return;
    setManualSessionPaidAmount((current) => {
      if (manualSessionPaymentChoice === "paid") {
        return String(Number(suggestedManualSessionAmount.toFixed(2)));
      }
      return current.trim()
        ? current
        : String(Number(suggestedManualSessionAmount.toFixed(2)));
    });
  }, [canManageWorkerSessions, manualSessionPaymentChoice, suggestedManualSessionAmount]);

  const finalExpenseCategory =
    expenseCategory === OTHER_EXPENSE_CATEGORY ? expenseCategoryOther.trim() : expenseCategory.trim();
  const expenseIsWorkerPayment = finalExpenseCategory === EMPLOYEE_WAGE_CATEGORY;
  const expenseTargetUserId = canManageWorkerSessions ? expenseWorkerUserId : currentUserId ?? "";
  const expenseDuration = useMemo(
    () => durationHours(expenseClockIn, expenseClockOut),
    [expenseClockIn, expenseClockOut]
  );
  const expenseWorkedMinutes = useMemo(() => {
    const start = new Date(expenseClockIn).getTime();
    const end = new Date(expenseClockOut).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }, [expenseClockIn, expenseClockOut]);
  const activeExpenseSessionAgreement = useMemo(() => {
    if (!expenseIsWorkerPayment || !expenseTargetUserId) return null;
    const referenceDate = toIso(expenseClockIn);
    if (!referenceDate) return null;
    return getActiveSalaryAgreementForDate(
      salaryAgreements.filter((agreement) => agreement.user_id === expenseTargetUserId),
      new Date(referenceDate)
    );
  }, [expenseClockIn, expenseIsWorkerPayment, expenseTargetUserId, salaryAgreements]);
  const suggestedExpenseWorkerAmount = useMemo(() => {
    if (!expenseIsWorkerPayment) return null;
    if (expenseLaborCost.trim()) {
      const parsed = Number(expenseLaborCost);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (expenseWorkedMinutes <= 0) return null;
    return calculateSessionLaborCost(activeExpenseSessionAgreement, expenseWorkedMinutes);
  }, [activeExpenseSessionAgreement, expenseIsWorkerPayment, expenseLaborCost, expenseWorkedMinutes]);

  useEffect(() => {
    if (!expenseIsWorkerPayment || !canManageWorkerSessions || expenseWorkerPaymentChoice === "none" || suggestedExpenseWorkerAmount === null) {
      return;
    }
    setExpenseWorkerPaidAmount((current) => {
      if (expenseWorkerPaymentChoice === "paid") {
        return String(Number(suggestedExpenseWorkerAmount.toFixed(2)));
      }
      return current.trim()
        ? current
        : String(Number(suggestedExpenseWorkerAmount.toFixed(2)));
    });
  }, [
    canManageWorkerSessions,
    expenseIsWorkerPayment,
    expenseWorkerPaymentChoice,
    suggestedExpenseWorkerAmount,
  ]);

  function resetProjectForm() {
    setProjectError(null);
    setProjectName("");
    setProjectCustomerId("");
    setProjectType("logistics");
    setProjectStatus("planned");
    setProjectPrice("");
    setProjectManagerId(currentUserId ?? "");
    setProjectStartDate(getTodayDate());
    setProjectEndDate(nextMonth(getTodayDate()));
    setProjectNotes("");
  }

  function resetTaskForm() {
    setTaskError(null);
    setTaskProjectId(projects[0]?.id ?? "");
    setTaskSubject("");
    setTaskDescription("");
    setTaskDueDate(getTodayDate());
    setTaskAssignedUserId(currentUserId ?? "");
    setTaskPriority("medium");
    setTaskStatus("todo");
  }

  function resetExpenseForm() {
    setExpenseError(null);
    setExpenseBusinessDomain("logistics_projects");
    setExpenseProjectId(projects[0]?.id ?? "");
    setExpenseOrderId("");
    setExpensePropertyId("");
    setExpenseAmount("");
    setExpenseCategory("");
    setExpenseCategoryOther("");
    setExpenseDate(getTodayDate());
    setExpenseDescription("");
    setExpenseNotes("");
    setExpenseIncludedInBase(false);
    setExpenseBilledToCustomer(false);
    setExpenseWorkerUserId(canManageWorkerSessions ? workerUsers[0]?.id ?? "" : currentUserId ?? "");
    setExpenseClockIn(nowLocal(-60));
    setExpenseClockOut(nowLocal());
    setExpenseLaborCost("");
    setExpenseWorkerPaymentChoice("none");
    setExpenseWorkerPaidAmount("");
    setExpenseBillToCustomerAmount("");
    setExpenseAttachmentFiles([]);
    setExpenseExistingAttachments([]);
  }

  function resetIncomeForm() {
    setIncomeError(null);
    setIncomeProjectId(projects[0]?.id ?? "");
    setIncomeAmount("");
    setIncomeDate(getTodayDate());
    setIncomeMethod("bank_transfer");
    setIncomeDueDate("");
    setIncomeRequiresSplit(false);
    setIncomeReference("");
    setIncomeNotes("");
    setIncomeAttachmentFiles([]);
    setIncomeExistingAttachments([]);
  }

  function resetManualSessionForm() {
    setManualSessionError(null);
    setManualSessionUserId(canManageWorkerSessions ? workerUsers[0]?.id ?? "" : currentUserId ?? "");
    setManualSessionDomain("general_business");
    setManualSessionProjectId("");
    setManualSessionPropertyId("");
    setManualSessionNotes("");
    setManualSessionClockIn(nowLocal(-60));
    setManualSessionClockOut(nowLocal());
    setManualSessionLaborCost("");
    setManualSessionPaymentChoice("none");
    setManualSessionPaidAmount("");
  }

  async function createProject() {
    setProjectError(null);
    if (!projectName.trim() || !projectCustomerId) {
      setProjectError(HEBREW.projectRequired);
      return;
    }

    setProjectSubmitting(true);
    try {
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: projectCustomerId,
          name: projectName.trim(),
          project_type: projectType,
          status: projectStatus,
          agreed_base_price: projectPrice.trim() ? Number(projectPrice) : 0,
          actual_price: projectPrice.trim() ? Number(projectPrice) : 0,
          project_manager_id: projectManagerId || null,
          start_date: projectStartDate || null,
          end_date: projectEndDate || null,
          notes: projectNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; project?: Row };
      if (!res.ok || !json.project) {
        setProjectError(json.error ?? HEBREW.projectCreateFailed);
        return;
      }

      setProjectOpen(false);
      resetProjectForm();
      router.refresh();
      toast.success(HEBREW.projectSaved);
    } catch (error: unknown) {
      setProjectError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
    } finally {
      setProjectSubmitting(false);
    }
  }

  async function createTask() {
    setTaskError(null);
    const selectedProject = projectById.get(taskProjectId);
    if (!selectedProject || !taskSubject.trim() || !taskAssignedUserId || !taskDueDate) {
      setTaskError(HEBREW.taskRequired);
      return;
    }

    setTaskSubmitting(true);
    try {
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: mapProjectTypeToExpenseDomain(selectedProject.type),
          project_id: selectedProject.id,
          subject: taskSubject.trim(),
          description: taskDescription.trim() || null,
          due_date: taskDueDate,
          assigned_user_id: taskAssignedUserId,
          priority: taskPriority,
          status: taskStatus,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; task?: Row };
      if (!res.ok || !json.task) {
        setTaskError(json.error ?? HEBREW.taskCreateFailed);
        return;
      }

      setTaskOpen(false);
      resetTaskForm();
      router.refresh();
      toast.success(HEBREW.taskSaved);
    } catch (error: unknown) {
      setTaskError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function createExpense() {
    setExpenseError(null);
    const linkedProjectId = expenseBusinessDomain === "logistics_projects" ? expenseProjectId : "";
    const linkedOrderId = expenseBusinessDomain === "sales" ? expenseOrderId : "";
    const linkedPropertyId = expenseBusinessDomain === "property_management" ? expensePropertyId : "";

    if (!finalExpenseCategory) {
      setExpenseError(HEBREW.expenseRequired);
      return;
    }
    if (expenseBusinessDomain === "logistics_projects" && !linkedProjectId) {
      setExpenseError(HEBREW.sessionInvalidProject);
      return;
    }
    if (expenseBusinessDomain === "property_management" && !linkedPropertyId) {
      setExpenseError(HEBREW.sessionInvalidProperty);
      return;
    }

    if (expenseIsWorkerPayment) {
      if (!expenseTargetUserId) {
        setExpenseError(HEBREW.sessionInvalidWorker);
        return;
      }

      const clockInIso = toIso(expenseClockIn);
      const clockOutIso = toIso(expenseClockOut);
      if (!clockInIso || !clockOutIso || new Date(clockOutIso) <= new Date(clockInIso)) {
        setExpenseError(HEBREW.sessionInvalidTimes);
        return;
      }

      const laborCostNumber =
        expenseLaborCost.trim() === "" ? null : Number(expenseLaborCost);
      if (
        expenseLaborCost.trim() !== "" &&
        (laborCostNumber === null || !Number.isFinite(laborCostNumber) || laborCostNumber <= 0)
      ) {
        setExpenseError("יש להזין עלות עבודה תקינה.");
        return;
      }

      const workerPaidAmountNumber =
        expenseWorkerPaymentChoice === "none" || !expenseWorkerPaidAmount.trim()
          ? suggestedExpenseWorkerAmount
          : Number(expenseWorkerPaidAmount);
      if (
        canManageWorkerSessions &&
        expenseWorkerPaymentChoice !== "none" &&
        (!Number.isFinite(workerPaidAmountNumber) || workerPaidAmountNumber === null || workerPaidAmountNumber <= 0)
      ) {
        setExpenseError("יש להזין סכום ששולם לעובד.");
        return;
      }

      const billToCustomerAmountNumber =
        !expenseBilledToCustomer || !expenseBillToCustomerAmount.trim()
          ? null
          : Number(expenseBillToCustomerAmount);
      if (
        expenseBilledToCustomer &&
        (!Number.isFinite(billToCustomerAmountNumber) || billToCustomerAmountNumber === null || billToCustomerAmountNumber <= 0)
      ) {
        setExpenseError("יש להזין סכום לחיוב לקוח.");
        return;
      }

      setExpenseSubmitting(true);
      try {
        const endpoint = canManageWorkerSessions ? "/api/payroll/sessions/create" : "/api/profile/session/create";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_id: expenseTargetUserId,
            business_domain: expenseBusinessDomain,
            project_id: linkedProjectId || null,
            property_id: linkedPropertyId || null,
            notes: expenseNotes.trim() || null,
            clock_in: clockInIso,
            clock_out: clockOutIso,
            labor_cost: laborCostNumber,
            is_billable_to_customer: expenseBilledToCustomer,
            bill_to_customer_amount: expenseBilledToCustomer ? billToCustomerAmountNumber : null,
            billing_status: expenseBilledToCustomer ? "billable" : "not_billable",
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          session?: { id?: string; user_id?: string; clock_in?: string; clock_out?: string; labor_cost?: number | string | null };
        };
        if (!res.ok || !json.session) {
          setExpenseError(json.error ?? HEBREW.expenseCreateFailed);
          return;
        }

        if (
          canManageWorkerSessions &&
          expenseWorkerPaymentChoice !== "none" &&
          json.session.id &&
          json.session.user_id &&
          Number.isFinite(workerPaidAmountNumber) &&
          workerPaidAmountNumber !== null &&
          workerPaidAmountNumber > 0
        ) {
          const paymentDateSource = json.session.clock_out || json.session.clock_in || new Date().toISOString();
          const paymentResponse = await fetch("/api/payroll/worker-payments", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              user_id: json.session.user_id,
              payment_date: paymentDateSource.slice(0, 10),
              amount: workerPaidAmountNumber,
              payment_method: null,
              reference_number: null,
              notes: `תשלום שסומן מתוך הדשבורד עבור משמרת ${paymentDateSource.slice(0, 10)}`,
              allocations: [
                {
                  source_type: "session",
                  source_id: json.session.id,
                  amount: workerPaidAmountNumber,
                },
              ],
            }),
          });
          const paymentJson = (await paymentResponse.json().catch(() => ({}))) as { error?: string };
          if (!paymentResponse.ok) {
            throw new Error(paymentJson.error ?? "שמירת התשלום לעובד נכשלה.");
          }
        }

        const sessionId = typeof json.session.id === "string" ? json.session.id : "";
        for (const file of expenseAttachmentFiles) {
          if (!sessionId) break;
          await uploadFinancialAttachment("session", sessionId, file);
        }

        setExpenseOpen(false);
        resetExpenseForm();
        router.refresh();
        toast.success(
          canManageWorkerSessions && expenseWorkerPaymentChoice !== "none"
            ? "הוצאות השכר נשמרו והתשלום לעובד נרשם."
            : HEBREW.expenseSaved
        );
      } catch (error: unknown) {
        setExpenseError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
      } finally {
        setExpenseSubmitting(false);
      }
      return;
    }

    if (!expenseDate) {
      setExpenseError(HEBREW.expenseRequired);
      return;
    }

    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setExpenseError(HEBREW.expenseInvalidAmount);
      return;
    }

    setExpenseSubmitting(true);
    try {
      const res = await fetch("/api/expenses/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: expenseBusinessDomain,
          project_id: linkedProjectId || null,
          order_id: linkedOrderId || null,
          property_id: linkedPropertyId || null,
          amount,
          category: finalExpenseCategory,
          expense_date: expenseDate,
          description: expenseDescription.trim() || null,
          notes: expenseNotes.trim() || null,
          included_in_base_price: expenseBusinessDomain === "logistics_projects" ? expenseIncludedInBase : false,
          billed_to_customer: expenseBusinessDomain === "logistics_projects" ? expenseBilledToCustomer : false,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; expense?: Row };
      if (!res.ok || !json.expense) {
        setExpenseError(json.error ?? HEBREW.expenseCreateFailed);
        return;
      }

      const expenseId = getString(json.expense, "id");
      for (const file of expenseAttachmentFiles) {
        if (!expenseId) break;
        await uploadFinancialAttachment("expense", expenseId, file);
      }

      setExpenseOpen(false);
      resetExpenseForm();
      router.refresh();
      toast.success(HEBREW.expenseSaved);
    } catch (error: unknown) {
      setExpenseError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
    } finally {
      setExpenseSubmitting(false);
    }
  }

  async function createIncome() {
    setIncomeError(null);
    if (!incomeProjectId || !incomeDate || !incomeMethod.trim()) {
      setIncomeError(HEBREW.incomeRequired);
      return;
    }
    if (incomeMethod === "check" && !incomeDueDate) {
      setIncomeError(`${HEBREW.incomeRequired} (${HEBREW.paymentDueDate})`);
      return;
    }

    const amount = Number(incomeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setIncomeError(HEBREW.incomeInvalidAmount);
      return;
    }

    setIncomeSubmitting(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: mapProjectTypeToExpenseDomain(projectById.get(incomeProjectId)?.type ?? null),
          project_id: incomeProjectId,
          amount_total: amount,
          payment_date: incomeDate,
          due_date: incomeMethod === "check" ? incomeDueDate : null,
          requires_split: incomeRequiresSplit,
          payment_method: incomeMethod,
          reference_number: incomeReference.trim() || null,
          notes: incomeNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; payment?: Row };
      if (!res.ok || !json.payment) {
        setIncomeError(json.error ?? HEBREW.incomeCreateFailed);
        return;
      }

      const paymentId = getString(json.payment, "id");
      for (const file of incomeAttachmentFiles) {
        if (!paymentId) break;
        await uploadFinancialAttachment("payment", paymentId, file);
      }

      setIncomeOpen(false);
      resetIncomeForm();
      router.refresh();
      toast.success(HEBREW.incomeSaved);
    } catch (error: unknown) {
      setIncomeError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
    } finally {
      setIncomeSubmitting(false);
    }
  }

  function validateSessionDomain(domain: ExpenseBusinessDomain, projectId: string, propertyId: string) {
    if (domain === "logistics_projects" && !projectId) return HEBREW.sessionInvalidProject;
    if (domain === "property_management" && !propertyId) return HEBREW.sessionInvalidProperty;
    return "";
  }

  async function startOwnSession() {
    if (!currentUserId || currentOpenSession?.id || selfSessionSubmitting) return;

    setSelfSessionSubmitting(true);
    try {
      const res = await fetch("/api/profile/session/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: null }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(HEBREW.selfSessionStartFailed, {
          description: json.error ?? HEBREW.saveErrorUnknown,
        });
        return;
      }

      toast.success(HEBREW.selfSessionStarted);
      router.refresh();
    } catch (error: unknown) {
      toast.error(HEBREW.selfSessionStartFailed, {
        description: error instanceof Error ? error.message : HEBREW.saveErrorUnknown,
      });
    } finally {
      setSelfSessionSubmitting(false);
    }
  }

  async function saveManualSession() {
    setManualSessionError(null);
    if (!manualSessionTargetId) {
      setManualSessionError(HEBREW.sessionInvalidWorker);
      return;
    }
    const domainError = validateSessionDomain(
      manualSessionDomain,
      manualSessionProjectId,
      manualSessionPropertyId
    );
    if (domainError) {
      setManualSessionError(domainError);
      return;
    }

    const clockInIso = toIso(manualSessionClockIn);
    const clockOutIso = toIso(manualSessionClockOut);
    if (!clockInIso || !clockOutIso || new Date(clockOutIso) <= new Date(clockInIso)) {
      setManualSessionError(HEBREW.sessionInvalidTimes);
      return;
    }
    const laborCostNumber =
      manualSessionLaborCost.trim() === ""
        ? null
        : Number(manualSessionLaborCost);
    if (
      manualSessionLaborCost.trim() !== "" &&
      (laborCostNumber === null || !Number.isFinite(laborCostNumber) || laborCostNumber <= 0)
    ) {
      setManualSessionError("יש להזין עלות עבודה תקינה.");
      return;
    }
    const paidAmountNumber =
      manualSessionPaymentChoice === "none" || !manualSessionPaidAmount.trim()
        ? suggestedManualSessionAmount
        : Number(manualSessionPaidAmount);
    if (
      canManageWorkerSessions &&
      manualSessionPaymentChoice !== "none" &&
      (!Number.isFinite(paidAmountNumber) || paidAmountNumber === null || paidAmountNumber <= 0)
    ) {
      setManualSessionError("יש להזין סכום ששולם לעובד.");
      return;
    }

    setManualSessionSubmitting(true);
    try {
      const endpoint = canManageWorkerSessions ? "/api/payroll/sessions/create" : "/api/profile/session/create";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: manualSessionTargetId,
          business_domain: manualSessionDomain,
          project_id: manualSessionDomain === "logistics_projects" ? manualSessionProjectId : null,
          property_id: manualSessionDomain === "property_management" ? manualSessionPropertyId : null,
          notes: manualSessionNotes.trim() || null,
          clock_in: clockInIso,
          clock_out: clockOutIso,
          labor_cost: laborCostNumber,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; session?: { id?: string; user_id?: string; clock_in?: string; clock_out?: string; labor_cost?: number | string | null } };
      if (!res.ok || !json.session) {
        setManualSessionError(json.error ?? HEBREW.manualSessionFailed);
        return;
      }

      if (
        canManageWorkerSessions &&
        manualSessionPaymentChoice !== "none" &&
        json.session.id &&
        json.session.user_id &&
        Number.isFinite(paidAmountNumber) &&
        paidAmountNumber !== null &&
        paidAmountNumber > 0
      ) {
        const paymentDateSource = json.session.clock_out || json.session.clock_in || new Date().toISOString();
        await fetch("/api/payroll/worker-payments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user_id: json.session.user_id,
            payment_date: paymentDateSource.slice(0, 10),
            amount: paidAmountNumber,
            payment_method: null,
            reference_number: null,
            notes: `תשלום שסומן מתוך הדשבורד עבור משמרת ${paymentDateSource.slice(0, 10)}`,
            allocations: [
              {
                source_type: "session",
                source_id: json.session.id,
                amount: paidAmountNumber,
              },
            ],
          }),
        }).then(async (response) => {
          const paymentJson = (await response.json().catch(() => ({}))) as { error?: string };
          if (!response.ok) {
            throw new Error(paymentJson.error ?? "שמירת התשלום נכשלה.");
          }
        });
      }

      setManualSessionOpen(false);
      resetManualSessionForm();
      router.refresh();
      toast.success(
        canManageWorkerSessions && manualSessionPaymentChoice !== "none"
          ? "המשמרת נשמרה והתשלום נרשם."
          : HEBREW.manualSessionSaved
      );
    } catch (error: unknown) {
      setManualSessionError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
    } finally {
      setManualSessionSubmitting(false);
    }
  }

  return (
    <>
      <AdaptiveGrid variant="quickActions">
        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => void startOwnSession()}
          disabled={Boolean(currentOpenSession) || selfSessionSubmitting}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <PlayCircle className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.selfSessionStart}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => {
            resetManualSessionForm();
            setManualSessionOpen(true);
          }}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <Clock3 className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.manualSessionNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => {
            setOrderActionLocked(false);
            setOrderOpen(true);
          }}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ShoppingCart className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.orderNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => setProjectOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <FolderKanban className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.projectNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => setTaskOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ListTodo className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.taskNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => setWeekOverviewOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <FolderKanban className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.thisWeek}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => {
            emitNavigationStart();
            router.push("/sales?tab=deliveries");
          }}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ShoppingCart className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.ordersByCity}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => setExpenseOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ArrowDownCircle className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.expenseNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-20 flex-col items-start justify-between rounded-2xl p-3 text-right sm:h-24"
          onClick={() => setIncomeOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ArrowUpCircle className="h-5 w-5" />
          </span>
          <span className="font-semibold">{HEBREW.incomeNew}</span>
        </Button>
      </AdaptiveGrid>

      <Dialog open={weekOverviewOpen} onOpenChange={setWeekOverviewOpen}>
        <AdaptiveDialog size="form2xl">
          <DialogHeader className="text-right">
            <DialogTitle>{HEBREW.thisWeek}</DialogTitle>
            <DialogDescription>{`${formatWeekRangeLabel(weekStart, weekEnd)} • ${weeklyEntryCount} פריטים השבוע`}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {weeklyBuckets.map((bucket) => (
              <div key={bucket.day.toISOString()} className="rounded-2xl border p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">
                    {bucket.entries.length > 0 ? `${bucket.entries.length} פריטים` : "אין פריטים"}
                  </div>
                  <div className="flex items-center gap-2">
                    {isSameDay(bucket.day, today) ? <Badge variant="default">היום</Badge> : null}
                    <div className="font-semibold">{formatWeekDay(bucket.day)}</div>
                  </div>
                </div>

                {bucket.entries.length > 0 ? (
                  <div className="space-y-2">
                    {bucket.entries.map((entry) => (
                      <Link
                        key={`${entry.kind}-${entry.id}-${bucket.day.toISOString()}`}
                        href={entry.href}
                        onClick={() => setWeekOverviewOpen(false)}
                        className="block rounded-xl border bg-background p-3 transition hover:border-primary/40 hover:bg-primary/5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium">{entry.title}</div>
                            <Badge variant={entry.kind === "task" ? "warning" : "secondary"}>{entryTypeLabel(entry.kind)}</Badge>
                            {entry.priority ? <StatusBadge value={entry.priority} type="priority" /> : null}
                            {entry.status ? (
                              <StatusBadge value={entry.status} type={entry.kind === "task" ? "task" : "project"} />
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {entry.startDate === entry.endDate || !entry.endDate
                              ? entry.startDate ?? ""
                              : `${entry.startDate ?? ""} - ${entry.endDate}`}
                          </div>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">{entry.subtitle}</div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">אין פרויקטים או משימות ליום הזה.</div>
                )}
              </div>
            ))}
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={manualSessionOpen}
        onOpenChange={(open) => {
          if (!open && manualSessionSubmitting) return;
          setManualSessionOpen(open);
          if (!open) resetManualSessionForm();
        }}
      >
        <AdaptiveDialog size="form2xl">
          <DialogHeader className="text-right">
            <DialogTitle>{"הוספת משמרת"}</DialogTitle>
            <DialogDescription>{HEBREW.manualSessionDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={manualSessionSubmitting} className="contents">
            <div className="grid gap-3 md:grid-cols-2">
              {canManageWorkerSessions ? (
                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">{HEBREW.worker}</span>
                  <select
                    className={`${fieldClass} text-right`}
                    value={manualSessionUserId}
                    onChange={(e) => setManualSessionUserId(e.target.value)}
                  >
                    <option value="">{HEBREW.selectWorker}</option>
                    {workerUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="space-y-2 text-right text-sm">
                <span className="font-medium">{HEBREW.domain}</span>
                <select
                  className={`${fieldClass} text-right`}
                  value={manualSessionDomain}
                  onChange={(e) => {
                    const nextDomain = e.target.value as ExpenseBusinessDomain;
                    setManualSessionDomain(nextDomain);
                    if (nextDomain !== "logistics_projects") setManualSessionProjectId("");
                    if (nextDomain !== "property_management") setManualSessionPropertyId("");
                  }}
                >
                  {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                    <option key={domain} value={domain}>
                      {getBusinessDomainLabel(domain)}
                    </option>
                  ))}
                </select>
              </label>

              {manualSessionDomain === "logistics_projects" ? (
                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">{HEBREW.project}</span>
                  <select
                    className={`${fieldClass} text-right`}
                    value={manualSessionProjectId}
                    onChange={(e) => setManualSessionProjectId(e.target.value)}
                  >
                    <option value="">{HEBREW.selectProject}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {manualSessionDomain === "property_management" ? (
                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">נכס</span>
                  <select
                    className={`${fieldClass} text-right`}
                    value={manualSessionPropertyId}
                    onChange={(e) => setManualSessionPropertyId(e.target.value)}
                  >
                    <option value="">בחרו נכס</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="md:col-span-2 grid gap-3 md:grid-cols-3">
                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">כניסה</span>
                  <DateTimeInput
                    value={manualSessionClockIn}
                    onChange={(e) => setManualSessionClockIn(e.target.value)}
                  />
                </label>

                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">סה״כ שעות</span>
                  <Input
                    inputMode="decimal"
                    value={manualSessionDuration}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      if (!nextValue.trim()) {
                        setManualSessionClockOut("");
                        return;
                      }
                      const parsedHours = Number(nextValue);
                      const clockInIso = toIso(manualSessionClockIn);
                      if (!Number.isFinite(parsedHours) || parsedHours <= 0 || !clockInIso) return;
                      const nextClockOut = new Date(new Date(clockInIso).getTime() + parsedHours * 60 * 60 * 1000);
                      if (Number.isNaN(nextClockOut.getTime())) return;
                      const pad = (n: number) => String(n).padStart(2, "0");
                      setManualSessionClockOut(
                        `${nextClockOut.getFullYear()}-${pad(nextClockOut.getMonth() + 1)}-${pad(nextClockOut.getDate())}T${pad(nextClockOut.getHours())}:${pad(nextClockOut.getMinutes())}`
                      );
                    }}
                    placeholder="למשל 8"
                  />
                </label>

                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">יציאה</span>
                  <DateTimeInput
                    value={manualSessionClockOut}
                    onChange={(e) => setManualSessionClockOut(e.target.value)}
                  />
                </label>
              </div>

              <label className="space-y-2 text-right text-sm">
                <span className="font-medium">מחיר</span>
                <Input
                  inputMode="decimal"
                  value={manualSessionLaborCost}
                  onChange={(e) => setManualSessionLaborCost(e.target.value)}
                  placeholder="אופציונלי"
                />
                <span className="block text-xs text-muted-foreground">
                  {suggestedManualSessionAmount !== null
                    ? `סה״כ לתשלום עבור המשמרת: ${formatIls(suggestedManualSessionAmount)}`
                    : "הסכום שמגיע לעובד יוצג כאן אחרי הזנת שעות תקינות או עלות עבודה."}
                </span>
              </label>

              {canManageWorkerSessions ? (
                <>
                  <label className="space-y-2 text-right text-sm">
                    <span className="font-medium">שולם עכשיו</span>
                    <select
                      className={`${fieldClass} text-right`}
                      value={manualSessionPaymentChoice === "none" ? "no" : "yes"}
                      onChange={(e) => {
                        if (e.target.value === "no") {
                          setManualSessionPaymentChoice("none");
                          setManualSessionPaidAmount("");
                          return;
                        }
                        setManualSessionPaymentChoice("partial");
                      }}
                    >
                      <option value="no">לא</option>
                      <option value="yes">כן</option>
                    </select>
                  </label>

                  {manualSessionPaymentChoice !== "none" ? (
                    <label className="space-y-2 text-right text-sm">
                      <span className="font-medium">כמה שולם</span>
                      <Input
                        inputMode="decimal"
                        value={manualSessionPaidAmount}
                        onChange={(e) => setManualSessionPaidAmount(e.target.value)}
                        placeholder="אם ריק, יירשם מלוא סכום המשמרת"
                      />
                    </label>
                  ) : null}
                </>
              ) : null}

              <label className="space-y-2 text-right text-sm md:col-span-2">
                <span className="font-medium">{HEBREW.notes}</span>
                <Textarea
                  value={manualSessionNotes}
                  onChange={(e) => setManualSessionNotes(e.target.value)}
                  placeholder="הערות פנימיות..."
                />
              </label>
            </div>
          </fieldset>

          {manualSessionError ? <p className="text-sm text-destructive">{manualSessionError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setManualSessionOpen(false)} disabled={manualSessionSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void saveManualSession()} disabled={manualSessionSubmitting}>
              {manualSessionSubmitting ? HEBREW.saving : HEBREW.saveManualSession}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={orderOpen}
        onOpenChange={(open) => {
          if (!open && orderActionLocked) return;
          setOrderOpen(open);
        }}
      >
        <AdaptiveDialog size="newOrder">
          <DialogHeader>
            <DialogTitle>{HEBREW.orderNew}</DialogTitle>
            <DialogDescription>{HEBREW.orderDialogDescription}</DialogDescription>
          </DialogHeader>

          <NewOrderClient
            customers={customers}
            products={products}
            customersError={null}
            productsError={null}
            embedded
            onActionLockedChange={setOrderActionLocked}
            onCancel={() => {
              setOrderActionLocked(false);
              setOrderOpen(false);
            }}
            onSubmitted={() => {
              setOrderActionLocked(false);
              setOrderOpen(false);
              router.refresh();
              toast.success(HEBREW.orderSaved);
            }}
          />
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={projectOpen}
        onOpenChange={(open) => {
          if (!open && projectSubmitting) return;
          setProjectOpen(open);
          if (!open) resetProjectForm();
        }}
      >
        <AdaptiveDialog size="form2xl">
          <DialogHeader>
            <DialogTitle>{HEBREW.projectNew}</DialogTitle>
            <DialogDescription>{HEBREW.projectDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={projectSubmitting} className="contents">
            <AdaptiveGrid variant="formTwoLoose">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.projectName}</span>
                <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.customer}</span>
                <select
                  className={fieldClass}
                  value={projectCustomerId}
                  onChange={(e) => setProjectCustomerId(e.target.value)}
                >
                  <option value="">{HEBREW.selectCustomer}</option>
                  {customers.map((customer) => {
                    const id = getString(customer, "id");
                    const name =
                      getString(customer, "name") ||
                      getString(customer, "name_for_invoice") ||
                      HEBREW.customerFallback;
                    return (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.projectType}</span>
                <select
                  className={fieldClass}
                  value={projectType}
                  onChange={(e) => setProjectType(e.target.value)}
                >
                  <option value="logistics">{HEBREW.logistics}</option>
                  <option value="moving">{HEBREW.moving}</option>
                  <option value="construction">{HEBREW.construction}</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.status}</span>
                <select
                  className={fieldClass}
                  value={projectStatus}
                  onChange={(e) => setProjectStatus(e.target.value)}
                >
                  <option value="quote">{HEBREW.statusQuote}</option>
                  <option value="planned">{HEBREW.statusPlanned}</option>
                  <option value="active">{HEBREW.statusActive}</option>
                  <option value="on_hold">{HEBREW.statusOnHold}</option>
                  <option value="completed">{HEBREW.statusCompleted}</option>
                  <option value="cancelled">{HEBREW.statusCancelled}</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.basePrice}</span>
                <Input
                  type="number"
                  min="0"
                  value={projectPrice}
                  onChange={(e) => setProjectPrice(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.projectManager}</span>
                <select
                  className={fieldClass}
                  value={projectManagerId}
                  onChange={(e) => setProjectManagerId(e.target.value)}
                >
                  <option value="">{HEBREW.unassigned}</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.startDate}</span>
                <DateInput
                  value={projectStartDate}
                  onChange={(e) => setProjectStartDate(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.endDate}</span>
                <DateInput
                  value={projectEndDate}
                  onChange={(e) => setProjectEndDate(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm col-span-full">
                <span>{HEBREW.notes}</span>
                <Textarea value={projectNotes} onChange={(e) => setProjectNotes(e.target.value)} />
              </label>
            </AdaptiveGrid>
          </fieldset>

          {projectError ? <p className="text-sm text-destructive">{projectError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setProjectOpen(false)} disabled={projectSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createProject()} disabled={projectSubmitting}>
              {projectSubmitting ? HEBREW.saving : HEBREW.saveProject}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={taskOpen}
        onOpenChange={(open) => {
          if (!open && taskSubmitting) return;
          setTaskOpen(open);
          if (!open) resetTaskForm();
        }}
      >
        <AdaptiveDialog size="formXl">
          <DialogHeader>
            <DialogTitle>{HEBREW.taskNew}</DialogTitle>
            <DialogDescription>{HEBREW.taskDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={taskSubmitting} className="contents">
            <div className="grid gap-4">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.project}</span>
                <select
                  className={fieldClass}
                  value={taskProjectId}
                  onChange={(e) => setTaskProjectId(e.target.value)}
                >
                  <option value="">{HEBREW.selectProject}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} | {project.customerName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.subject}</span>
                <Input value={taskSubject} onChange={(e) => setTaskSubject(e.target.value)} />
              </label>

              <AdaptiveGrid variant="formTwoLoose">
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.dueDate}</span>
                  <DateInput
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span>{HEBREW.assignee}</span>
                  <select
                    className={fieldClass}
                    value={taskAssignedUserId}
                    onChange={(e) => setTaskAssignedUserId(e.target.value)}
                  >
                    <option value="">{HEBREW.selectAssignee}</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.label}
                      </option>
                    ))}
                  </select>
                </label>
              </AdaptiveGrid>
            </div>
          </fieldset>

          {taskError ? <p className="text-sm text-destructive">{taskError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTaskOpen(false)} disabled={taskSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createTask()} disabled={taskSubmitting}>
              {taskSubmitting ? HEBREW.saving : HEBREW.saveTask}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={expenseOpen}
        onOpenChange={(open) => {
          if (!open && expenseSubmitting) return;
          setExpenseOpen(open);
          if (!open) resetExpenseForm();
        }}
      >
        <AdaptiveDialog size="formXl">
          <DialogHeader>
            <DialogTitle>{HEBREW.expenseNew}</DialogTitle>
            <DialogDescription>{HEBREW.expenseDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={expenseSubmitting} className="contents">
            <div className="grid gap-4">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.domain}</span>
                <select
                  className={fieldClass}
                  value={expenseBusinessDomain}
                  onChange={(e) => {
                    const nextDomain = e.target.value as ExpenseBusinessDomain;
                    setExpenseBusinessDomain(nextDomain);
                    if (nextDomain !== "logistics_projects") {
                      setExpenseProjectId("");
                      setExpenseIncludedInBase(false);
                      setExpenseBilledToCustomer(false);
                      setExpenseBillToCustomerAmount("");
                    } else if (!expenseProjectId && projects[0]?.id) {
                      setExpenseProjectId(projects[0].id);
                    }
                    if (nextDomain !== "sales") setExpenseOrderId("");
                    if (nextDomain !== "property_management") setExpensePropertyId("");
                  }}
                >
                  {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                    <option key={domain} value={domain}>
                      {getBusinessDomainLabel(domain)}
                    </option>
                  ))}
                </select>
              </label>

              {expenseBusinessDomain === "logistics_projects" ? (
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.project}</span>
                  <select
                    className={fieldClass}
                    value={expenseProjectId}
                    onChange={(e) => setExpenseProjectId(e.target.value)}
                  >
                    <option value="">{HEBREW.selectProject}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} | {project.customerName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {expenseBusinessDomain === "sales" && !expenseIsWorkerPayment ? (
                <label className="space-y-2 text-sm">
                  <span>הזמנה</span>
                  <select
                    className={fieldClass}
                    value={expenseOrderId}
                    onChange={(e) => setExpenseOrderId(e.target.value)}
                  >
                    <option value="">ללא הזמנה</option>
                    {orders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.name}
                        {order.subtitle ? ` | ${order.subtitle}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {expenseBusinessDomain === "property_management" ? (
                <label className="space-y-2 text-sm">
                  <span>נכס</span>
                  <select
                    className={fieldClass}
                    value={expensePropertyId}
                    onChange={(e) => setExpensePropertyId(e.target.value)}
                  >
                    <option value="">בחרו נכס</option>
                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.name}
                        {property.subtitle ? ` | ${property.subtitle}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="space-y-2 text-sm">
                <span>{HEBREW.category}</span>
                <select
                  className={fieldClass}
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                >
                  <option value="">{HEBREW.selectCategory}</option>
                  {DASHBOARD_EXPENSE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              {expenseCategory === OTHER_EXPENSE_CATEGORY ? (
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.otherCategoryPrompt}</span>
                  <Input
                    value={expenseCategoryOther}
                    onChange={(e) => setExpenseCategoryOther(e.target.value)}
                  />
                </label>
              ) : null}

              {expenseIsWorkerPayment && canManageWorkerSessions ? (
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.worker}</span>
                  <select
                    className={fieldClass}
                    value={expenseWorkerUserId}
                    onChange={(e) => setExpenseWorkerUserId(e.target.value)}
                  >
                    <option value="">{HEBREW.selectWorker}</option>
                    {workerUsers.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {expenseIsWorkerPayment ? (
                <>
                  <div className="md:col-span-2 grid gap-3 md:grid-cols-3">
                    <label className="space-y-2 text-sm">
                      <span>כניסה</span>
                      <DateTimeInput
                        value={expenseClockIn}
                        onChange={(e) => setExpenseClockIn(e.target.value)}
                      />
                    </label>

                    <label className="space-y-2 text-sm">
                      <span>סה״כ שעות</span>
                      <Input
                        inputMode="decimal"
                        value={expenseDuration}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          if (!nextValue.trim()) {
                            setExpenseClockOut("");
                            return;
                          }
                          const parsedHours = Number(nextValue);
                          const clockInIso = toIso(expenseClockIn);
                          if (!Number.isFinite(parsedHours) || parsedHours <= 0 || !clockInIso) return;
                          const nextClockOut = new Date(new Date(clockInIso).getTime() + parsedHours * 60 * 60 * 1000);
                          if (Number.isNaN(nextClockOut.getTime())) return;
                          const pad = (n: number) => String(n).padStart(2, "0");
                          setExpenseClockOut(
                            `${nextClockOut.getFullYear()}-${pad(nextClockOut.getMonth() + 1)}-${pad(nextClockOut.getDate())}T${pad(nextClockOut.getHours())}:${pad(nextClockOut.getMinutes())}`
                          );
                        }}
                        placeholder="למשל 8"
                      />
                    </label>

                    <label className="space-y-2 text-sm">
                      <span>יציאה</span>
                      <DateTimeInput
                        value={expenseClockOut}
                        onChange={(e) => setExpenseClockOut(e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="space-y-2 text-sm">
                    <span>עלות עבודה</span>
                    <Input
                      inputMode="decimal"
                      value={expenseLaborCost}
                      onChange={(e) => setExpenseLaborCost(e.target.value)}
                      placeholder="אופציונלי"
                    />
                    <span className="block text-xs text-muted-foreground">
                      {suggestedExpenseWorkerAmount !== null
                        ? `סה״כ לתשלום עבור המשמרת: ${formatIls(suggestedExpenseWorkerAmount)}`
                        : "הסכום שמגיע לעובד יוצג כאן אחרי הזנת שעות תקינות או עלות עבודה."}
                    </span>
                  </label>

                  <div className="space-y-3 rounded-xl border p-3">
                    {expenseBusinessDomain === "logistics_projects" ? (
                      <>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={expenseBilledToCustomer}
                            onChange={(e) => {
                              setExpenseBilledToCustomer(e.target.checked);
                              if (!e.target.checked) setExpenseBillToCustomerAmount("");
                            }}
                          />
                          <span>{HEBREW.billedToCustomer}</span>
                        </label>

                        {expenseBilledToCustomer ? (
                          <label className="space-y-2 text-sm">
                            <span>סכום לחיוב לקוח</span>
                            <Input
                              inputMode="decimal"
                              value={expenseBillToCustomerAmount}
                              onChange={(e) => setExpenseBillToCustomerAmount(e.target.value)}
                              placeholder="למשל 650"
                            />
                          </label>
                        ) : null}
                      </>
                    ) : null}

                    {canManageWorkerSessions ? (
                      <>
                        <label className="space-y-2 text-sm">
                          <span>תשלום לעובד</span>
                          <select
                            className={fieldClass}
                            value={expenseWorkerPaymentChoice}
                            onChange={(e) => setExpenseWorkerPaymentChoice(e.target.value as PaymentChoice)}
                          >
                            <option value="none">לא שולם</option>
                            <option value="paid">שולם במלואו</option>
                            <option value="partial">שולם חלקית</option>
                          </select>
                        </label>

                        {expenseWorkerPaymentChoice !== "none" ? (
                          <label className="space-y-2 text-sm">
                            <span>כמה שולם</span>
                            <Input
                              inputMode="decimal"
                              value={expenseWorkerPaidAmount}
                              onChange={(e) => setExpenseWorkerPaidAmount(e.target.value)}
                              placeholder="אם ריק, יירשם מלוא סכום המשמרת"
                            />
                          </label>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <AdaptiveGrid variant="formTwoLoose">
                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.amount}</span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                      />
                    </label>

                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.date}</span>
                      <DateInput
                        value={expenseDate}
                        onChange={(e) => setExpenseDate(e.target.value)}
                      />
                    </label>
                  </AdaptiveGrid>

                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.description}</span>
                    <Input
                      value={expenseDescription}
                      onChange={(e) => setExpenseDescription(e.target.value)}
                    />
                  </label>

                  {expenseBusinessDomain === "logistics_projects" ? (
                    <div className="flex flex-col gap-2 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={expenseIncludedInBase}
                          onChange={(e) => setExpenseIncludedInBase(e.target.checked)}
                        />
                        <span>{HEBREW.includedInBase}</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={expenseBilledToCustomer}
                          onChange={(e) => setExpenseBilledToCustomer(e.target.checked)}
                        />
                        <span>{HEBREW.billedToCustomer}</span>
                      </label>
                    </div>
                  ) : null}
                </>
              )}

              <label className="space-y-2 text-sm">
                <span>{HEBREW.notes}</span>
                <Textarea value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} />
              </label>

              <div className="space-y-2">
                <div className="text-sm font-medium">קבצים מצורפים (אופציונלי)</div>
                <div className="flex items-center gap-2">
                  <FileUploadActions
                    files={expenseAttachmentFiles}
                    multiple
                    onFilesSelected={setExpenseAttachmentFiles}
                    chooseLabel={expenseAttachmentFiles.length > 0 || expenseExistingAttachments.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                    chooseVariant="outline"
                    size="sm"
                  />
                  {expenseAttachmentFiles.length > 0 ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setExpenseAttachmentFiles([])}>
                      נקה בחירה
                    </Button>
                  ) : null}
                </div>
                {expenseAttachmentFiles.length > 0 ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {expenseAttachmentFiles.map((file) => (
                      <div key={`${file.name}-${file.size}`}>{file.name}</div>
                    ))}
                  </div>
                ) : null}
                {expenseExistingAttachments.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                    <div className="flex flex-wrap gap-2">
                      {expenseExistingAttachments.map((attachment) => (
                        <a
                          key={attachment.document_id}
                          href={attachment.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                        >
                          {attachment.file_name ?? "קובץ"}
                        </a>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {expenseExistingAttachments
                        .filter((attachment) => attachment.url && isImageAttachment(attachment))
                        .map((attachment) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={`${attachment.document_id}-preview`}
                            src={attachment.url ?? ""}
                            alt={attachment.file_name ?? "קובץ"}
                            className="h-20 w-20 rounded-lg border object-cover"
                          />
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </fieldset>

          {expenseError ? <p className="text-sm text-destructive">{expenseError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setExpenseOpen(false)} disabled={expenseSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createExpense()} disabled={expenseSubmitting}>
              {expenseSubmitting ? HEBREW.saving : HEBREW.saveExpense}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={incomeOpen}
        onOpenChange={(open) => {
          if (!open && incomeSubmitting) return;
          setIncomeOpen(open);
          if (!open) resetIncomeForm();
        }}
      >
        <AdaptiveDialog size="formXl">
          <DialogHeader>
            <DialogTitle>{HEBREW.incomeNew}</DialogTitle>
            <DialogDescription>{HEBREW.incomeDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={incomeSubmitting} className="contents">
            <div className="grid gap-4">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.project}</span>
                <select
                  className={fieldClass}
                  value={incomeProjectId}
                  onChange={(e) => setIncomeProjectId(e.target.value)}
                >
                  <option value="">{HEBREW.selectProject}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} | {project.customerName}
                    </option>
                  ))}
                </select>
              </label>

              <AdaptiveGrid variant="formTwoLoose">
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.amount}</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={incomeAmount}
                    onChange={(e) => setIncomeAmount(e.target.value)}
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span>{HEBREW.date}</span>
                  <DateInput
                    value={incomeDate}
                    onChange={(e) => setIncomeDate(e.target.value)}
                  />
                </label>
              </AdaptiveGrid>

              <AdaptiveGrid variant="formTwoLoose">
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.paymentMethod}</span>
                  <select
                    className={fieldClass}
                    value={incomeMethod}
                    onChange={(e) => setIncomeMethod(e.target.value)}
                  >
                    <option value="bank_transfer">{HEBREW.bankTransfer}</option>
                    <option value="cash">{HEBREW.cash}</option>
                    <option value="check">{HEBREW.check}</option>
                    <option value="credit_card">{HEBREW.creditCard}</option>
                    <option value="other">{HEBREW.other}</option>
                  </select>
                  {incomeMethod === "check" ? (
                    <span className="block text-xs text-muted-foreground">
                      {"צ'ק יירשם כממתין לפירעון עד תאריך הפירעון."}
                    </span>
                  ) : null}
                </label>

                <label className="space-y-2 text-sm">
                  <span>{incomeMethod === "check" ? HEBREW.paymentDueDate : HEBREW.reference}</span>
                  {incomeMethod === "check" ? (
                    <DateInput
                      value={incomeDueDate}
                      onChange={(e) => setIncomeDueDate(e.target.value)}
                    />
                  ) : (
                    <Input
                      value={incomeReference}
                      onChange={(e) => setIncomeReference(e.target.value)}
                    />
                  )}
                </label>
              </AdaptiveGrid>

              {incomeMethod === "check" ? (
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.reference}</span>
                  <Input
                    value={incomeReference}
                    onChange={(e) => setIncomeReference(e.target.value)}
                  />
                </label>
              ) : null}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={incomeRequiresSplit}
                  onChange={(e) => setIncomeRequiresSplit(e.target.checked)}
                />
                <span>{HEBREW.includesVat}</span>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.notes}</span>
                <Textarea value={incomeNotes} onChange={(e) => setIncomeNotes(e.target.value)} />
              </label>

              <div className="space-y-2">
                <div className="text-sm font-medium">קבצים מצורפים (אופציונלי)</div>
                <div className="flex items-center gap-2">
                  <FileUploadActions
                    files={incomeAttachmentFiles}
                    multiple
                    onFilesSelected={setIncomeAttachmentFiles}
                    chooseLabel={incomeAttachmentFiles.length > 0 || incomeExistingAttachments.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                    chooseVariant="outline"
                    size="sm"
                  />
                  {incomeAttachmentFiles.length > 0 ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setIncomeAttachmentFiles([])}>
                      נקה בחירה
                    </Button>
                  ) : null}
                </div>
                {incomeAttachmentFiles.length > 0 ? (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {incomeAttachmentFiles.map((file) => (
                      <div key={`${file.name}-${file.size}`}>{file.name}</div>
                    ))}
                  </div>
                ) : null}
                {incomeExistingAttachments.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                    <div className="flex flex-wrap gap-2">
                      {incomeExistingAttachments.map((attachment) => (
                        <a
                          key={attachment.document_id}
                          href={attachment.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                        >
                          {attachment.file_name ?? "קובץ"}
                        </a>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {incomeExistingAttachments
                        .filter((attachment) => attachment.url && isImageAttachment(attachment))
                        .map((attachment) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={`${attachment.document_id}-preview`}
                            src={attachment.url ?? ""}
                            alt={attachment.file_name ?? "קובץ"}
                            className="h-20 w-20 rounded-lg border object-cover"
                          />
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </fieldset>

          {incomeError ? <p className="text-sm text-destructive">{incomeError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIncomeOpen(false)} disabled={incomeSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createIncome()} disabled={incomeSubmitting}>
              {incomeSubmitting ? HEBREW.saving : HEBREW.saveIncome}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>
    </>
  );
}

function getBusinessDomainLabel(value: string | null | undefined) {
  if (value === "general_business") return "כללי";
  if (value === "property_management") return "ניהול נכסים";
  if (value === "sales") return "מכירות";
  if (value === "logistics_projects") return "פרויקטים";
  if (value === "home") return "בית";
  if (value === "charity") return "צדקה";
  return value || "כללי";
}
