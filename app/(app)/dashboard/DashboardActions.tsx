"use client";
import { toHebrewError } from "@/lib/error-messages";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Clock3,
  FolderKanban,
  ListTodo,
  PlayCircle,
  ShoppingCart,
  UserPlus,
} from "lucide-react";
import NewOrderClient from "@/app/(app)/sales/orders/new/NewOrderClient";
import NewProjectClient, { mapProjectCustomer, type ProjectCustomerOption } from "@/app/(app)/projects/NewProjectClient";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import type { UserRole } from "@/lib/auth/requireProfile";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  mapProjectTypeToExpenseDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import {
  calculateSessionLaborCost,
  getActiveSalaryAgreementForDate,
  type SalaryAgreementRow,
} from "@/lib/payroll";
import {
  payrollWorkerTypeAllowsSessions,
  shouldShowSessionHours,
  shouldShowSessionPrice,
  type PayrollWorkerType,
} from "@/lib/payroll-worker-type";
import { PAYMENT_METHOD_OPTIONS, type FinancialAttachment } from "@/lib/payments";
import { offlineFetch } from "@/lib/offline-queue";
import type { CalendarEntry } from "@/lib/projectSchedule";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { CreateCustomerDialog } from "@/components/customers/CreateCustomerDialog";
import { ProjectPicker, type ProjectPickerOption } from "@/components/projects/ProjectPicker";
import { TransferDialog } from "@/components/financial/TransferDialog";
import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";

type Row = Record<string, unknown>;

export type ProjectOption = {
  id: string;
  name: string;
  type?: string;
  customerId: string;
  customerName: string;
  startDate?: string;
};

export type UserOption = {
  id: string;
  label: string;
  role?: UserRole;
  payroll_worker_type?: PayrollWorkerType | null;
  pay_tracking_mode?: string | null;
};

export type EntityOption = {
  id: string;
  name: string;
  subtitle?: string;
};

export type OpenSessionInfo = {
  id: string;
  clock_in: string;
};

type PaymentChoice = "none" | "paid" | "partial";

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function getTodayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateOnly(value: string | null | undefined) {
  if (!value) return "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : "";
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

function formatWeekRangeLabel(start: Date, end: Date) {
  return `${new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" }).format(start)} - ${new Intl.DateTimeFormat(
    "he-IL",
    { day: "numeric", month: "long", year: "numeric" }
  ).format(end)}`;
}

function shortWeekDay(date: Date) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "short" }).format(date);
}

