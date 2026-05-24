"use client";

import Link from "next/link";
import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import { cn } from "@/lib/utils";
import type { ObligationsData, UnpaidExpenseItem } from "@/lib/financial/obligations";

const ILS = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
function fmt(v: number) { return ILS.format(v); }

function formatDate(s: string | null) {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
  catch { return s; }
}

function paymentStatusLabel(s: string | null) {
  if (s === "paid") return "שולם";
  if (s === "partial") return "חלקי";
  return "לא שולם";
}

function paymentMethodLabel(m: string | null) {
  if (m === "bank_transfer") return "העברה בנקאית";
  if (m === "cash") return "מזומן";
  if (m === "check") return "צ'ק";
  if (m === "credit_card") return "כרטיס אשראי";
  if (m === "other") return "אחר";
  return null;
}

type Props = {
  data: ObligationsData;
  canManageExpenses: boolean;
};

export function ObligationsTab({ data, canManageExpenses }: Props) {
  const router = useRouter();
  const [editingExpense, setEditingExpense] = useState<UnpaidExpenseItem | null>(null);

  const [isRefreshPending, startRefreshTransition] = useTransition();
  const refreshResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!isRefreshPending && refreshResolveRef.current) {
      const resolve = refreshResolveRef.current;
      refreshResolveRef.current = null;
      resolve();
    }
  }, [isRefreshPending]);

  function refreshAndWait() {
    return new Promise<void>((resolve) => {
      refreshResolveRef.current = resolve;
      startRefreshTransition(() => { router.refresh(); });
    });
  }

  const totalOwed = data.unpaidExpenses.reduce((s, e) => s + (e.amount - (e.paid_amount ?? 0)), 0)
    + data.workerDebts.reduce((s, w) => s + w.owed_amount, 0);
  const totalReceivable = data.unpaidOrders.reduce((s, o) => s + o.remaining_balance, 0)
    + data.projectBalances.reduce((s, p) => s + p.outstanding, 0);

  return (
    <div dir="rtl" className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-destructive/5 p-3 text-center">
          <div className="text-xs text-muted-foreground">הוצאות לא שולמו</div>
          <div className="mt-1 text-base font-semibold text-destructive" dir="ltr">{fmt(totalOwed)}</div>
        </div>
        <div className="rounded-xl border bg-success/5 p-3 text-center">
          <div className="text-xs text-muted-foreground">חייבים לי</div>
          <div className="mt-1 text-base font-semibold text-success" dir="ltr">{fmt(totalReceivable)}</div>
        </div>
        <div className="rounded-xl border bg-muted/30 p-3 text-center">
          <div className="text-xs text-muted-foreground">הוצאות פתוחות</div>
          <div className="mt-1 text-base font-semibold">{data.unpaidExpenses.length}</div>
        </div>
        <div className="rounded-xl border bg-muted/30 p-3 text-center">
          <div className="text-xs text-muted-foreground">עסקות פתוחות</div>
          <div className="mt-1 text-base font-semibold">{data.unpaidOrders.length + data.projectBalances.length}</div>
        </div>
      </div>

      {/* What I owe */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-right">מה אני חייב</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.unpaidExpenses.length === 0 && data.workerDebts.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">אין חובות פתוחים</div>
          ) : (
            <div className="divide-y">
              {data.unpaidExpenses.map((expense) => {
                const remaining = expense.amount - (expense.paid_amount ?? 0);
                const method = paymentMethodLabel(expense.payment_method);
                const status = expense.payment_status ?? "not_paid";
                return (
                  <div key={expense.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-medium">{expense.description ?? expense.category ?? "הוצאה"}</span>
                        {expense.category && expense.description ? (
                          <span className="text-xs text-muted-foreground">{expense.category}</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        {expense.expense_date ? <span dir="ltr">{formatDate(expense.expense_date)}</span> : null}
                        {expense.source_label ? <span>{expense.source_label}</span> : null}
                        <span className={cn(
                          "rounded-full border px-1.5 py-0.5 font-medium",
                          status === "partial" ? "border-warning/40 bg-warning/15 text-warning-strong" : "border-destructive/40 bg-destructive/10 text-destructive"
                        )}>
                          {paymentStatusLabel(status)}
                        </span>
                        {expense.paid_amount != null && expense.paid_amount > 0 ? <span>שולם {fmt(expense.paid_amount)}</span> : null}
                        {method ? <span>{method}</span> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-left" dir="ltr">
                        <div className="font-semibold text-destructive">{fmt(remaining)}</div>
                        {status === "partial" ? (
                          <div className="text-xs text-muted-foreground">{fmt(expense.amount)} סה&quot;כ</div>
                        ) : null}
                      </div>
                      {canManageExpenses ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => setEditingExpense(expense)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {data.workerDebts.map((worker) => (
                <div key={worker.user_id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{worker.worker_name ?? "עובד"}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>שכר עבודה</span>
                      <span>הרוויח {fmt(worker.earned_amount)}</span>
                      <span>קיבל {fmt(worker.paid_amount)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="font-semibold text-destructive" dir="ltr">{fmt(worker.owed_amount)}</div>
                    <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <Link href="/payroll">
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* What's owed to me */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-right">מה חייבים לי</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.unpaidOrders.length === 0 && data.projectBalances.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">אין יתרות פתוחות</div>
          ) : (
            <div className="divide-y">
              {data.projectBalances.map((project) => (
                <div key={project.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{project.name ?? `פרויקט ${project.id.slice(0, 8)}`}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {project.customer_name ? <span>{project.customer_name}</span> : null}
                      {project.customer_phone ? (
                        <a
                          href={`tel:${project.customer_phone}`}
                          className="font-medium text-primary hover:underline"
                          dir="ltr"
                        >
                          {project.customer_phone}
                        </a>
                      ) : null}
                      <span>מחיר כולל {fmt(project.customer_total_price)}</span>
                      {project.total_paid > 0 ? <span>שולם {fmt(project.total_paid)}</span> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="font-semibold text-success" dir="ltr">{fmt(project.outstanding)}</div>
                    <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <Link href={`/projects/${project.id}`}>
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}

              {data.unpaidOrders.map((order) => (
                <div key={order.order_id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{order.customer_name ?? `הזמנה ${order.order_id.slice(0, 8)}`}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {order.customer_phone ? (
                        <a
                          href={`tel:${order.customer_phone}`}
                          className="font-medium text-primary hover:underline"
                          dir="ltr"
                        >
                          {order.customer_phone}
                        </a>
                      ) : null}
                      {order.order_date ? <span dir="ltr">{formatDate(order.order_date)}</span> : null}
                      <span className={cn(
                        "rounded-full border px-1.5 py-0.5 font-medium",
                        order.payment_status === "partial" ? "border-warning/40 bg-warning/15 text-warning-strong" : "border-destructive/40 bg-destructive/10 text-destructive"
                      )}>
                        {paymentStatusLabel(order.payment_status)}
                      </span>
                      <span>סה&quot;כ {fmt(order.total_amount)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="font-semibold text-success" dir="ltr">{fmt(order.remaining_balance)}</div>
                    <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <Link href={`/sales?order=${order.order_id}`}>
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit expense dialog */}
      {editingExpense ? (
        <ExpenseDialog
          open={Boolean(editingExpense)}
          onOpenChange={(open) => { if (!open) setEditingExpense(null); }}
          editingExpense={{
            id: editingExpense.id,
            amount: editingExpense.amount,
            category: editingExpense.category,
            description: editingExpense.description,
            notes: editingExpense.notes,
            expense_date: editingExpense.expense_date,
            business_domain: null,
            payment_status: editingExpense.payment_status,
            paid_amount: editingExpense.paid_amount,
            payment_method: editingExpense.payment_method,
            project_id: editingExpense.project_id,
            order_id: editingExpense.order_id,
            property_id: editingExpense.property_id,
          }}
          editingSourceLabel={editingExpense.source_label}
          lockedProjectId={editingExpense.project_id ?? null}
          lockedOrderId={editingExpense.order_id ?? null}
          lockedPropertyId={editingExpense.property_id ?? null}
          onSaved={() => refreshAndWait()}
        />
      ) : null}
    </div>
  );
}
