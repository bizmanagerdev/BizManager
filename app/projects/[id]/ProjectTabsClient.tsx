"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BadgeProps } from "@/components/ui/badge";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientOnly } from "@/components/ClientOnly";
import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

type ProjectOverview = {
  id: string;
  name: string;
  status: string;
  project_type: string;
  start_date: string | null;
  end_date: string | null;
  agreed_base_price: string | number | null;
  actual_price: string | number | null;
  expenses_billed_separately: boolean | null;
  customer_id: string;
  customer_name: string;
  project_manager_id: string | null;
  project_manager_name: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectFinancials = {
  id: string;
  agreed_base_price: string | number | null;
  actual_price: string | number | null;
  total_expenses: string | number | null;
  gross_profit: string | number | null;
} | null;

type ProjectTaskProgress = {
  project_id: string;
  total_tasks: number | string | null;
  completed_tasks: number | string | null;
  open_tasks: number | string | null;
} | null;

type ProjectExpenseSummary = {
  project_id: string;
  expense_count: number | string | null;
  total_expenses: number | string | null;
  expenses_included: number | string | null;
  expenses_billed: number | string | null;
} | null;

type ExpenseListItem = {
  project_expense: Record<string, unknown>;
  expense: Record<string, unknown> | null;
};

type PaymentRow = {
  id: string;
  target_type: string;
  target_id: string;
  payment_date: string | null;
  amount_total: number | string | null;
  payment_method: string | null;
  reference_number: string | null;
  vat_amount: number | string | null;
  amount_before_vat: number | string | null;
  net_amount: number | string | null;
  notes: string | null;
  created_at: string | null;
};

type AssignableUser = {
  id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  active: boolean | null;
};

type ProjectStatus = "planned" | "active" | "on_hold" | "completed" | "cancelled";
type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
type TaskPriority = "low" | "medium" | "high" | "urgent";

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatIls(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL").format(date);
}

function getString(row: Record<string, unknown> | null, key: string) {
  if (!row) return null;
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getFirstString(row: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value) return value;
  }
  return null;
}

function getFirstDate(row: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = getString(row, key);
    if (value) return value;
  }
  return null;
}

function taskStatusLabel(status: TaskStatus | string) {
  switch (status) {
    case "todo":
      return "לביצוע";
    case "in_progress":
      return "בתהליך";
    case "blocked":
      return "חסום";
    case "done":
      return "בוצע";
    case "cancelled":
      return "בוטל";
    default:
      return status;
  }
}

function taskPriorityLabel(priority: TaskPriority | string) {
  switch (priority) {
    case "low":
      return "נמוכה";
    case "medium":
      return "בינונית";
    case "high":
      return "גבוהה";
    case "urgent":
      return "דחופה";
    default:
      return priority;
  }
}

function priorityToBadgeVariant(
  priority: TaskPriority | string
): BadgeProps["variant"] {
  switch (priority) {
    case "low":
      return "secondary";
    case "medium":
      return "warning";
    case "high":
      return "destructive";
    case "urgent":
      return "destructive";
    default:
      return "outline";
  }
}

function statusToBadgeVariant(status: TaskStatus | string): BadgeProps["variant"] {
  switch (status) {
    case "done":
      return "success";
    case "in_progress":
      return "warning";
    case "blocked":
      return "destructive";
    case "cancelled":
      return "outline";
    case "todo":
      return "secondary";
    default:
      return "outline";
  }
}

type CashFlowEvent =
  | {
      type: "income";
      id: string;
      date: string | null;
      amount: number | null;
      title: string;
      meta: string[];
    }
  | {
      type: "expense";
      id: string;
      date: string | null;
      amount: number | null;
      title: string;
      meta: string[];
      includedInBase: boolean;
      billedToCustomer: boolean;
    };

