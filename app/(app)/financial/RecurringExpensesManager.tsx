"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddDateIcon, AddReminderIcon, CheckIcon, RecurringIcon, SpinnerIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { toHebrewError } from "@/lib/error-messages";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import ReminderFormDialog from "@/components/reminders/ReminderFormDialog";
import type { Account } from "@/lib/accounts";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

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
  auto_paid: boolean;
  reminder_work_days_before: number | null;
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

/** What /api/recurring-expenses/backfill reports as missing, per template. */
type BackfillPreview = {
  templates: Array<{ id: string; name: string; autoPaid: boolean; months: string[]; count: number }>;
  total: number;
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
    minimumFractionDigits: 0,
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

// The sub-line under the template name: the description, and only when it adds
// information beyond the name (a bill named "ארנונה" with description "ארנונה"
// shows just the name). Category is a classification for reports — not shown here.
function secondaryLines(t: RecurringExpenseTemplateItem): string[] {
  const name = t.template_name?.trim() ?? "";
  const desc = t.description_template?.trim() ?? "";
  return desc && desc !== name ? [desc] : [];
}

export default function RecurringExpensesManager(props: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringExpenseTemplateItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [remindTemplate, setRemindTemplate] = useState<RecurringExpenseTemplateItem | null>(null);
  const [accountFilter, setAccountFilter] = useState("");

  // ── "השלמת חיובים חסרים" ──────────────────────────────────────────────────
  // The daily generator only runs for TODAY, and for a manual (non-standing-order)
  // template it materializes only the current period — so months between the
  // start date and the first run never exist. This previews what's missing and
  // then creates it. `id: null` = every active template.
  const [backfillTarget, setBackfillTarget] = useState<{ id: string | null; label: string } | null>(null);
  const [backfillPreview, setBackfillPreview] = useState<BackfillPreview | null>(null);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillError, setBackfillError] = useState<string | undefined>(undefined);

  async function openBackfill(target: { id: string | null; label: string }) {
    setBackfillTarget(target);
    setBackfillPreview(null);
    setBackfillError(undefined);
    setBackfillLoading(true);
    try {
      const res = await fetch(
        `/api/recurring-expenses/backfill${target.id ? `?id=${encodeURIComponent(target.id)}` : ""}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as BackfillPreview & { error?: string };
      if (!res.ok) {
        setBackfillError(toHebrewError(json.error, "בדיקת החיובים החסרים נכשלה."));
        return;
      }
      setBackfillPreview({ templates: json.templates ?? [], total: json.total ?? 0 });
    } catch (error: unknown) {
      setBackfillError(toHebrewError(error, "בדיקת החיובים החסרים נכשלה."));
    } finally {
      setBackfillLoading(false);
    }
  }

  async function runBackfill() {
    if (!backfillTarget) return;
    setBackfillRunning(true);
    setBackfillError(undefined);
    try {
      const res = await fetch("/api/recurring-expenses/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: backfillTarget.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; created?: number };
      if (!res.ok) {
        setBackfillError(toHebrewError(json.error, "השלמת החיובים החסרים נכשלה."));
        return;
      }
      setBackfillTarget(null);
      router.refresh();
      const created = Number(json.created) || 0;
      toast.success(created > 0 ? `נוצרו ${created} חיובים חסרים` : "לא נמצאו חיובים חסרים");
    } catch (error: unknown) {
      setBackfillError(toHebrewError(error, "השלמת החיובים החסרים נכשלה."));
    } finally {
      setBackfillRunning(false);
    }
  }

  // Bank-account scope for the list + summary.
  const filteredTemplates = useMemo(
    () => (accountFilter ? props.templates.filter((t) => t.account_id === accountFilter) : props.templates),
    [props.templates, accountFilter]
  );
  // Ordered by the day of the month the payment falls on (2nd, 9th, 10th …), then
  // by next occurrence as a tiebreaker.
  const sortedTemplates = useMemo(
    () =>
      [...filteredTemplates].sort(
        (a, b) => (a.expense_day_of_month || 1) - (b.expense_day_of_month || 1) || nextPaymentTime(a) - nextPaymentTime(b)
      ),
    [filteredTemplates]
  );
  const accountNameById = useMemo(
    () => new Map(props.accounts.map((a) => [a.id, a.name] as const)),
    [props.accounts]
  );
  // Total monthly commitment (fixed-amount templates only), normalized to a month:
  // yearly ÷ 12, every-N-months ÷ N. Variable templates are counted separately.
  // Respects the account filter so the total reflects what's shown.
  const summary = useMemo(() => {
    const active = filteredTemplates.filter((t) => t.is_active);
    const variableCount = active.filter((t) => t.is_variable_amount).length;
    const monthlyTotal = active.reduce((sum, t) => {
      if (t.is_variable_amount) return sum;
      const per = t.frequency === "yearly" ? t.amount / 12 : t.amount / Math.max(1, t.interval_months || 1);
      return sum + per;
    }, 0);
    return { activeCount: active.length, variableCount, monthlyTotal };
  }, [filteredTemplates]);

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

      {/* Bank-account filter + the catch-up action for every template at once */}
      {!props.missingSchema && props.templates.length > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void openBackfill({ id: null, label: "כל ההוצאות הקבועות" })}
          >
            <AddDateIcon className="h-4 w-4" />
            השלמת חיובים חסרים
          </Button>
        </div>
      ) : null}

      {!props.missingSchema && props.templates.length > 0 && props.accounts.length > 0 ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">חשבון:</span>
          <NativeSelect dense
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            aria-label="סינון לפי חשבון" className="text-foreground"
          >
            <option value="">כל החשבונות</option>
            {props.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </NativeSelect>
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
      ) : sortedTemplates.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            אין הוצאות קבועות בחשבון שנבחר.
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
                        <RecurringIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="font-semibold">{template.template_name}</span>
                      </div>
                      {secondaryLines(template).map((line, i) => (
                        <div key={i} className="text-xs text-muted-foreground">{line}</div>
                      ))}
                      <div className="text-xs text-muted-foreground">{getBusinessDomainLabel(template.business_domain)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {linkedLabel ? <Badge variant="neutral">{linkedLabel}</Badge> : null}
                      <Badge variant="outline">{cadenceLabel(template)}</Badge>
                      {template.is_active ? <Badge variant="success">פעיל</Badge> : <Badge variant="warning">לא פעיל</Badge>}
                    </div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <div>סכום: <span className="text-foreground">{template.is_variable_amount ? (template.amount > 0 ? `~${formatCurrency(template.amount)} (משתנה)` : "משתנה") : formatCurrency(template.amount)}</span></div>
                      <div className="flex items-center gap-2">
                        <span>חשבון: <span className="text-foreground">{(template.account_id && accountNameById.get(template.account_id)) || "—"}</span></span>
                        {template.auto_paid ? <Badge variant="outline">הוראת קבע</Badge> : null}
                      </div>
                      {template.reminder_work_days_before ? (
                        <div>תזכורת: <span className="text-foreground">{template.reminder_work_days_before} ימי עבודה לפני</span></div>
                      ) : null}
                      <div>
                        טווח: <span className="text-foreground">{template.start_date || "ללא התחלה"} | {template.end_date || "ללא סוף"}</span>
                      </div>
                      {template.notes_template ? (
                        <div>הערות: <span className="text-foreground">{template.notes_template}</span></div>
                      ) : null}
                    </div>
                    <div className="flex justify-end gap-1.5">
                      <Button type="button" size="icon-sm" variant="secondary" onClick={() => setRemindTemplate(template)} title="תזכורת" aria-label="תזכורת">
                        <AddReminderIcon className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="secondary"
                        onClick={() => void openBackfill({ id: template.id, label: template.template_name })}
                        title="השלמת חיובים חסרים"
                        aria-label="השלמת חיובים חסרים"
                      >
                        <AddDateIcon className="h-4 w-4" />
                      </Button>
                      <EditButton onClick={() => openEdit(template)} label="עריכה" />
                      <DeleteButton onClick={() => setConfirmDeleteId(template.id)} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden max-h-[70vh] overflow-auto rounded-xl border md:block">
            <table dir="rtl" className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b-2 bg-muted text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">מועד תשלום</th>
                  <th className="px-3 py-2 text-right font-medium">שם ותיאור</th>
                  <th className="px-3 py-2 text-right font-medium">תחום · שיוך</th>
                  <th className="px-3 py-2 text-right font-medium">סכום</th>
                  <th className="px-3 py-2 text-right font-medium">חשבון</th>
                  <th className="px-3 py-2 text-right font-medium">הוראת קבע</th>
                  <th className="px-3 py-2 text-right font-medium">תזכורת</th>
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
                          : null;

                  return (
                    <tr key={template.id} className="align-top hover:bg-secondary/10">
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="text-lg font-bold tabular-nums leading-none">{template.expense_day_of_month}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{moedSubLabel(template)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <RecurringIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="font-semibold">{template.template_name}</span>
                        </div>
                        {secondaryLines(template).map((line, i) => (
                          <div key={i} className="line-clamp-1 max-w-[260px] text-xs text-muted-foreground">{line}</div>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        <div>{getBusinessDomainLabel(template.business_domain)}</div>
                        {linkedLabel ? <Badge variant="neutral" className="mt-1">{linkedLabel}</Badge> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {template.is_variable_amount ? (
                          <div className="flex items-center justify-end gap-1.5">
                            {template.amount > 0 ? <span className="font-semibold tabular-nums">~{formatCurrency(template.amount)}</span> : null}
                            <Badge variant="warning">משתנה</Badge>
                          </div>
                        ) : (
                          <span className="font-semibold tabular-nums">{formatCurrency(template.amount)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{(template.account_id && accountNameById.get(template.account_id)) || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {template.auto_paid ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <CheckIcon className="h-4 w-4" />הוראת קבע
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {template.reminder_work_days_before ? (
                          <span className="inline-flex items-center gap-1 text-primary">
                            <AddReminderIcon className="h-4 w-4" />{template.reminder_work_days_before} ימי עבודה לפני
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {template.is_active ? <Badge variant="success">פעיל</Badge> : <Badge variant="warning">לא פעיל</Badge>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex items-center gap-1">
                          <Button type="button" size="icon-sm" variant="secondary" onClick={() => setRemindTemplate(template)} title="תזכורת" aria-label="תזכורת">
                            <AddReminderIcon className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="secondary"
                            onClick={() => void openBackfill({ id: template.id, label: template.template_name })}
                            title="השלמת חיובים חסרים"
                            aria-label="השלמת חיובים חסרים"
                          >
                            <AddDateIcon className="h-4 w-4" />
                          </Button>
                          <EditButton onClick={() => openEdit(template)} label="עריכה" />
                          <DeleteButton onClick={() => setConfirmDeleteId(template.id)} />
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

      {/* Preview first, then create — a catch-up that silently invents rows in
          closed months would be indistinguishable from a bug. */}
      <ConfirmDialog
        open={Boolean(backfillTarget)}
        onOpenChange={(next) => {
          if (!next) {
            setBackfillTarget(null);
            setBackfillPreview(null);
            setBackfillError(undefined);
          }
        }}
        title="השלמת חיובים חסרים"
        description={
          backfillLoading
            ? undefined
            : backfillPreview && backfillPreview.total > 0
              ? "אלה החיובים שהיו אמורים להיווצר ולא נוצרו. חיוב של הוראת קבע ייווצר כשולם; חיוב רגיל ייווצר כממתין לאישור תשלום."
              : undefined
        }
        confirmLabel={
          backfillPreview && backfillPreview.total > 0 ? `יצירת ${backfillPreview.total} חיובים` : "סגירה"
        }
        loading={backfillRunning}
        error={backfillError}
        onConfirm={() => {
          if (backfillPreview && backfillPreview.total > 0) void runBackfill();
          else setBackfillTarget(null);
        }}
      >
        {backfillLoading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
            <SpinnerIcon className="h-4 w-4 animate-spin" />
            <span>בודק אילו חיובים חסרים...</span>
          </div>
        ) : backfillPreview && backfillPreview.total === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">
            לא נמצאו חיובים חסרים ב{backfillTarget?.label ?? ""}. הכול כבר נוצר.
          </div>
        ) : backfillPreview ? (
          <div className="max-h-64 space-y-3 overflow-y-auto">
            {backfillPreview.templates.map((row) => (
              <div key={row.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{row.name}</span>
                  <Badge variant="outline">{row.count} חיובים</Badge>
                  {row.autoPaid ? <Badge variant="outline">הוראת קבע</Badge> : null}
                </div>
                <div dir="ltr" className="text-xs text-muted-foreground">
                  {row.months.join(" · ")}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </ConfirmDialog>

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
