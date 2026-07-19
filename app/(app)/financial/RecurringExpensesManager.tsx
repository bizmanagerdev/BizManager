"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Repeat, Pencil, Trash2, BellPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import ReminderFormDialog from "@/components/reminders/ReminderFormDialog";
import type { Account } from "@/lib/accounts";

type Option = {
  id: string;
  label: string;
};

type Frequency = "monthly" | "yearly";

export type RecurringExpenseTemplateItem = {
  id: string;
  template_name: string;
  category: string;
  amount: number;
  is_variable_amount: boolean;
  description_template: string | null;
  notes_template: string | null;
  business_domain: string;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  account_id: string | null;
  included_in_base_price: boolean;
  billed_to_customer: boolean;
  project_expense_notes_template: string | null;
  frequency: Frequency;
  interval_months: number;
  create_day_of_month: number;
  expense_day_of_month: number;
  create_month_of_year: number | null;
  expense_month_of_year: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
};

type Props = {
  templates: RecurringExpenseTemplateItem[];
  projects: Option[];
  orders: Option[];
  properties: Option[];
  accounts: Account[];
  missingSchema?: boolean;
};

const MONTH_OPTIONS = [
  { value: "1", label: "ינואר" },
  { value: "2", label: "פברואר" },
  { value: "3", label: "מרץ" },
  { value: "4", label: "אפריל" },
  { value: "5", label: "מאי" },
  { value: "6", label: "יוני" },
  { value: "7", label: "יולי" },
  { value: "8", label: "אוגוסט" },
  { value: "9", label: "ספטמבר" },
  { value: "10", label: "אוקטובר" },
  { value: "11", label: "נובמבר" },
  { value: "12", label: "דצמבר" },
] as const;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

// Timestamp of the template's next payment (expense) date on/after today — used
// to order the list "by payment date". Honors the interval (every N months),
// phased off start_date (or today when unset).
function nextPaymentTime(t: RecurringExpenseTemplateItem): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = t.expense_day_of_month || 1;
  if (t.frequency === "yearly") {
    const month = (t.expense_month_of_year || 1) - 1;
    for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
      const last = new Date(year, month + 1, 0).getDate();
      const cand = new Date(year, month, Math.min(day, last));
      if (cand >= today) return cand.getTime();
    }
    return today.getTime();
  }
  const interval = Math.max(1, t.interval_months || 1);
  const anchor = t.start_date ? new Date(t.start_date) : today;
  const anchorIdx = anchor.getFullYear() * 12 + anchor.getMonth();
  for (let i = 0; i < 24; i++) {
    const base = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const diff = base.getFullYear() * 12 + base.getMonth() - anchorIdx;
    if (diff < 0 || diff % interval !== 0) continue;
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
    const cand = new Date(base.getFullYear(), base.getMonth(), Math.min(day, last));
    if (cand >= today) return cand.getTime();
  }
  return today.getTime();
}

// Human cadence label — "חודשי" / "כל חודשיים" / "כל 3 חודשים" / "שנתי".
function cadenceLabel(t: RecurringExpenseTemplateItem): string {
  if (t.frequency === "yearly") return "שנתי";
  const n = Math.max(1, t.interval_months || 1);
  if (n === 1) return "חודשי";
  if (n === 2) return "כל חודשיים";
  return `כל ${n} חודשים`;
}

// The recurring payment timing, NOT a concrete date — a monthly bill leaves on
// the same day every month (show just the day), a yearly one on a day+month.
function payScheduleLabel(t: RecurringExpenseTemplateItem): string {
  const day = t.expense_day_of_month || 1;
  if (t.frequency === "yearly") {
    const monthLabel = MONTH_OPTIONS.find((m) => m.value === String(t.expense_month_of_year ?? ""))?.label ?? "";
    return monthLabel ? `${day} ב${monthLabel}` : `${day} לחודש`;
  }
  const n = Math.max(1, t.interval_months || 1);
  if (n === 1) return `${day} לכל חודש`;
  if (n === 2) return `${day}, כל חודשיים`;
  return `${day}, כל ${n} חודשים`;
}

// Cadence sub-label under the day-of-month in the מועד column ("לכל חודש" etc.).
function moedSubLabel(t: RecurringExpenseTemplateItem): string {
  if (t.frequency === "yearly") {
    const monthLabel = MONTH_OPTIONS.find((m) => m.value === String(t.expense_month_of_year ?? ""))?.label ?? "";
    return monthLabel ? `ב${monthLabel}` : "בשנה";
  }
  const n = Math.max(1, t.interval_months || 1);
  if (n === 1) return "לכל חודש";
  if (n === 2) return "כל חודשיים";
  return `כל ${n} חודשים`;
}