const WEEK_PALETTE = [
  { bar: "bg-info", chip: "bg-info-soft text-info-soft-foreground" },
  { bar: "bg-success", chip: "bg-success-soft text-success-soft-foreground" },
  { bar: "bg-warning", chip: "bg-warning-soft text-warning-soft-foreground" },
  { bar: "bg-secondary", chip: "bg-accent text-accent-foreground" },
  { bar: "bg-destructive", chip: "bg-destructive-soft text-destructive-soft-foreground" },
  { bar: "bg-info/70", chip: "bg-info-soft/70 text-info-soft-foreground" },
  { bar: "bg-palette-orange-4", chip: "bg-palette-orange-10 text-primary-1" },
] as const;

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
  "\u05e8\u05db\u05d9\u05e9\u05d4",
  "\u05d0\u05d5\u05db\u05dc",
  "\u05e8\u05db\u05d1\u05d9\u05dd",
  "\u05d0\u05d7\u05e8",
] as const;
const OTHER_EXPENSE_CATEGORY = "\u05d0\u05d7\u05e8";
const EMPLOYEE_WAGE_CATEGORY = "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3";
const DEFAULT_EXPENSE_CATEGORY = "\u05e8\u05db\u05d9\u05e9\u05d4";
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
  transferNew: "\u05d4\u05e2\u05d1\u05e8\u05d4 / \u05e9\u05d9\u05d5\u05da \u05db\u05e4\u05d5\u05dc",
  incomeQuickRegister: "\u05e8\u05d9\u05e9\u05d5\u05dd \u05d4\u05db\u05e0\u05e1\u05d4",
  incomeDialogDescription:
    "\u05e8\u05d9\u05e9\u05d5\u05dd \u05d4\u05db\u05e0\u05e1\u05d4 \u05d7\u05d3\u05e9\u05d4 \u05dc\u05ea\u05d6\u05e8\u05d9\u05dd, \u05e2\u05dd \u05d0\u05e4\u05e9\u05e8\u05d5\u05ea \u05dc\u05e7\u05e9\u05e8 \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8, \u05d4\u05d6\u05de\u05e0\u05d4 \u05d0\u05d5 \u05e0\u05db\u05e1.",
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
    "\u05d9\u05e9 \u05dc\u05de\u05dc\u05d0 \u05ea\u05d0\u05e8\u05d9\u05da \u05d5\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd.",
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
}) {
  const router = useRouter();

  const [orderActionLocked, setOrderActionLocked] = useState(false);

  const [weekOverviewOpen, setWeekOverviewOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [manualSessionOpen, setManualSessionOpen] = useState(false);
  const [availableUsers, setAvailableUsers] = useState(users);
  // The dropdown data may stream in AFTER the buttons first render (so the
  // quick-action buttons appear instantly and dialogs fill in a moment later).
  // `users` is the only data prop copied into local state, so sync it when it
  // changes — every other dropdown reads its prop directly and updates on its own.
  // Skip the empty initial payload so a worker added mid-session isn't clobbered.
  useEffect(() => {
    if (users.length > 0) setAvailableUsers(users);
  }, [users]);

  // The project create flow now runs through the shared <NewProjectClient/> wizard.
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  // Manager defaulting: prefer the configured PM ("הלר") if present in the users list.
  const defaultProjectManagerId = users.find((u) => u.label.replace(/[^א-ת]/g, "").includes("הלר"))?.id ?? "";

  const wizardProjectCustomers = useMemo<ProjectCustomerOption[]>(
    () =>
      customers
        .map((row) => mapProjectCustomer(row))
        .filter((row): row is ProjectCustomerOption => row !== null),
    [customers]
  );
  const wizardProjectManagers = useMemo(
    () => users.map((u) => ({ id: u.id, label: u.label })),
    [users]
  );

  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseBusinessDomain, setExpenseBusinessDomain] = useState<ExpenseBusinessDomain | "">("");
  const [expenseProjectId, setExpenseProjectId] = useState("");
  const [expenseOrderId, setExpenseOrderId] = useState("");
  const [expensePropertyId, setExpensePropertyId] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState(DEFAULT_EXPENSE_CATEGORY);
  const [expenseCategoryOther, setExpenseCategoryOther] = useState("");
  const [expenseDate, setExpenseDate] = useState(getTodayDate());
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [expenseIncludedInBase, setExpenseIncludedInBase] = useState(false);
  const [expenseBilledToCustomer, setExpenseBilledToCustomer] = useState(false);
  const [expenseWorkerUserId, setExpenseWorkerUserId] = useState("");
  const [expenseClockIn, setExpenseClockIn] = useState("");
  const [expenseClockOut, setExpenseClockOut] = useState("");
  const [expenseLaborCost, setExpenseLaborCost] = useState("");
  const [expenseWorkerPaymentChoice, setExpenseWorkerPaymentChoice] = useState<PaymentChoice>("none");
  const [expenseWorkerPaidAmount, setExpenseWorkerPaidAmount] = useState("");
  const [expenseBillToCustomerAmount, setExpenseBillToCustomerAmount] = useState("");
  const [expensePaymentStatus, setExpensePaymentStatus] = useState<"paid" | "partial" | "not_paid">("not_paid");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
  const [expenseAttachmentFiles, setExpenseAttachmentFiles] = useState<File[]>([]);
  const [expenseExistingAttachments, setExpenseExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [expenseNewWorkerOpen, setExpenseNewWorkerOpen] = useState(false);
  const [expenseNewWorkerSubmitting, setExpenseNewWorkerSubmitting] = useState(false);
  const [expenseNewWorkerError, setExpenseNewWorkerError] = useState<string | null>(null);
  const [expenseNewWorkerName, setExpenseNewWorkerName] = useState("");
  const [expenseNewWorkerPhone, setExpenseNewWorkerPhone] = useState("");

  const [incomeSubmitting, setIncomeSubmitting] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [incomeBusinessDomain, setIncomeBusinessDomain] = useState<ExpenseBusinessDomain | "">("");
  const [incomeProjectId, setIncomeProjectId] = useState("");
  const [incomeProjectQuery, setIncomeProjectQuery] = useState("");
  const [incomeOrderId, setIncomeOrderId] = useState("");
  const [incomePropertyId, setIncomePropertyId] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState(getTodayDate());
  const [incomeMethod, setIncomeMethod] = useState("");
  const [incomeDueDate, setIncomeDueDate] = useState("");
  const [incomeRequiresSplit, setIncomeRequiresSplit] = useState(false);
  const [incomeReference, setIncomeReference] = useState("");
  const [incomeCheckNumber, setIncomeCheckNumber] = useState("");
  const [incomeCheckPhotoFiles, setIncomeCheckPhotoFiles] = useState<File[]>([]);
  const [incomeNotes, setIncomeNotes] = useState("");
  const [incomeAttachmentFiles, setIncomeAttachmentFiles] = useState<File[]>([]);
  const [incomeExistingAttachments, setIncomeExistingAttachments] = useState<FinancialAttachment[]>([]);
  const [selfSessionSubmitting, setSelfSessionSubmitting] = useState(false);
  const [manualSessionSubmitting, setManualSessionSubmitting] = useState(false);
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const weekStart = useMemo(() => startOfWeek(today), [today]);
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const [manualSessionError, setManualSessionError] = useState<string | null>(null);
  const [manualSessionUserId, setManualSessionUserId] = useState("");
  const [manualSessionDomain, setManualSessionDomain] = useState<ExpenseBusinessDomain | "">("");
  const [manualSessionProjectId, setManualSessionProjectId] = useState("");
  const [manualSessionPropertyId, setManualSessionPropertyId] = useState("");
  const [manualSessionNotes, setManualSessionNotes] = useState("");
  const [manualSessionClockIn, setManualSessionClockIn] = useState(nowLocal(-60));
  const [manualSessionClockOut, setManualSessionClockOut] = useState(nowLocal());
  const [manualSessionLaborCost, setManualSessionLaborCost] = useState("");
  const [manualSessionPaymentChoice, setManualSessionPaymentChoice] = useState<PaymentChoice>("none");
  const [manualSessionPaidAmount, setManualSessionPaidAmount] = useState("");
  const [manualSessionBilledToCustomer, setManualSessionBilledToCustomer] = useState(false);
  const [manualSessionBillToCustomerAmount, setManualSessionBillToCustomerAmount] = useState("");

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const projectPickerOptions: ProjectPickerOption[] = useMemo(
    () =>
      projects.map((project) => ({
        id: project.id,
        label: project.name,
        customerName: project.customerName,
        startDate: project.startDate,
      })),
    [projects]
  );
  const filteredIncomeProjects = useMemo(() => {
    const q = incomeProjectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((project) => {
      const name = project.name.toLowerCase();
      const customer = project.customerName.toLowerCase();
      return name.includes(q) || customer.includes(q);
    });
  }, [incomeProjectQuery, projects]);
  const weeklyGeneralEntries = useMemo(() => {
    // Projects active this week that started before it AND span 15+ days total
    return scheduleEntries.filter((entry) => {
      if (entry.kind !== "project") return false;
      const start = toDateOnly(entry.startDate);
      const end = toDateOnly(entry.endDate) ?? start;
      if (!start || !end) return false;
      const durationDays = (end.getTime() - start.getTime()) / 86_400_000;
      return start < weekStart && end >= weekStart && durationDays >= 15;
    });
  }, [scheduleEntries, weekStart]);

  const weeklyBuckets = useMemo(() => {
    const generalIds = new Set(weeklyGeneralEntries.map((e) => e.id));

    return Array.from({ length: 7 }).map((_, index) => {
      const day = addDays(weekStart, index);
      const entries = scheduleEntries.filter((entry) => {
        if (generalIds.has(entry.id)) return false;
        const start = toDateOnly(entry.startDate);
        const end = toDateOnly(entry.endDate) ?? start;
        if (!start || !end) return false;
        if (entry.kind === "task") {
          // Tasks: only on their due date
          return isSameDay(day, start);
        }
        // Projects: every day they are active within this week
        const effectiveStart = start < weekStart ? weekStart : start;
        return day >= effectiveStart && day <= end && day <= weekEnd;
      });
      return { day, entries };
    });
  }, [scheduleEntries, weekStart, weekEnd, weeklyGeneralEntries]);
  const weeklyEntryCount = useMemo(
    () =>
      weeklyGeneralEntries.length +
      weeklyBuckets.reduce((sum, bucket) => sum + bucket.entries.length, 0),
    [weeklyBuckets, weeklyGeneralEntries]
  );
  const workerUsers = useMemo(
    () => availableUsers.filter((user) => user.role === "worker" || user.role === "worker_no_access"),
    [availableUsers]
  );
  const canManageWorkerSessions = currentUserRole === "admin" || currentUserRole === "office";
  const manualSessionTargetId = canManageWorkerSessions ? manualSessionUserId : currentUserId ?? "";
  const selectedManualSessionWorkerType = useMemo<PayrollWorkerType | null>(() => {
    if (!manualSessionTargetId) return null;
    return availableUsers.find((u) => u.id === manualSessionTargetId)?.payroll_worker_type ?? null;
  }, [availableUsers, manualSessionTargetId]);
  const showManualSessionTimingFields = shouldShowSessionHours(selectedManualSessionWorkerType);
  const showManualSessionPriceField = shouldShowSessionPrice(selectedManualSessionWorkerType);
  const manualSessionDateOnly = useMemo(() => {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(manualSessionClockIn);
    return match ? match[1] : new Date().toISOString().slice(0, 10);
  }, [manualSessionClockIn]);
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

  useEffect(() => {
    if (selectedManualSessionWorkerType !== "session_only") return;
    const normIn = `${manualSessionDateOnly}T09:00`;
    const normOut = `${manualSessionDateOnly}T10:00`;
    if (manualSessionClockIn !== normIn) setManualSessionClockIn(normIn);
    if (manualSessionClockOut !== normOut) setManualSessionClockOut(normOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedManualSessionWorkerType]);

  const finalExpenseCategory =
    expenseCategory === OTHER_EXPENSE_CATEGORY ? expenseCategoryOther.trim() : expenseCategory.trim();
  const expenseIsWorkerPayment = finalExpenseCategory === EMPLOYEE_WAGE_CATEGORY;
  const expenseTargetUserId = canManageWorkerSessions ? expenseWorkerUserId : currentUserId ?? "";
  const selectedExpenseWorkerType = useMemo<PayrollWorkerType | null>(() => {
    if (!expenseIsWorkerPayment || !expenseTargetUserId) return null;
    return availableUsers.find((u) => u.id === expenseTargetUserId)?.payroll_worker_type ?? null;
  }, [availableUsers, expenseIsWorkerPayment, expenseTargetUserId]);
  const showExpenseSessionTimingFields = !expenseIsWorkerPayment || shouldShowSessionHours(selectedExpenseWorkerType);
  const showExpenseSessionPriceField = !expenseIsWorkerPayment || shouldShowSessionPrice(selectedExpenseWorkerType);
  const expenseSessionDateOnly = useMemo(() => {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(expenseClockIn);
    return match ? match[1] : new Date().toISOString().slice(0, 10);
  }, [expenseClockIn]);
  useEffect(() => {
    if (selectedExpenseWorkerType !== "session_only") return;
    const normIn = `${expenseSessionDateOnly}T09:00`;
    const normOut = `${expenseSessionDateOnly}T10:00`;
    if (expenseClockIn !== normIn) setExpenseClockIn(normIn);
    if (expenseClockOut !== normOut) setExpenseClockOut(normOut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpenseWorkerType]);
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
    setAvailableUsers(users);
  }, [users]);

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

  function resetExpenseForm() {
    setExpenseError(null);
    setExpenseBusinessDomain("");
    setExpenseProjectId("");
    setExpenseOrderId("");
    setExpensePropertyId("");
    setExpenseAmount("");
    setExpenseCategory(DEFAULT_EXPENSE_CATEGORY);
    setExpenseCategoryOther("");
    setExpenseDate(getTodayDate());
    setExpenseDescription("");
    setExpenseNotes("");
    setExpenseIncludedInBase(false);
    setExpenseBilledToCustomer(false);
    setExpensePaymentStatus("not_paid");
    setExpensePaymentMethod("");
    setExpenseWorkerUserId("");
    setExpenseClockIn("");
    setExpenseClockOut("");
    setExpenseLaborCost("");
    setExpenseWorkerPaymentChoice("none");
    setExpenseWorkerPaidAmount("");
    setExpenseBillToCustomerAmount("");
    setExpenseAttachmentFiles([]);
    setExpenseExistingAttachments([]);
    setExpenseNewWorkerOpen(false);
    setExpenseNewWorkerSubmitting(false);
    setExpenseNewWorkerError(null);
    setExpenseNewWorkerName("");
    setExpenseNewWorkerPhone("");
  }

  function resetIncomeForm() {
    setIncomeError(null);
    setIncomeBusinessDomain("");
    setIncomeProjectId("");
    setIncomeProjectQuery("");
    setIncomeOrderId("");
    setIncomePropertyId("");
    setIncomeAmount("");
    setIncomeDate(getTodayDate());
    setIncomeMethod("");
    setIncomeDueDate("");
    setIncomeRequiresSplit(false);
    setIncomeReference("");
    setIncomeCheckNumber("");
    setIncomeCheckPhotoFiles([]);
    setIncomeNotes("");
    setIncomeAttachmentFiles([]);
    setIncomeExistingAttachments([]);
  }

  function resetManualSessionForm() {
    setManualSessionError(null);
    setManualSessionUserId(canManageWorkerSessions ? "" : currentUserId ?? "");
    setManualSessionDomain("");
    setManualSessionProjectId("");
    setManualSessionPropertyId("");
    setManualSessionNotes("");
    setManualSessionClockIn(nowLocal(-60));
    setManualSessionClockOut(nowLocal());
    setManualSessionLaborCost("");
    setManualSessionPaymentChoice("none");
    setManualSessionPaidAmount("");
    setManualSessionBilledToCustomer(false);
    setManualSessionBillToCustomerAmount("");
  }

  async function createExpense() {
    setExpenseError(null);
    if (!expenseBusinessDomain) {
      setExpenseError("יש לבחור תחום.");
      return;
    }
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
          setExpenseError(toHebrewError(json.error, HEBREW.expenseCreateFailed));
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
            throw new Error(toHebrewError(paymentJson.error, "שמירת התשלום לעובד נכשלה."));
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
        setExpenseError(toHebrewError(error, HEBREW.saveErrorUnknown));
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
      const result = await offlineFetch(
        "/api/expenses/create",
        {
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
          payment_status: expensePaymentStatus,
          payment_method:
            expensePaymentStatus === "paid" || expensePaymentStatus === "partial"
              ? expensePaymentMethod || null
              : null,
        },
        HEBREW.expenseNew,
        { idempotent: true }
      );
      if (result.queued) {
        setExpenseOpen(false);
        resetExpenseForm();
        return;
      }
      if (!result.ok) {
        setExpenseError(toHebrewError(result.error, HEBREW.expenseCreateFailed));
        return;
      }
      const json = result.data as { expense?: Row };
      if (!json.expense) {
        setExpenseError(HEBREW.expenseCreateFailed);
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
      setExpenseError(toHebrewError(error, HEBREW.saveErrorUnknown));
    } finally {
      setExpenseSubmitting(false);
    }
  }

  async function createExpenseWorker() {
    setExpenseNewWorkerError(null);

    const fullName = expenseNewWorkerName.trim();
    const phone = expenseNewWorkerPhone.trim();
    if (!fullName || !phone) {
      setExpenseNewWorkerError("יש למלא שם וטלפון לעובד החדש.");
      return;
    }

    setExpenseNewWorkerSubmitting(true);
    try {
      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          email: null,
          phone,
          password: "",
          role: "worker_no_access",
          system_access: false,
          pay_tracking_mode: "session",
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        user?: { id?: string; full_name?: string | null; email?: string | null; role?: UserRole };
      };
      const createdUser = json.user;
      if (!res.ok || !createdUser?.id) {
        setExpenseNewWorkerError(toHebrewError(json.error, "שגיאה ביצירת עובד."));
        return;
      }

      const label = createdUser.full_name?.trim() || createdUser.email?.trim() || "עובד חדש";
      setAvailableUsers((current) => {
        const nextUser: UserOption = {
          id: createdUser.id ?? "",
          label,
          role: createdUser.role ?? "worker_no_access",
        };
        const withoutDuplicate = current.filter((user) => user.id !== nextUser.id);
        return [nextUser, ...withoutDuplicate];
      });
      setExpenseWorkerUserId(createdUser.id);
      setExpenseNewWorkerOpen(false);
      setExpenseNewWorkerName("");
      setExpenseNewWorkerPhone("");
      toast.success("העובד נוסף ונבחר להוצאה.");
    } catch (error: unknown) {
      setExpenseNewWorkerError(toHebrewError(error, "שגיאה ביצירת עובד."));
    } finally {
      setExpenseNewWorkerSubmitting(false);
    }
  }

  async function createIncome() {
    setIncomeError(null);
    if (!incomeBusinessDomain) {
      setIncomeError("יש לבחור תחום.");
      return;
    }
    const linkedProjectId = incomeBusinessDomain === "logistics_projects" ? incomeProjectId : "";
    const linkedOrderId = incomeBusinessDomain === "sales" ? incomeOrderId : "";
    const linkedPropertyId = incomeBusinessDomain === "property_management" ? incomePropertyId : "";

    if (incomeBusinessDomain === "logistics_projects" && !linkedProjectId) {
      setIncomeError(HEBREW.sessionInvalidProject);
      return;
    }
    if (incomeBusinessDomain === "property_management" && !linkedPropertyId) {
      setIncomeError(HEBREW.sessionInvalidProperty);
      return;
    }
    if (!incomeDate || !incomeMethod.trim()) {
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
      const result = await offlineFetch(
        "/api/payments/create",
        {
          business_domain:
            incomeBusinessDomain === "logistics_projects"
              ? mapProjectTypeToExpenseDomain(projectById.get(linkedProjectId)?.type ?? null)
              : incomeBusinessDomain,
          project_id: linkedProjectId || null,
          order_id: linkedOrderId || null,
          property_id: linkedPropertyId || null,
          amount_total: amount,
          payment_date: incomeDate,
          due_date: incomeDueDate.trim() || null,
          requires_split: incomeRequiresSplit,
          payment_method: incomeMethod,
          reference_number: incomeReference.trim() || null,
          check_number:
            incomeMethod === "check" && incomeCheckNumber.trim() ? incomeCheckNumber.trim() : null,
          notes: incomeNotes.trim() || null,
        },
        HEBREW.incomeNew,
        { idempotent: true }
      );
      if (result.queued) {
        setIncomeOpen(false);
        resetIncomeForm();
        return;
      }
      if (!result.ok) {
        setIncomeError(toHebrewError(result.error, HEBREW.incomeCreateFailed));
        return;
      }
      const json = result.data as { payment?: Row };
      if (!json.payment) {
        setIncomeError(HEBREW.incomeCreateFailed);
        return;
      }

      const paymentId = getString(json.payment, "id");
      for (const file of incomeAttachmentFiles) {
        if (!paymentId) break;
        await uploadFinancialAttachment("payment", paymentId, file);
      }
      if (incomeMethod === "check" && paymentId && incomeCheckPhotoFiles.length > 0) {
        for (const file of incomeCheckPhotoFiles) {
          await uploadFinancialAttachment("payment", paymentId, file);
        }
      }

      setIncomeOpen(false);
      resetIncomeForm();
      router.refresh();
      toast.success(HEBREW.incomeSaved);
    } catch (error: unknown) {
      setIncomeError(toHebrewError(error, HEBREW.saveErrorUnknown));
    } finally {
      setIncomeSubmitting(false);
    }
  }

  function validateSessionDomain(domain: ExpenseBusinessDomain, projectId: string, propertyId: string) {
    if (domain === "logistics_projects" && !projectId) return HEBREW.sessionInvalidProject;
    if (domain === "property_management" && !propertyId) return HEBREW.sessionInvalidProperty;
    return "";
  }

  // "Open shift" is a self-service action — only show it to workers whose pay
  // type actually tracks sessions (קבלנות / שעתי), not monthly-payslip or staff
  // with no worker type.
  const currentUserWorkerType = currentUserId
    ? availableUsers.find((u) => u.id === currentUserId)?.payroll_worker_type ?? null
    : null;
  const canStartOwnSession =
    currentUserWorkerType != null && payrollWorkerTypeAllowsSessions(currentUserWorkerType);

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
          description: toHebrewError(json.error, HEBREW.saveErrorUnknown),
        });
        return;
      }

      toast.success(HEBREW.selfSessionStarted);
      router.refresh();
    } catch (error: unknown) {
      toast.error(HEBREW.selfSessionStartFailed, {
        description: toHebrewError(error, HEBREW.saveErrorUnknown),
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
    if (!manualSessionDomain) {
      setManualSessionError("יש לבחור תחום.");
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
    const billToCustomer = manualSessionDomain === "logistics_projects" && manualSessionBilledToCustomer;
    const billToCustomerAmountNumber =
      !billToCustomer || !manualSessionBillToCustomerAmount.trim()
        ? null
        : Number(manualSessionBillToCustomerAmount);
    if (
      billToCustomer &&
      (!Number.isFinite(billToCustomerAmountNumber) ||
        billToCustomerAmountNumber === null ||
        billToCustomerAmountNumber <= 0)
    ) {
      setManualSessionError("יש להזין סכום לחיוב לקוח.");
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
          is_billable_to_customer: billToCustomer,
          bill_to_customer_amount: billToCustomer ? billToCustomerAmountNumber : null,
          billing_status: billToCustomer ? "billable" : "not_billable",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; session?: { id?: string; user_id?: string; clock_in?: string; clock_out?: string; labor_cost?: number | string | null } };
      if (!res.ok || !json.session) {
        setManualSessionError(toHebrewError(json.error, HEBREW.manualSessionFailed));
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
            throw new Error(toHebrewError(paymentJson.error, "שמירת התשלום נכשלה."));
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
      setManualSessionError(toHebrewError(error, HEBREW.saveErrorUnknown));
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
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setWeekOverviewOpen(true)}
        >
          <FolderKanban className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.thisWeek}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => {
            emitNavigationStart();
            router.push("/sales?tab=deliveries");
          }}
        >
          <ShoppingCart className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.ordersByCity}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setProjectOpen(true)}
        >
          <FolderKanban className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.projectNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => {
            setOrderActionLocked(false);
            setOrderOpen(true);
          }}
        >
          <ShoppingCart className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.orderNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setExpenseOpen(true)}
        >
          <ArrowUpCircle className="!h-9 !w-9 text-destructive" strokeWidth={2.4} />
          <span className="font-semibold">{HEBREW.expenseNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setIncomeOpen(true)}
        >
          <ArrowDownCircle className="!h-9 !w-9 text-success" strokeWidth={2.4} />
          <span className="font-semibold">{HEBREW.incomeNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setTransferOpen(true)}
        >
          <ArrowLeftRight className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.transferNew}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setCreateCustomerOpen(true)}
        >
          <UserPlus className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">לקוח חדש</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => setTaskOpen(true)}
        >
          <ListTodo className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.taskNew}</span>
        </Button>

        {canStartOwnSession ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
            onClick={() => void startOwnSession()}
            disabled={Boolean(currentOpenSession) || selfSessionSubmitting}
          >
            <PlayCircle className="!h-9 !w-9" strokeWidth={2.2} />
            <span className="font-semibold">{HEBREW.selfSessionStart}</span>
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="h-auto aspect-square w-full max-w-[7rem] mx-auto flex-col items-center justify-center gap-2 rounded-2xl border-transparent !bg-primary !text-primary-foreground shadow-md shadow-primary/30 !whitespace-normal p-2 text-center text-xs leading-tight hover:!bg-primary/90"
          onClick={() => {
            resetManualSessionForm();
            setManualSessionOpen(true);
          }}
        >
          <Clock3 className="!h-9 !w-9" strokeWidth={2.2} />
          <span className="font-semibold">{HEBREW.manualSessionNew}</span>
        </Button>
      </AdaptiveGrid>

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        projects={projects.map((p) => ({ id: p.id, label: p.name }))}
        orders={orders.map((o) => ({ id: o.id, label: o.name }))}
        properties={properties.map((p) => ({ id: p.id, label: p.name }))}
        onSaved={() => router.refresh()}
      />

      <Dialog open={weekOverviewOpen} onOpenChange={setWeekOverviewOpen}>
        <AdaptiveDialog size="form2xl">
          <DialogHeader className="text-right">
            <DialogTitle>{HEBREW.thisWeek}</DialogTitle>
            <DialogDescription>{`${formatWeekRangeLabel(weekStart, weekEnd)} • ${weeklyEntryCount} פריטים השבוע`}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Ongoing projects legend */}
            {weeklyGeneralEntries.length > 0 && (
              <div className="space-y-2 text-right">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">פרויקטים שוטפים השבוע</div>
                <div className="flex flex-wrap justify-end gap-2">
                  {weeklyGeneralEntries.map((entry, i) => {
                    const color = WEEK_PALETTE[i % WEEK_PALETTE.length];
                    return (
                      <Link
                        key={entry.id}
                        href={entry.href}
                        onClick={() => setWeekOverviewOpen(false)}
                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition hover:opacity-80 ${color.chip}`}
                      >
                        <span className={`h-2 w-2 shrink-0 rounded-full ${color.bar}`} />
                        <span>{entry.title}</span>
                        {entry.subtitle ? <span className="opacity-60">· {entry.subtitle}</span> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 7-day calendar grid */}
            <div className="overflow-x-auto rounded-xl border">
              <div className="flex min-w-[500px]">
                {weeklyBuckets.map(({ day, entries }) => {
                  const isToday = isSameDay(day, today);
                  return (
                    <div
                      key={day.toISOString()}
                      className={`flex flex-1 flex-col border-r last:border-r-0 ${isToday ? "bg-primary/5" : "bg-background"}`}
                    >
                      {/* Day header */}
                      <div className={`border-b px-1 py-2 text-center ${isToday ? "bg-primary/10" : ""}`}>
                        <div className="text-xs text-muted-foreground">{shortWeekDay(day)}</div>
                        <div
                          className={`mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-sm font-semibold ${
                            isToday ? "bg-primary text-primary-foreground" : ""
                          }`}
                        >
                          {day.getDate()}
                        </div>
                      </div>

                      {/* Ongoing project color bars */}
                      {weeklyGeneralEntries.length > 0 && (
                        <div className="flex flex-col gap-px px-1 pt-1.5">
                          {weeklyGeneralEntries.map((entry, i) => (
                            <div
                              key={entry.id}
                              title={entry.title}
                              className={`h-1.5 rounded-sm opacity-75 ${WEEK_PALETTE[i % WEEK_PALETTE.length].bar}`}
                            />
                          ))}
                        </div>
                      )}

                      {/* Day-specific entries */}
                      <div className="flex flex-1 flex-col gap-1 p-1 pt-1.5">
                        {entries.length === 0 ? (
                          <div className="flex flex-1 items-center justify-center py-2">
                            <span className="text-[10px] text-muted-foreground/40">—</span>
                          </div>
                        ) : (
                          entries.map((entry) => (
                            <Link
                              key={entry.id}
                              href={entry.href}
                              onClick={() => setWeekOverviewOpen(false)}
                              className={`block rounded-md border px-1.5 py-1 text-[11px] leading-tight transition hover:border-primary/40 hover:bg-primary/5 ${
                                entry.kind === "task" ? "border-warning/40 bg-warning-soft" : "bg-background"
                              }`}
                            >
                              <div className="truncate font-medium" title={entry.title}>{entry.title}</div>
                              {entry.subtitle ? (
                                <div className="truncate text-muted-foreground" title={entry.subtitle}>{entry.subtitle}</div>
                              ) : null}
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
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
                <span className="font-medium">{HEBREW.domain} *</span>
                <select
                  className={`${fieldClass} text-right`}
                  value={manualSessionDomain}
                  onChange={(e) => {
                    const nextDomain = e.target.value as ExpenseBusinessDomain | "";
                    setManualSessionDomain(nextDomain);
                    if (nextDomain !== "logistics_projects") setManualSessionProjectId("");
                    if (nextDomain !== "property_management") setManualSessionPropertyId("");
                  }}
                >
                  <option value="">בחרו תחום</option>
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
                  <ProjectPicker
                    projects={projectPickerOptions}
                    value={manualSessionProjectId}
                    onChange={(newId) => {
                      setManualSessionProjectId(newId);
                      if (newId) {
                        const startDate = normalizeDateOnly(projectById.get(newId)?.startDate);
                        if (startDate) {
                          const inTime = manualSessionClockIn.includes("T") ? manualSessionClockIn.split("T")[1] : "08:00";
                          const outTime = manualSessionClockOut.includes("T") ? manualSessionClockOut.split("T")[1] : "09:00";
                          setManualSessionClockIn(`${startDate}T${inTime}`);
                          setManualSessionClockOut(`${startDate}T${outTime}`);
                        }
                      }
                    }}
                    emptyLabel={HEBREW.selectProject}
                  />
                </label>
              ) : null}

              {manualSessionDomain === "property_management" ? (
                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">נכס *</span>
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

              {manualSessionDomain ? (
                <>
              {showManualSessionTimingFields ? (
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
              ) : (
                <label className="space-y-2 text-right text-sm md:col-span-2">
                  <span className="font-medium">תאריך</span>
                  <DateInput
                    value={manualSessionDateOnly}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (!next) return;
                      setManualSessionClockIn(`${next}T09:00`);
                      setManualSessionClockOut(`${next}T10:00`);
                    }}
                  />
                </label>
              )}

              {showManualSessionPriceField ? (
                <label className="space-y-2 text-right text-sm">
                  <span className="font-medium">מחיר</span>
                  <CurrencyInput
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
              ) : (
                <div className="text-xs text-muted-foreground md:col-span-2">
                  {suggestedManualSessionAmount !== null
                    ? `סה״כ לתשלום עבור המשמרת (חישוב אוטומטי): ${formatIls(suggestedManualSessionAmount)}`
                    : "העלות תחושב אוטומטית לפי הסכם השכר לאחר שמירה."}
                </div>
              )}

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
                      <CurrencyInput
                        value={manualSessionPaidAmount}
                        onChange={(e) => setManualSessionPaidAmount(e.target.value)}
                        placeholder="אם ריק, יירשם מלוא סכום המשמרת"
                      />
                    </label>
                  ) : null}
                </>
              ) : null}

              {manualSessionDomain === "logistics_projects" ? (
                <section className="space-y-3 rounded-xl border bg-muted/30 p-4 md:col-span-2">
                  <h4 className="text-sm font-semibold">חיוב הלקוח</h4>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={manualSessionBilledToCustomer}
                      onChange={(e) => {
                        setManualSessionBilledToCustomer(e.target.checked);
                        if (!e.target.checked) setManualSessionBillToCustomerAmount("");
                      }}
                    />
                    <span>{HEBREW.billedToCustomer}</span>
                  </label>
                  {manualSessionBilledToCustomer ? (
                    <label className="space-y-2 text-sm block">
                      <span>סכום לחיוב לקוח</span>
                      <CurrencyInput
                        value={manualSessionBillToCustomerAmount}
                        onChange={(e) => setManualSessionBillToCustomerAmount(e.target.value)}
                        placeholder="למשל 650"
                      />
                    </label>
                  ) : null}
                </section>
              ) : null}

              <label className="space-y-2 text-right text-sm md:col-span-2">
                <span className="font-medium">{HEBREW.notes}</span>
                <Textarea
                  value={manualSessionNotes}
                  onChange={(e) => setManualSessionNotes(e.target.value)}
                  placeholder="הערות פנימיות..."
                />
              </label>
                </>
              ) : null}
            </div>
          </fieldset>

          {manualSessionError ? <p className="text-sm text-destructive">{manualSessionError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
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
        }}
      >
        <AdaptiveDialog size="newOrder" hideClose className="flex flex-col gap-0 overflow-y-hidden p-0 sm:p-0">
          {/* Title/description kept for screen readers only — the wizard renders its
              own visible per-step heading, so showing them here would duplicate it. */}
          <DialogHeader className="sr-only">
            <DialogTitle>{HEBREW.projectNew}</DialogTitle>
            <DialogDescription>{HEBREW.projectDialogDescription}</DialogDescription>
          </DialogHeader>

          {projectOpen ? (
            <NewProjectClient
              customers={wizardProjectCustomers}
              managers={wizardProjectManagers}
              currentUserId={currentUserId}
              defaultProjectManagerId={defaultProjectManagerId}
              draftKey="project-create"
              onActionLockedChange={setProjectSubmitting}
              onCancel={() => setProjectOpen(false)}
              onSubmitted={() => {
                setProjectOpen(false);
                router.refresh();
                toast.success(HEBREW.projectSaved);
              }}
            />
          ) : null}
        </AdaptiveDialog>
      </Dialog>

      <CreateCustomerDialog
        open={createCustomerOpen}
        onOpenChange={setCreateCustomerOpen}
        description="יוצרים לקוח חדש ישירות מהדשבורד. שדות חובה: שם, טלפון ועיר."
        onCreated={() => {
          router.refresh();
          toast.success("הלקוח נשמר.");
        }}
      />

      <TaskUpsertDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        mode="create"
        wizard
        currentUserId={currentUserId}
        users={users}
        projects={projectPickerOptions}
        properties={properties.map((property) => ({
          id: property.id,
          label: property.subtitle ? `${property.name} | ${property.subtitle}` : property.name,
        }))}
        onSaved={() => router.refresh()}
      />

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
            <div className="space-y-4">
              <div
                className={
                  expenseBusinessDomain === "logistics_projects" ||
                  (expenseBusinessDomain === "sales" && !expenseIsWorkerPayment) ||
                  expenseBusinessDomain === "property_management"
                    ? "grid gap-3 sm:grid-cols-2"
                    : ""
                }
              >
                <label className="space-y-2 text-sm block">
                  <span>{HEBREW.domain} *</span>
                  <select
                    className={fieldClass}
                    value={expenseBusinessDomain}
                    onChange={(e) => {
                      const nextDomain = e.target.value as ExpenseBusinessDomain | "";
                      setExpenseBusinessDomain(nextDomain);
                      if (nextDomain !== "logistics_projects") {
                        setExpenseProjectId("");
                        setExpenseIncludedInBase(false);
                        setExpenseBilledToCustomer(false);
                        setExpenseBillToCustomerAmount("");
                      }
                      if (nextDomain !== "sales") setExpenseOrderId("");
                      if (nextDomain !== "property_management") setExpensePropertyId("");
                    }}
                  >
                    <option value="">בחרו תחום</option>
                    {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                      <option key={domain} value={domain}>
                        {getBusinessDomainLabel(domain)}
                      </option>
                    ))}
                  </select>
                </label>

                {expenseBusinessDomain === "logistics_projects" ? (
                  <div className="space-y-2 text-sm">
                    <span>{HEBREW.project} *</span>
                    <ProjectPicker
                      projects={projectPickerOptions}
                      value={expenseProjectId}
                      onChange={setExpenseProjectId}
                      allowClear={false}
                    />
                  </div>
                ) : null}

                {expenseBusinessDomain === "sales" && !expenseIsWorkerPayment ? (
                  <label className="space-y-2 text-sm block">
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
                  <label className="space-y-2 text-sm block">
                    <span>נכס *</span>
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
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {expenseBusinessDomain ? (
                  <label className="space-y-2 text-sm block">
                    <span>{HEBREW.category} *</span>
                    <select
                      className={fieldClass}
                      value={expenseCategory}
                      onChange={(e) => setExpenseCategory(e.target.value)}
                    >
                      {DASHBOARD_EXPENSE_CATEGORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {expenseIsWorkerPayment && canManageWorkerSessions ? (
                  <label className="space-y-2 text-sm block">
                    <span>{HEBREW.worker} *</span>
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
              </div>

              {expenseCategory === OTHER_EXPENSE_CATEGORY ? (
                <label className="space-y-2 text-sm block">
                  <span>{HEBREW.otherCategoryPrompt} *</span>
                  <Input
                    value={expenseCategoryOther}
                    onChange={(e) => setExpenseCategoryOther(e.target.value)}
                  />
                </label>
              ) : null}

              {expenseIsWorkerPayment && canManageWorkerSessions ? (
                <div className="space-y-3">
                  {!expenseNewWorkerOpen ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setExpenseNewWorkerOpen(true)}>
                      עובד חדש
                    </Button>
                  ) : (
                    <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
                      <div className="text-sm font-medium">הוספת עובד חדש</div>
                      <Input
                        value={expenseNewWorkerName}
                        onChange={(e) => setExpenseNewWorkerName(e.target.value)}
                        placeholder="שם עובד"
                      />
                      <Input
                        value={expenseNewWorkerPhone}
                        onChange={(e) => setExpenseNewWorkerPhone(e.target.value)}
                        placeholder="טלפון עובד"
                      />
                      <div className="text-xs text-muted-foreground">
                        עובד חדש ייווצר כרשומת עובד בלבד, בלי גישה למערכת.
                      </div>
                      {expenseNewWorkerError ? (
                        <div className="text-sm text-destructive">{expenseNewWorkerError}</div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void createExpenseWorker()}
                          disabled={
                            expenseNewWorkerSubmitting ||
                            !expenseNewWorkerName.trim() ||
                            !expenseNewWorkerPhone.trim()
                          }
                        >
                          {expenseNewWorkerSubmitting ? "שומר..." : "הוסף עובד"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={expenseNewWorkerSubmitting}
                          onClick={() => {
                            setExpenseNewWorkerOpen(false);
                            setExpenseNewWorkerError(null);
                            setExpenseNewWorkerName("");
                            setExpenseNewWorkerPhone("");
                          }}
                        >
                          ביטול
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {expenseIsWorkerPayment ? (
                <>
                  {showExpenseSessionTimingFields ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="space-y-2 text-sm">
                        <span>כניסה *</span>
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
                        <span>יציאה *</span>
                        <DateTimeInput
                          value={expenseClockOut}
                          onChange={(e) => setExpenseClockOut(e.target.value)}
                        />
                      </label>
                    </div>
                  ) : (
                    <label className="space-y-2 text-sm block">
                      <span>תאריך *</span>
                      <DateInput
                        value={expenseSessionDateOnly}
                        onChange={(e) => {
                          const next = e.target.value;
                          if (!next) return;
                          setExpenseClockIn(`${next}T09:00`);
                          setExpenseClockOut(`${next}T10:00`);
                        }}
                      />
                    </label>
                  )}

                  {showExpenseSessionPriceField ? (
                    <label className="space-y-2 text-sm block">
                      <span>עלות עבודה</span>
                      <CurrencyInput
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
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {suggestedExpenseWorkerAmount !== null
                        ? `סה״כ לתשלום עבור המשמרת (חישוב אוטומטי): ${formatIls(suggestedExpenseWorkerAmount)}`
                        : "העלות תחושב אוטומטית לפי הסכם השכר לאחר שמירה."}
                    </div>
                  )}

                  {expenseBusinessDomain === "logistics_projects" ? (
                    <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                      <h4 className="text-sm font-semibold">חיוב הלקוח</h4>
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
                        <label className="space-y-2 text-sm block">
                          <span>סכום לחיוב לקוח</span>
                          <CurrencyInput
                            value={expenseBillToCustomerAmount}
                            onChange={(e) => setExpenseBillToCustomerAmount(e.target.value)}
                            placeholder="למשל 650"
                          />
                        </label>
                      ) : null}
                    </section>
                  ) : null}

                  {canManageWorkerSessions ? (
                    <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
                      <h4 className="text-sm font-semibold">תשלום לעובד</h4>
                      <label className="space-y-2 text-sm block">
                        <span>סטטוס תשלום לעובד</span>
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
                        <label className="space-y-2 text-sm block">
                          <span>כמה שולם</span>
                          <CurrencyInput
                            value={expenseWorkerPaidAmount}
                            onChange={(e) => setExpenseWorkerPaidAmount(e.target.value)}
                            placeholder="אם ריק, יירשם מלוא סכום המשמרת"
                          />
                        </label>
                      ) : null}
                    </section>
                  ) : null}
                </>
              ) : expenseBusinessDomain ? (
                <>
                  <AdaptiveGrid variant="formTwoLoose">
                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.amount} *</span>
                      <CurrencyInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                      />
                    </label>

                    <label className="space-y-2 text-sm">
                      <span>סטטוס תשלום</span>
                      <select
                        className={fieldClass}
                        value={expensePaymentStatus}
                        onChange={(e) => setExpensePaymentStatus(e.target.value as "paid" | "partial" | "not_paid")}
                      >
                        <option value="not_paid">לא שולם</option>
                        <option value="partial">חלקי</option>
                        <option value="paid">שולם</option>
                      </select>
                    </label>
                  </AdaptiveGrid>

                  {expensePaymentStatus === "paid" || expensePaymentStatus === "partial" ? (
                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.paymentMethod}</span>
                      <select
                        className={fieldClass}
                        value={expensePaymentMethod}
                        onChange={(e) => setExpensePaymentMethod(e.target.value)}
                      >
                        <option value="">בחרו אמצעי תשלום</option>
                        {PAYMENT_METHOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.date} *</span>
                    <DateInput
                      value={expenseDate}
                      onChange={(e) => setExpenseDate(e.target.value)}
                    />
                  </label>

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
              ) : null}

              {expenseBusinessDomain ? (
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.notes}</span>
                  <Textarea value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} />
                </label>
              ) : null}

              {expenseBusinessDomain ? (
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
              ) : null}
            </div>
          </fieldset>

          {expenseError ? <p className="text-sm text-destructive">{expenseError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
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
                <span>{HEBREW.domain} *</span>
                <select
                  className={fieldClass}
                  value={incomeBusinessDomain}
                  onChange={(e) => {
                    const nextDomain = e.target.value as ExpenseBusinessDomain | "";
                    setIncomeBusinessDomain(nextDomain);
                    if (nextDomain !== "logistics_projects") {
                      setIncomeProjectId("");
                      setIncomeProjectQuery("");
                    }
                    if (nextDomain !== "sales") setIncomeOrderId("");
                    if (nextDomain !== "property_management") setIncomePropertyId("");
                  }}
                >
                  <option value="">בחרו תחום</option>
                  {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                    <option key={domain} value={domain}>
                      {getBusinessDomainLabel(domain)}
                    </option>
                  ))}
                </select>
              </label>

              {incomeBusinessDomain === "logistics_projects" ? (
                <div className="space-y-2 text-sm">
                  <span>{HEBREW.project} *</span>
                  <Input
                    value={incomeProjectQuery}
                    onChange={(e) => setIncomeProjectQuery(e.target.value)}
                    placeholder="חיפוש פרויקט לפי שם או לקוח"
                  />
                  <div className="max-h-56 space-y-1 overflow-auto rounded-md border p-1">
                    {filteredIncomeProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => {
                          setIncomeProjectId(project.id);
                          setIncomeProjectQuery(project.name);
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-right text-sm transition-all duration-200 ${
                          project.id === incomeProjectId
                            ? "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                            : "border-border bg-accent/40 text-accent-foreground hover:bg-accent"
                        }`}
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium">{project.name}</span>
                          {project.customerName ? (
                            <span
                              className={`text-xs ${
                                project.id === incomeProjectId
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              · {project.customerName}
                            </span>
                          ) : null}
                          {normalizeDateOnly(project.startDate) ? (
                            <span
                              className={`text-xs ${
                                project.id === incomeProjectId
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              }`}
                            >
                              · {normalizeDateOnly(project.startDate)}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                    {filteredIncomeProjects.length === 0 ? (
                      <div className="p-2 text-sm text-muted-foreground">לא נמצאו פרויקטים לחיפוש הזה.</div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {incomeBusinessDomain === "sales" ? (
                <label className="space-y-2 text-sm">
                  <span>הזמנה</span>
                  <select
                    className={fieldClass}
                    value={incomeOrderId}
                    onChange={(e) => setIncomeOrderId(e.target.value)}
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

              {incomeBusinessDomain === "property_management" ? (
                <label className="space-y-2 text-sm">
                  <span>נכס *</span>
                  <select
                    className={fieldClass}
                    value={incomePropertyId}
                    onChange={(e) => setIncomePropertyId(e.target.value)}
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

              {incomeBusinessDomain ? (
                <>
                  <AdaptiveGrid variant="formTwoLoose">
                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.amount} *</span>
                      <CurrencyInput
                        type="number"
                        min="0"
                        step="0.01"
                        value={incomeAmount}
                        onChange={(e) => setIncomeAmount(e.target.value)}
                      />
                    </label>

                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.paymentMethod} *</span>
                      <select
                        className={fieldClass}
                        value={incomeMethod}
                        onChange={(e) => setIncomeMethod(e.target.value)}
                      >
                        <option value="">בחרו אמצעי תשלום</option>
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
                  </AdaptiveGrid>

                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.date} *</span>
                    <DateInput
                      value={incomeDate}
                      onChange={(e) => setIncomeDate(e.target.value)}
                    />
                  </label>

                  {incomeMethod ? (
                    <AdaptiveGrid variant="formTwoLoose">
                      <label className="space-y-2 text-sm">
                        <span>
                          {incomeMethod === "check"
                            ? `${HEBREW.paymentDueDate} *`
                            : "תאריך פירעון צפוי (אופציונלי)"}
                        </span>
                        <DateInput
                          value={incomeDueDate}
                          onChange={(e) => setIncomeDueDate(e.target.value)}
                        />
                        {incomeMethod !== "check" ? (
                          <span className="block text-[11px] text-muted-foreground">
                            לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                          </span>
                        ) : null}
                      </label>

                      <label className="space-y-2 text-sm">
                        <span>{HEBREW.reference}</span>
                        <Input
                          value={incomeReference}
                          onChange={(e) => setIncomeReference(e.target.value)}
                        />
                      </label>
                    </AdaptiveGrid>
                  ) : null}

                  {incomeMethod === "check" ? (
                    <CheckDetailsFields
                      checkNumber={incomeCheckNumber}
                      onCheckNumberChange={setIncomeCheckNumber}
                      photoFiles={incomeCheckPhotoFiles}
                      onPhotoFilesChange={setIncomeCheckPhotoFiles}
                      disabled={incomeSubmitting}
                    />
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
                </>
              ) : null}
            </div>
          </fieldset>

          {incomeError ? <p className="text-sm text-destructive">{incomeError}</p> : null}

          <div className="mt-4 flex justify-end gap-2">
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