export default function ProjectTabsClient({
  overview,
  financials,
  tasks,
  projectTasks,
  projectTasksError,
  assignableUsers,
  assignableUsersError,
  expenseSummary,
  expenseSummaryError,
  expenses,
  expensesError,
  payments,
  paymentsError,
}: {
  overview: ProjectOverview;
  financials: ProjectFinancials;
  tasks: ProjectTaskProgress;
  projectTasks: Record<string, unknown>[];
  projectTasksError: string | null;
  assignableUsers: AssignableUser[];
  assignableUsersError: string | null;
  expenseSummary: ProjectExpenseSummary;
  expenseSummaryError: string | null;
  expenses: ExpenseListItem[];
  expensesError: string | null;
  payments: PaymentRow[];
  paymentsError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const tabFromUrl = searchParams.get("tab");
  const [tabValue, setTabValue] = useState(tabFromUrl ?? "overview");

  useEffect(() => {
    // Sync state when the URL changes via navigation/back/forward.
    setTabValue(tabFromUrl ?? "overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabFromUrl]);

  function setTab(next: string) {
    setTabValue(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);
  const totalTasks = toNumber(tasks?.total_tasks) ?? 0;
  const completedTasks = toNumber(tasks?.completed_tasks) ?? 0;
  const openTasks = toNumber(tasks?.open_tasks) ?? 0;
  const completion =
    totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const agreedBasePrice =
    toNumber(financials?.agreed_base_price ?? overview.agreed_base_price) ?? null;
  const actualPrice =
    toNumber(financials?.actual_price ?? overview.actual_price) ?? null;
  const totalExpenses = toNumber(financials?.total_expenses) ?? null;
  const grossProfit = toNumber(financials?.gross_profit) ?? null;

  const expenseCount = toNumber(expenseSummary?.expense_count);
  const includedExpenses = toNumber(expenseSummary?.expenses_included);
  const billedExpenses = toNumber(expenseSummary?.expenses_billed);
  const paymentsTotal = payments.reduce((sum, p) => sum + (toNumber(p.amount_total) ?? 0), 0);
  const expensesTotal = expenses.reduce((sum, item) => sum + (toNumber(item.expense?.amount) ?? 0), 0);

  const tasksSorted = useMemo(() => {
    const copy = [...projectTasks];
    copy.sort((a, b) => {
      const ad =
        getFirstDate(a, ["due_date", "deadline", "task_date", "created_at", "updated_at"]) ??
        "";
      const bd =
        getFirstDate(b, ["due_date", "deadline", "task_date", "created_at", "updated_at"]) ??
        "";
      const at = ad ? new Date(ad).getTime() : 0;
      const bt = bd ? new Date(bd).getTime() : 0;
      return bt - at;
    });
    return copy;
  }, [projectTasks]);

  const usersById = useMemo(() => {
    const map = new Map<string, AssignableUser>();
    for (const u of assignableUsers) map.set(u.id, u);
    return map;
  }, [assignableUsers]);

  const cashFlow = (() => {
    const incomeEvents: CashFlowEvent[] = payments.map((p) => {
      const date = p.payment_date ?? p.created_at ?? null;
      const amount = toNumber(p.amount_total);
      const reference = p.reference_number ?? "";
      const method = p.payment_method ?? "";

      const meta: string[] = [];
      if (method) meta.push(method);
      if (reference) meta.push(`אסמכתא: ${reference}`);

      return {
        type: "income",
        id: p.id,
        date,
        amount,
        title: "הכנסה",
        meta,
      };
    });

    const expenseEvents: CashFlowEvent[] = expenses.map((item, idx) => {
      const expenseId = getString(item.project_expense, "expense_id") ?? String(idx);
      const date =
        getString(item.expense, "expense_date") ??
        getString(item.expense, "created_at") ??
        null;
      const amount = toNumber(item.expense?.amount);

      const category = getString(item.expense, "category");
      const description = getString(item.expense, "description");
      const title =
        (category && description && `${category} — ${description}`) ||
        category ||
        description ||
        "הוצאה";

      const includedInBase = Boolean(item.project_expense["included_in_base_price"]);
      const billedToCustomer = Boolean(item.project_expense["billed_to_customer"]);

      const meta: string[] = [];
      if (includedInBase) meta.push("נכלל בבסיס");
      if (billedToCustomer) meta.push("חויב ללקוח");

      return {
        type: "expense",
        id: expenseId,
        date,
        amount,
        title,
        meta,
        includedInBase,
        billedToCustomer,
      };
    });

    const all = [...incomeEvents, ...expenseEvents];

    all.sort((a, b) => {
      const at = a.date ? new Date(a.date).getTime() : 0;
      const bt = b.date ? new Date(b.date).getTime() : 0;
      return bt - at;
    });

    return all;
  })();

  return (
    <ClientOnly
      fallback={<div className="text-muted-foreground text-base">טוען…</div>}
    >
      <Tabs value={tabValue} onValueChange={setTab} dir="rtl">
      <TabsList>
        <TabsTrigger value="overview">סקירה</TabsTrigger>
        <TabsTrigger value="financial">פיננסי</TabsTrigger>
        <TabsTrigger value="tasks">משימות</TabsTrigger>
        <TabsTrigger value="documents">מסמכים</TabsTrigger>
        <TabsTrigger value="payments">תשלומים</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">מחירים</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מחיר בסיס</span>
                <span>{formatIls(agreedBasePrice)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מחיר בפועל</span>
                <span>{formatIls(actualPrice)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">פיננסים</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">הוצאות</span>
                <span>{formatIls(totalExpenses)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">רווח גולמי</span>
                <span className={grossProfit !== null && grossProfit < 0 ? "text-destructive" : ""}>
                  {formatIls(grossProfit)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">התקדמות</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">משימות פתוחות</span>
                <span>{openTasks}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">השלמה</span>
                <span>{completion}%</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מנהל פרויקט</span>
                <span className="truncate">
                  {overview.project_manager_name ?? "—"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תאריכים</CardTitle>
            </CardHeader>
            <CardContent className="text-sm grid gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">תאריך התחלה</span>
                <span>{formatDate(overview.start_date)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">תאריך סיום</span>
                <span>{formatDate(overview.end_date)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="financial">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">סיכום</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מחיר בסיס שסוכם</span>
                <span>{formatIls(agreedBasePrice)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">מחיר בפועל</span>
                <span>{formatIls(actualPrice)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">הוצאות</span>
                <span>{formatIls(totalExpenses)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">רווח גולמי</span>
                <span
                  className={
                    grossProfit !== null && grossProfit < 0
                      ? "text-destructive"
                      : ""
                  }
                >
                  {formatIls(grossProfit)}
                </span>
              </div>
              <div className="text-muted-foreground text-sm pt-2">
                שים לב: הוצאות “נכלל בבסיס” לא אמורות לייצר חיוב נוסף ללקוח.
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">תזרים</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              {cashFlow.length === 0 ? (
                <div className="text-muted-foreground">אין תנועות להצגה.</div>
              ) : (
                <div className="divide-y">
                  {cashFlow.map((ev) => {
                    const isIncome = ev.type === "income";
                    const signedAmount =
                      ev.amount === null ? null : isIncome ? ev.amount : -ev.amount;
                    const amountText =
                      signedAmount === null
                        ? "—"
                        : formatIls(Math.abs(signedAmount));

                    return (
                      <div
                        key={`${ev.type}:${ev.id}`}
                        className="py-3 flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{ev.title}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span>{formatDate(ev.date)}</span>
                            {ev.meta.map((m) => (
                              <span key={m}>{m}</span>
                            ))}
                          </div>
                        </div>

                        <div
                          className={
                            "shrink-0 font-medium " +
                            (signedAmount === null
                              ? ""
                              : isIncome
                              ? "text-success"
                              : "text-destructive")
                          }
                        >
                          {signedAmount === null ? "" : isIncome ? "+" : "-"} {amountText}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-base">הוצאות</CardTitle>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAddExpenseOpen(true)}
              >
                הוספת הוצאה
              </Button>
            </CardHeader>
            <CardContent className="text-sm">
              {expensesError ? (
                <div className="text-destructive text-sm">
                  שגיאה בטעינת הוצאות: {expensesError}
                </div>
              ) : expenses.length === 0 ? (
                <div className="text-muted-foreground">אין הוצאות להצגה.</div>
              ) : (
                <div className="divide-y">
                  {expenses.map((item, idx) => {
                    const expenseId = getString(item.project_expense, "expense_id");
                    const amount = toNumber(item.expense?.amount);
                    const createdAt =
                      getString(item.expense, "expense_date") ??
                      getString(item.expense, "created_at") ??
                      null;

                    const title =
                      getString(item.expense, "description") ??
                      getString(item.expense, "vendor_name") ??
                      getString(item.expense, "vendor") ??
                      (expenseId ? `הוצאה ${expenseId.slice(0, 8)}` : "הוצאה");

                    const included = Boolean(item.project_expense["included_in_base_price"]);
                    const billed = Boolean(item.project_expense["billed_to_customer"]);

                    return (
                      <div key={expenseId ?? String(idx)} className="py-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{title}</div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span>{formatDate(createdAt)}</span>
                            {included ? <span>נכלל בבסיס</span> : <span>לא נכלל בבסיס</span>}
                            {billed ? <span>חויב ללקוח</span> : <span>לא חויב ללקוח</span>}
                          </div>
                        </div>
                        <div className="shrink-0 font-medium">
                          {amount === null ? "—" : formatIls(amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 pt-3 border-t flex items-center justify-between">
                <span className="text-muted-foreground">סה״כ הוצאות</span>
                <span className="font-medium">{formatIls(expensesTotal)}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader className="pb-3 flex-row items-center justify-between">
              <CardTitle className="text-base">הכנסות</CardTitle>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAddIncomeOpen(true)}
              >
                הוספת הכנסה
              </Button>
            </CardHeader>
            <CardContent className="text-sm">
              {paymentsError ? (
                <div className="text-destructive text-sm">
                  שגיאה בטעינת הכנסות: {paymentsError}
                </div>
              ) : payments.length === 0 ? (
                <div className="text-muted-foreground">אין הכנסות להצגה.</div>
              ) : (
                <div className="divide-y">
                  {payments.map((p) => {
                    const amount = toNumber(p.amount_total);
                    const date = p.payment_date ?? p.created_at ?? null;
                    const method = p.payment_method ?? "—";
                    const reference = p.reference_number ?? "";

                    return (
                      <div key={p.id} className="py-3 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {reference ? `אסמכתא: ${reference}` : "הכנסה"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            <span>{formatDate(date)}</span>
                            <span>{method}</span>
                          </div>
                          {p.notes ? (
                            <div className="text-xs text-muted-foreground mt-1 truncate">
                              {p.notes}
                            </div>
                          ) : null}
                        </div>
                        <div className="shrink-0 font-medium">
                          {amount === null ? "—" : formatIls(amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 pt-3 border-t flex items-center justify-between">
                <span className="text-muted-foreground">סה״כ הכנסות</span>
                <span className="font-medium">{formatIls(paymentsTotal)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="tasks">
        <ProjectTasksTab
          projectId={overview.id}
          customerId={overview.customer_id}
          totalTasks={totalTasks}
          completedTasks={completedTasks}
          openTasks={openTasks}
          tasks={tasksSorted}
          error={projectTasksError}
          usersById={usersById}
          assignableUsers={assignableUsers}
          assignableUsersError={assignableUsersError}
          onChange={() => router.refresh()}
        />
      </TabsContent>

      <TabsContent value="documents">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">מסמכים</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            הבא: `project_documents_view` + העלאה ל-Supabase Storage.
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="payments">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">תשלומים</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            הבא: תשלומים לפי project_id + מצב חשבוניות.
          </CardContent>
        </Card>
      </TabsContent>

      <AddExpenseDialog
        open={addExpenseOpen}
        onOpenChange={setAddExpenseOpen}
        projectId={overview.id}
        onCreated={() => router.refresh()}
      />
      <AddIncomeDialog
        open={addIncomeOpen}
        onOpenChange={setAddIncomeOpen}
        projectId={overview.id}
        onCreated={() => router.refresh()}
      />
      </Tabs>
    </ClientOnly>
  );
}

function ProjectTasksTab({
  projectId,
  customerId,
  totalTasks,
  completedTasks,
  openTasks,
  tasks,
  error,
  usersById,
  assignableUsers,
  assignableUsersError,
  onChange,
}: {
  projectId: string;
  customerId: string;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  tasks: Record<string, unknown>[];
  error: string | null;
  usersById: Map<string, AssignableUser>;
  assignableUsers: AssignableUser[];
  assignableUsersError: string | null;
  onChange: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{
    id: string;
    next: string;
    subject: string;
    current: string;
  } | null>(null);
  const [confirmPriorityOpen, setConfirmPriorityOpen] = useState(false);
  const [savingPriority, setSavingPriority] = useState(false);
  const [pendingPriority, setPendingPriority] = useState<{
    id: string;
    next: TaskPriority;
    subject: string;
    current: TaskPriority;
  } | null>(null);

  const [localTasks, setLocalTasks] = useState<Record<string, unknown>[]>(tasks);
  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>("");
  const [assignedUserId, setAssignedUserId] = useState<string>("");

  const statusOptions = useMemo(() => {
    return ["todo", "in_progress", "blocked", "done", "cancelled"] as TaskStatus[];
  }, []);

  const priorityOptions = useMemo(() => {
    return ["low", "medium", "high", "urgent"] as TaskPriority[];
  }, []);

  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");

  const effectiveStatus = (status || statusOptions[0] || "todo") as TaskStatus;
  const effectivePriority = (priority || priorityOptions[0] || "") as TaskPriority;
  const canSubmit =
    Boolean(subject.trim()) &&
    Boolean(dueDate) &&
    Boolean(assignedUserId) &&
    Boolean(effectivePriority) &&
    Boolean(effectiveStatus);

  async function createTask() {
    if (!canSubmit) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          customer_id: customerId,
          subject,
          description: description.trim() ? description : undefined,
          due_date: dueDate ? dueDate : null,
          assigned_user_id: assignedUserId ? assignedUserId : null,
          status: effectiveStatus,
          priority: effectivePriority,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה ביצירת משימה", { description: json?.error ?? "" });
        return;
      }
      toast.success("המשימה נוצרה");
      setCreateOpen(false);
      setSubject("");
      setDescription("");
      setDueDate("");
      setAssignedUserId("");
      setPriority("");
      setStatus("");
      onChange();
    } catch (e: any) {
      toast.error("שגיאה ביצירת משימה", { description: e?.message ?? "" });
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(id: string, status: TaskStatus) {
    setUpdatingId(id);
    try {
      const res = await fetch("/api/tasks/update-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה בעדכון סטטוס", { description: json?.error ?? "" });
        return false;
      }
      toast.success("הסטטוס עודכן");
      setLocalTasks((prev) =>
        prev.map((row) => {
          const rowId = getFirstString(row, ["task_id", "id"]);
          if (rowId !== id) return row;
          return { ...row, status };
        })
      );
      onChange();
      return true;
    } catch (e: any) {
      toast.error("שגיאה בעדכון סטטוס", { description: e?.message ?? "" });
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  async function updatePriority(id: string, priority: TaskPriority) {
    setUpdatingId(id);
    try {
      const res = await fetch("/api/tasks/update-priority", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, priority }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה בעדכון עדיפות", { description: json?.error ?? "" });
        return false;
      }
      toast.success("העדיפות עודכנה");
      setLocalTasks((prev) =>
        prev.map((row) => {
          const rowId = getFirstString(row, ["task_id", "id"]);
          if (rowId !== id) return row;
          return { ...row, priority };
        })
      );
      onChange();
      return true;
    } catch (e: any) {
      toast.error("שגיאה בעדכון עדיפות", { description: e?.message ?? "" });
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  function requestStatusChange(args: {
    id: string;
    next: TaskStatus;
    subject: string;
    current: TaskStatus;
  }) {
    setPendingStatus(args);
    setConfirmOpen(true);
  }

  async function confirmStatusChange() {
    if (!pendingStatus) return;
    setSavingStatus(true);
    try {
      const ok = await updateStatus(
        pendingStatus.id,
        pendingStatus.next as TaskStatus
      );
      if (ok) {
        setConfirmOpen(false);
        setPendingStatus(null);
      }
    } finally {
      setSavingStatus(false);
    }
  }

  function requestPriorityChange(args: {
    id: string;
    next: TaskPriority;
    subject: string;
    current: TaskPriority;
  }) {
    setPendingPriority(args);
    setConfirmPriorityOpen(true);
  }

  async function confirmPriorityChange() {
    if (!pendingPriority) return;
    setSavingPriority(true);
    try {
      const ok = await updatePriority(pendingPriority.id, pendingPriority.next);
      if (ok) {
        setConfirmPriorityOpen(false);
        setPendingPriority(null);
      }
    } finally {
      setSavingPriority(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between">
          <CardTitle className="text-base">משימות</CardTitle>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            הוספת משימה
          </Button>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="flex flex-wrap gap-2 mb-3">
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">סה״כ</div>
              <div className="font-medium">{totalTasks}</div>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">פתוחות</div>
              <div className="font-medium">{openTasks}</div>
            </div>
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs text-muted-foreground">הושלמו</div>
              <div className="font-medium">{completedTasks}</div>
            </div>
          </div>

          {error ? (
            <div className="text-destructive text-sm">
              שגיאה בטעינת משימות: {error}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-muted-foreground">אין משימות להצגה.</div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-right font-medium px-3 py-2">משימה</th>
                    <th className="text-right font-medium px-3 py-2">תאריך יעד</th>
                    <th className="text-right font-medium px-3 py-2">משויך</th>
                    <th className="text-right font-medium px-3 py-2">עדיפות</th>
                    <th className="text-right font-medium px-3 py-2">סטטוס</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {localTasks.map((t) => {
                    const taskId =
                      getFirstString(t, ["task_id", "id"]) ?? "";
                    const title =
                      getFirstString(t, [
                        "subject",
                        "title",
                        "name",
                        "task_title",
                        "summary",
                      ]) ?? "משימה";
                    const status =
                      (getFirstString(t, ["status", "task_status"]) ??
                        "todo") as TaskStatus;
                    const due =
                      getFirstDate(t, ["due_date", "deadline", "end_date"]) ??
                      null;
                    const priority =
                      (getFirstString(t, ["priority"]) ?? "") as TaskPriority | "";
                    const assignee =
                      getFirstString(t, [
                        "assigned_user_name",
                        "assigned_to_name",
                        "assignee_name",
                        "assigned_to_full_name",
                      ]) ??
                      (() => {
                        const id = getFirstString(t, ["assigned_user_id"]);
                        if (!id) return null;
                        const u = usersById.get(id);
                        return u?.full_name ?? u?.email ?? null;
                      })() ??
                      null;

                    const disabled = !taskId || updatingId === taskId;

                    return (
                      <tr key={taskId || title} className="hover:bg-muted/30">
                        <td className="px-3 py-2">
                          {taskId ? (
                            <Link
                              href={`/tasks/${taskId}?returnTo=${encodeURIComponent(
                                `/projects/${projectId}?tab=tasks`
                              )}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {title}
                            </Link>
                          ) : (
                            <span className="font-medium">{title}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {due ? formatDate(due) : "—"}
                        </td>
                        <td className="px-3 py-2">
                          {assignee ? assignee : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {priority ? (
                            <PriorityDropdown
                              priority={priority}
                              options={priorityOptions}
                              disabled={disabled}
                              onSelect={(next) => {
                                if (next === priority) return;
                                requestPriorityChange({
                                  id: taskId,
                                  next,
                                  subject: title,
                                  current: priority,
                                });
                              }}
                            />
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusDropdown
                            status={status}
                            options={statusOptions}
                            disabled={disabled}
                            onSelect={(next) => {
                              if (next === status) return;
                              requestStatusChange({
                                id: taskId,
                                next,
                                subject: title,
                                current: status,
                              });
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>אישור שינוי סטטוס</DialogTitle>
            <DialogDescription>
              {pendingStatus
                ? `לשנות את הסטטוס של “${pendingStatus.subject}” מ־${taskStatusLabel(
                    pendingStatus.current
                  )} ל־${taskStatusLabel(pendingStatus.next)}?`
                : " "}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={savingStatus}
              onClick={() => {
                setConfirmOpen(false);
                setPendingStatus(null);
              }}
            >
              ביטול
            </Button>
            <Button
              type="button"
              disabled={savingStatus}
              onClick={() => void confirmStatusChange()}
            >
              {savingStatus ? "מעדכן..." : "אישור"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmPriorityOpen}
        onOpenChange={setConfirmPriorityOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>אישור שינוי עדיפות</DialogTitle>
            <DialogDescription>
              {pendingPriority
                ? `לשנות את העדיפות של “${pendingPriority.subject}” מ־${taskPriorityLabel(
                    pendingPriority.current
                  )} ל־${taskPriorityLabel(pendingPriority.next)}?`
                : " "}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="secondary"
              disabled={savingPriority}
              onClick={() => {
                setConfirmPriorityOpen(false);
                setPendingPriority(null);
              }}
            >
              ביטול
            </Button>
            <Button
              type="button"
              disabled={savingPriority}
              onClick={() => void confirmPriorityChange()}
            >
              {savingPriority ? "מעדכן..." : "אישור"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>הוספת משימה</DialogTitle>
            <DialogDescription>משימה תתווסף לפרויקט ותופיע ברשימה.</DialogDescription>
          </DialogHeader>

          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createTask();
            }}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium">כותרת *</div>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="לדוגמה: להתקשר לספק"
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תיאור (אופציונלי)</div>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="פרטים נוספים..."
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך יעד *</div>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">שיוך למשתמש *</div>
              {assignableUsersError ? (
                <div className="text-xs text-destructive">
                  שגיאה בטעינת משתמשים: {assignableUsersError}
                </div>
              ) : (
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={assignedUserId}
                  onChange={(e) => setAssignedUserId(e.target.value)}
                >
                  <option value="">בחר משתמש…</option>
                  {assignableUsers
                    .filter((u) => u.active !== false)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name ?? u.email}
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">עדיפות *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={effectivePriority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {priorityOptions.map((p) => (
                    <option key={p} value={p}>
                      {taskPriorityLabel(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">סטטוס *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={effectiveStatus}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {taskStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreateOpen(false)}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={creating || !canSubmit}>
                {creating ? "יוצר..." : "יצירה"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusDropdown({
  status,
  options,
  disabled,
  onSelect,
}: {
  status: TaskStatus;
  options: TaskStatus[];
  disabled: boolean;
  onSelect: (next: TaskStatus) => void;
}) {
  const variant = statusToBadgeVariant(status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled}>
          <Badge
            variant={variant}
            className="h-9 px-3 text-sm cursor-pointer select-none"
          >
            {taskStatusLabel(status)}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)}>
            <span className="me-2">
              <span
                className={
                  "inline-block h-2.5 w-2.5 rounded-full " +
                  (statusToBadgeVariant(opt) === "success"
                    ? "bg-success"
                    : statusToBadgeVariant(opt) === "warning"
                    ? "bg-warning"
                    : statusToBadgeVariant(opt) === "destructive"
                    ? "bg-destructive"
                    : statusToBadgeVariant(opt) === "secondary"
                    ? "bg-muted-foreground/40"
                    : "bg-border")
                }
              />
            </span>
            {taskStatusLabel(opt)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-xs text-muted-foreground">
          שינוי סטטוס יעדכן את המשימה
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityDropdown({
  priority,
  options,
  disabled,
  onSelect,
}: {
  priority: TaskPriority;
  options: TaskPriority[];
  disabled: boolean;
  onSelect: (next: TaskPriority) => void;
}) {
  const variant = priorityToBadgeVariant(priority);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" disabled={disabled}>
          <Badge
            variant={variant}
            className="h-9 px-3 text-sm cursor-pointer select-none"
          >
            {taskPriorityLabel(priority)}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {options.map((opt) => (
          <DropdownMenuItem key={opt} onClick={() => onSelect(opt)}>
            <span className="me-2">
              <span
                className={
                  "inline-block h-2.5 w-2.5 rounded-full " +
                  (priorityToBadgeVariant(opt) === "destructive"
                    ? "bg-destructive"
                    : priorityToBadgeVariant(opt) === "warning"
                    ? "bg-warning"
                    : priorityToBadgeVariant(opt) === "secondary"
                    ? "bg-muted-foreground/40"
                    : "bg-border")
                }
              />
            </span>
            {taskPriorityLabel(opt)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="px-2 py-1 text-xs text-muted-foreground">
          שינוי עדיפות יעדכן את המשימה
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddExpenseDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [businessDomain, setBusinessDomain] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [includedInBase, setIncludedInBase] = useState(false);
  const [billedToCustomer, setBilledToCustomer] = useState(false);
  const canSubmit =
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    Boolean(category.trim()) &&
    Boolean(expenseDate);

  async function submit() {
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return;
    if (!category.trim()) return;
    if (!expenseDate) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/expenses/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          amount: amountNumber,
          category,
          description: description.trim() ? description : undefined,
          business_domain: businessDomain.trim() ? businessDomain : undefined,
          notes: notes.trim() ? notes : undefined,
          expense_date: expenseDate ? expenseDate : null,
          included_in_base_price: includedInBase,
          billed_to_customer: billedToCustomer,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה בהוספת הוצאה", { description: json?.error ?? "" });
        return;
      }
      toast.success("ההוצאה נוספה");
      onOpenChange(false);
      setAmount("");
      setCategory("");
      setDescription("");
      setBusinessDomain("");
      setExpenseDate("");
      setNotes("");
      setIncludedInBase(false);
      setBilledToCustomer(false);
      onCreated();
    } catch (e: any) {
      toast.error("שגיאה בהוספת הוצאה", { description: e?.message ?? "" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>הוספת הוצאה</DialogTitle>
          <DialogDescription>ההוצאה תקושר לפרויקט ותופיע בפיננסי.</DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">סכום *</div>
              <Input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="לדוגמה: 250"
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">קטגוריה *</div>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="לדוגמה: דלק"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">תיאור (אופציונלי)</div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="לדוגמה: נסיעה לאתר"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום (אופציונלי)</div>
              <Input
                value={businessDomain}
                onChange={(e) => setBusinessDomain(e.target.value)}
                placeholder="לדוגמה: לוגיסטיקה"
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך *</div>
              <Input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includedInBase}
                onChange={(e) => setIncludedInBase(e.target.checked)}
              />
              <span>נכלל בבסיס</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={billedToCustomer}
                onChange={(e) => setBilledToCustomer(e.target.checked)}
              />
              <span>לחיוב לקוח</span>
            </label>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">הערות (אופציונלי)</div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="הערות פנימיות..."
            />
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={submitting || !canSubmit}
            >
              {submitting ? "שומר..." : "שמירה"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddIncomeDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const canSubmit =
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    Boolean(paymentDate) &&
    Boolean(paymentMethod.trim());

  async function submit() {
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return;
    if (!paymentDate) return;
    if (!paymentMethod.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: "project",
          target_id: projectId,
          amount_total: amountNumber,
          payment_date: paymentDate ? paymentDate : null,
          payment_method: paymentMethod.trim() ? paymentMethod : undefined,
          reference_number: referenceNumber.trim() ? referenceNumber : undefined,
          notes: notes.trim() ? notes : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error("שגיאה בהוספת הכנסה", { description: json?.error ?? "" });
        return;
      }
      toast.success("ההכנסה נוספה");
      onOpenChange(false);
      setAmount("");
      setPaymentDate("");
      setPaymentMethod("");
      setReferenceNumber("");
      setNotes("");
      onCreated();
    } catch (e: any) {
      toast.error("שגיאה בהוספת הכנסה", { description: e?.message ?? "" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>הוספת הכנסה</DialogTitle>
          <DialogDescription>ההכנסה תירשם כתקבול לפרויקט.</DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">סכום *</div>
              <Input
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="לדוגמה: 5000"
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך *</div>
              <Input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">אמצעי תשלום *</div>
              <Input
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                placeholder="לדוגמה: העברה בנקאית"
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">אסמכתא (אופציונלי)</div>
              <Input
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="מספר קבלה/העברה"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">הערות (אופציונלי)</div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="הערות..."
            />
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={submitting || !canSubmit}
            >
              {submitting ? "שומר..." : "שמירה"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