export default function RecurringExpensesManager(props: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringExpenseTemplateItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [remindTemplate, setRemindTemplate] = useState<RecurringExpenseTemplateItem | null>(null);

  // Ordered by next payment date (soonest first).
  const sortedTemplates = useMemo(
    () => [...props.templates].sort((a, b) => nextPaymentTime(a) - nextPaymentTime(b)),
    [props.templates]
  );
  const accountNameById = useMemo(
    () => new Map(props.accounts.map((a) => [a.id, a.name] as const)),
    [props.accounts]
  );
  // Total monthly commitment (fixed-amount templates only), normalized to a month:
  // yearly ÷ 12, every-N-months ÷ N. Variable templates are counted separately.
  const summary = useMemo(() => {
    const active = props.templates.filter((t) => t.is_active);
    const variableCount = active.filter((t) => t.is_variable_amount).length;
    const monthlyTotal = active.reduce((sum, t) => {
      if (t.is_variable_amount) return sum;
      const per = t.frequency === "yearly" ? t.amount / 12 : t.amount / Math.max(1, t.interval_months || 1);
      return sum + per;
    }, 0);
    return { activeCount: active.length, variableCount, monthlyTotal };
  }, [props.templates]);

  function openEdit(template: RecurringExpenseTemplateItem) {
    setEditingTemplate(template);
    setDialogOpen(true);
  }

  async function remove() {
    const id = confirmDeleteId;
    if (!id) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/recurring-expenses/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקת הוצאה קבועה", { description: toHebrewError(json?.error, "") });
        return;
      }
      setConfirmDeleteId(null);
      router.refresh();
      toast.success("ההוצאה הקבועה נמחקה");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div dir="rtl" className="space-y-4 text-right">
      {/* Summary bar — total monthly recurring commitment + counts */}
      {!props.missingSchema && props.templates.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-foreground p-4 text-background">
          <div>
            <div className="text-xs opacity-70">סה״כ התחייבות חודשית קבועה</div>
            <div className="text-2xl font-bold tabular-nums">{formatCurrency(summary.monthlyTotal)}</div>
          </div>
          <div className="text-sm opacity-90">
            <div className="font-medium">
              {summary.activeCount} תבניות פעילות{summary.variableCount ? ` · ${summary.variableCount} בסכום משתנה` : ""}
            </div>
            <div className="text-xs opacity-60">הסכומים הקבועים מזינים אוטומטית את היומן.</div>
          </div>
        </div>
      ) : null}

      {props.missingSchema ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            צריך קודם להריץ את [db/sql/create_recurring_expense_templates.sql] כדי לנהל הוצאות קבועות.
          </CardContent>
        </Card>
      ) : props.templates.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            אין עדיין הוצאות קבועות. אפשר להתחיל משכירות, משכורות, ביטוחים, רכב, אינטרנט או כל הוצאה שחוזרת כל חודש או כל שנה.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {sortedTemplates.map((template) => {
              const linkedLabel =
                template.project_id
                  ? props.projects.find((item) => item.id === template.project_id)?.label ?? "פרויקט"
                  : template.property_id
                    ? props.properties.find((item) => item.id === template.property_id)?.label ?? "נכס"
                    : template.order_id
                      ? props.orders.find((item) => item.id === template.order_id)?.label ?? "הזמנה"
                      : "ללא שיוך";

              return (
                <Card key={template.id} className="overflow-hidden">
                  <CardContent className="space-y-3 p-4 text-sm">
                    <div className="text-xs font-semibold text-primary">
                      מועד תשלום: <span className="tabular-nums">{payScheduleLabel(template)}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Repeat className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="font-semibold">{template.template_name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {getBusinessDomainLabel(template.business_domain)} • {template.category}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="neutral">{linkedLabel}</Badge>
                      <Badge variant="outline">{cadenceLabel(template)}</Badge>
                      {template.is_active ? <Badge variant="success">פעיל</Badge> : <Badge variant="warning">לא פעיל</Badge>}
                    </div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <div>קטגוריה: <span className="text-foreground">{template.category}</span></div>
                      <div>סכום: <span className="text-foreground">{template.is_variable_amount ? "משתנה" : formatCurrency(template.amount)}</span></div>
                      <div>חשבון: <span className="text-foreground">{(template.account_id && accountNameById.get(template.account_id)) || "—"}</span></div>
                      <div>
                        טווח: <span className="text-foreground">{template.start_date || "ללא התחלה"} | {template.end_date || "ללא סוף"}</span>
                      </div>
                      {template.description_template ? (
                        <div>תיאור: <span className="text-foreground">{template.description_template}</span></div>
                      ) : null}
                      {template.notes_template ? (
                        <div>הערות: <span className="text-foreground">{template.notes_template}</span></div>
                      ) : null}
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <Button type="button" size="icon-sm" variant="secondary" onClick={() => setRemindTemplate(template)} title="תזכורת" aria-label="תזכורת">
                        <BellPlus className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon-sm" variant="secondary" onClick={() => openEdit(template)} title="עריכה" aria-label="עריכה">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon-sm" variant="destructive" onClick={() => setConfirmDeleteId(template.id)} title="מחיקה" aria-label="מחיקה">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden max-h-[70vh] overflow-auto rounded-xl border md:block">
            <table dir="rtl" className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">מועד תשלום</th>
                  <th className="px-3 py-2 text-right font-medium">שם תבנית</th>
                  <th className="px-3 py-2 text-right font-medium">תחום · קטגוריה</th>
                  <th className="px-3 py-2 text-right font-medium">סכום</th>
                  <th className="px-3 py-2 text-right font-medium">חשבון</th>
                  <th className="px-3 py-2 text-right font-medium">פעיל</th>
                  <th className="px-3 py-2 text-right font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedTemplates.map((template) => {
                  const linkedLabel =
                    template.project_id
                      ? props.projects.find((item) => item.id === template.project_id)?.label ?? "פרויקט"
                      : template.property_id
                        ? props.properties.find((item) => item.id === template.property_id)?.label ?? "נכס"
                        : template.order_id
                          ? props.orders.find((item) => item.id === template.order_id)?.label ?? "הזמנה"
                          : "ללא שיוך";

                  return (
                    <tr key={template.id} className="align-top hover:bg-secondary/10">
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="text-lg font-bold tabular-nums leading-none">{template.expense_day_of_month}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{moedSubLabel(template)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Repeat className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="font-semibold">{template.template_name}</span>
                        </div>
                        {template.description_template ? (
                          <div className="line-clamp-1 max-w-[260px] text-xs text-muted-foreground">{template.description_template}</div>
                        ) : null}
                        <Badge variant="neutral" className="mt-1">{linkedLabel}</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div>{getBusinessDomainLabel(template.business_domain)}</div>
                        <div className="text-xs text-muted-foreground">{template.category}</div>
                      </td>
                      <td dir="ltr" className="whitespace-nowrap px-3 py-2 text-left">
                        {template.is_variable_amount ? (
                          <Badge variant="warning">משתנה</Badge>
                        ) : (
                          <span className="font-semibold tabular-nums">{formatCurrency(template.amount)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{(template.account_id && accountNameById.get(template.account_id)) || "—"}</td>
                      <td className="px-3 py-2">
                        {template.is_active ? <Badge variant="success">פעיל</Badge> : <Badge variant="warning">לא פעיל</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Button type="button" size="icon-sm" variant="secondary" onClick={() => setRemindTemplate(template)} title="תזכורת" aria-label="תזכורת">
                            <BellPlus className="h-4 w-4" />
                          </Button>
                          <Button type="button" size="icon-sm" variant="secondary" onClick={() => openEdit(template)} title="עריכה" aria-label="עריכה">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button type="button" size="icon-sm" variant="destructive" onClick={() => setConfirmDeleteId(template.id)} title="מחיקה" aria-label="מחיקה">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingRecurringTemplate={editingTemplate}
        defaultRecurring={!editingTemplate}
        recurringProjects={props.projects}
        recurringOrders={props.orders}
        recurringProperties={props.properties}
        onSaved={() => {
          setDialogOpen(false);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        onOpenChange={(next) => { if (!next) setConfirmDeleteId(null); }}
        title="מחיקת הוצאה קבועה"
        description="ההוצאה הקבועה תימחק ולא ייווצרו ממנה הוצאות חדשות. הוצאות שכבר נוצרו יישארו."
        confirmLabel="מחיקה"
        destructive
        loading={deleting}
        onConfirm={() => void remove()}
      />

      <ReminderFormDialog
        mode="create"
        open={Boolean(remindTemplate)}
        onOpenChange={(o) => { if (!o) setRemindTemplate(null); }}
        category="task"
        defaultNote={remindTemplate ? `הוצאה קבועה: ${remindTemplate.template_name}` : undefined}
        onSaved={() => setRemindTemplate(null)}
      />
    </div>
  );
}
