"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { ExpenseDialog, type EditingExpenseData } from "@/components/expenses/ExpenseDialog";
import { TaskUpsertDialog, type UserOption } from "@/components/tasks/TaskUpsertDialog";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { DOCUMENT_CATEGORIES, inferDefaultDocumentCategory } from "@/lib/documents";
import { formatCurrency } from "@/lib/payroll";
import { taskStatusLabel, type VehicleActivity, type VehicleExpense } from "@/lib/vehicles";
import { toHebrewError } from "@/lib/error-messages";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// Income methods that don't require a due-date/check-number (kept simple here;
// check income is still added from the financial screen).
const SIMPLE_METHODS = PAYMENT_METHOD_OPTIONS.filter((m) => m.value !== "check");

type SourceOption = { id: string; label: string };

type Props = {
  tagId: string;
  vehicleName: string;
  activity: VehicleActivity;
  users: UserOption[];
  projects: SourceOption[];
  orders: SourceOption[];
  properties: SourceOption[];
  currentUserId: string;
};

function toEditingExpense(e: VehicleExpense): EditingExpenseData {
  return {
    id: e.id,
    amount: e.amount,
    category: e.category,
    description: e.description,
    notes: e.notes,
    expense_date: e.date,
    business_domain: e.businessDomain,
    payment_status: e.paymentStatus,
    paid_amount: e.paidAmount,
    payment_method: e.paymentMethod,
    project_id: e.projectId,
    order_id: e.orderId,
    property_id: e.propertyId,
  };
}

export default function VehicleActivityClient({
  tagId,
  vehicleName,
  activity,
  users,
  projects,
  orders,
  properties,
  currentUserId,
}: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();

  // expense
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<EditingExpenseData | null>(null);
  // task
  const [taskOpen, setTaskOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  // income
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [incAmount, setIncAmount] = useState("");
  const [incDate, setIncDate] = useState(todayIso());
  const [incMethod, setIncMethod] = useState("bank_transfer");
  const [incNotes, setIncNotes] = useState("");
  const [incBusy, setIncBusy] = useState(false);
  // document
  const [docOpen, setDocOpen] = useState(false);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docYear, setDocYear] = useState("");
  const [docCategory, setDocCategory] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  // delete
  const [del, setDel] = useState<{ kind: string; id: string; label: string } | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  function openAddExpense() {
    setEditingExpense(null);
    setExpenseOpen(true);
  }
  function openEditExpense(e: VehicleExpense) {
    setEditingExpense(toEditingExpense(e));
    setExpenseOpen(true);
  }
  function openAddTask() {
    setEditTaskId(null);
    setTaskOpen(true);
  }
  function openEditTask(id: string) {
    setEditTaskId(id);
    setTaskOpen(true);
  }
  function openAddIncome() {
    setIncAmount("");
    setIncDate(todayIso());
    setIncMethod("bank_transfer");
    setIncNotes("");
    setIncomeOpen(true);
  }
  function openAddDoc() {
    setDocFiles([]);
    setDocYear("");
    setDocCategory("");
    setDocOpen(true);
  }

  async function submitIncome() {
    const amount = Number(incAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("יש להזין סכום תקין");
      return;
    }
    if (!incDate) {
      toast.error("יש לבחור תאריך");
      return;
    }
    setIncBusy(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: "general_business",
          amount_total: amount,
          payment_date: incDate,
          payment_method: incMethod,
          notes: incNotes.trim() || null,
          tag_ids: [tagId],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה ביצירת ההכנסה", { description: toHebrewError(json?.error, "") });
        return;
      }
      toast.success("ההכנסה נוספה");
      setIncomeOpen(false);
      refresh();
    } finally {
      setIncBusy(false);
    }
  }

  async function submitDoc() {
    if (docFiles.length === 0) {
      toast.error("יש לבחור קובץ");
      return;
    }
    setDocBusy(true);
    try {
      let uploaded = 0;
      for (const file of docFiles) {
        const form = new FormData();
        form.set("file", file);
        form.set("business_domain", "general_business");
        form.set("tag_ids", JSON.stringify([tagId]));
        if (docCategory.trim()) form.set("category", docCategory.trim());
        if (docYear.trim()) form.set("ref_year", docYear.trim());
        const res = await fetch("/api/documents/upload", { method: "POST", body: form });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          toast.error("שגיאה בהעלאת מסמך", { description: toHebrewError(json?.error, "") });
          break;
        }
        uploaded += 1;
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? "המסמך הועלה" : `${uploaded} מסמכים הועלו`);
        setDocOpen(false);
        refresh();
      }
    } finally {
      setDocBusy(false);
    }
  }

  async function confirmDelete() {
    if (!del) return;
    setDelBusy(true);
    try {
      const endpoint =
        del.kind === "expense"
          ? ["/api/expenses/delete", { id: del.id }]
          : del.kind === "payment"
            ? ["/api/payments/delete", { id: del.id }]
            : del.kind === "task"
              ? ["/api/tasks/delete", { id: del.id }]
              : ["/api/documents/delete", { document_id: del.id }];
      const res = await fetch(endpoint[0] as string, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(endpoint[1]),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה במחיקה", { description: toHebrewError(json?.error, "") });
        return;
      }
      toast.success("נמחק");
      setDel(null);
      refresh();
    } finally {
      setDelBusy(false);
    }
  }

  const iconBtn = "h-7 w-7";

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Expenses */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">הוצאות ({activity.expenses.length})</CardTitle>
            <Button size="sm" onClick={openAddExpense}>
              <Plus className="me-1 h-4 w-4" />
              הוצאה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {activity.expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין הוצאות מתויגות לרכב זה.</p>
            ) : (
              activity.expenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{e.description || e.category || "הוצאה"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[e.description ? e.category : null, fmtDate(e.date)].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="font-semibold text-destructive">{formatCurrency(e.amount)}</span>
                    <Button variant="secondary" size="icon" className={iconBtn} onClick={() => openEditExpense(e)} aria-label="עריכה">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="secondary" size="icon" className={iconBtn} onClick={() => setDel({ kind: "expense", id: e.id, label: e.category || "הוצאה" })} aria-label="מחיקה">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Income */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">הכנסות ({activity.payments.length})</CardTitle>
            <Button size="sm" onClick={openAddIncome}>
              <Plus className="me-1 h-4 w-4" />
              הכנסה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {activity.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין הכנסות מתויגות לרכב זה.</p>
            ) : (
              activity.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{p.method || "תשלום"}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(p.date) || "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="font-semibold text-emerald-600">{formatCurrency(p.amount)}</span>
                    {p.projectId ? null : (
                      <Button variant="secondary" size="icon" className={iconBtn} onClick={() => setDel({ kind: "payment", id: p.id, label: "הכנסה" })} aria-label="מחיקה">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-1 text-base">
              <ListTodo className="h-4 w-4" />
              משימות ({activity.tasks.length})
            </CardTitle>
            <Button size="sm" onClick={openAddTask}>
              <Plus className="me-1 h-4 w-4" />
              משימה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {activity.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין משימות מתויגות לרכב זה.</p>
            ) : (
              activity.tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{t.subject || "משימה"}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(t.dueDate) || "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline">{taskStatusLabel(t.status)}</Badge>
                    <Button variant="secondary" size="icon" className={iconBtn} onClick={() => openEditTask(t.id)} aria-label="עריכה">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="secondary" size="icon" className={iconBtn} onClick={() => setDel({ kind: "task", id: t.id, label: t.subject || "משימה" })} aria-label="מחיקה">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-1 text-base">
              <FileText className="h-4 w-4" />
              מסמכים ({activity.documents.length})
            </CardTitle>
            <Button size="sm" onClick={openAddDoc}>
              <Plus className="me-1 h-4 w-4" />
              מסמך
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {activity.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין מסמכים מתויגים לרכב זה.</p>
            ) : (
              activity.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{d.title || d.fileName || "מסמך"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[d.documentType, fmtDate(d.uploadedAt)].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {d.refYear ? <Badge variant="neutral">{d.refYear}</Badge> : null}
                    <Button variant="secondary" size="icon" className={iconBtn} onClick={() => setDel({ kind: "document", id: d.id, label: d.title || "מסמך" })} aria-label="מחיקה">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Expense dialog (add + edit) */}
      <ExpenseDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        editingExpense={editingExpense}
        defaultCategory="רכבים"
        presetTagIds={[tagId]}
        presetTagLabel={vehicleName}
        recurringProjects={projects}
        recurringOrders={orders}
        recurringProperties={properties}
        showAttachments
        onSaved={() => refresh()}
      />

      {/* Task dialog (add + edit) */}
      <TaskUpsertDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        mode={editTaskId ? "edit" : "create"}
        taskId={editTaskId}
        users={users}
        currentUserId={currentUserId}
        presetTagIds={[tagId]}
        onSaved={() => refresh()}
      />

      {/* Income dialog (add) */}
      <Dialog open={incomeOpen} onOpenChange={(o) => !incBusy && setIncomeOpen(o)}>
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>הוספת הכנסה לרכב: {vehicleName}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">סכום *</div>
              <CurrencyInput type="number" min="0" step="0.01" value={incAmount} onChange={(e) => setIncAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך</div>
              <DateInput value={incDate} onChange={(e) => setIncDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">אמצעי תשלום</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={incMethod}
                onChange={(e) => setIncMethod(e.target.value)}
              >
                {SIMPLE_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">הערות</div>
              <Textarea value={incNotes} onChange={(e) => setIncNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="secondary" onClick={() => setIncomeOpen(false)} disabled={incBusy}>ביטול</Button>
            <Button onClick={() => void submitIncome()} disabled={incBusy}>{incBusy ? "שומר..." : "הוספה"}</Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      {/* Document upload dialog (add) */}
      <Dialog open={docOpen} onOpenChange={(o) => !docBusy && setDocOpen(o)}>
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>העלאת מסמך לרכב: {vehicleName}</DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <FileUploadActions
              files={docFiles}
              onFilesSelected={(files) => {
                setDocFiles(files);
                if (files.length > 0 && !docCategory) setDocCategory(inferDefaultDocumentCategory(files[0]?.name));
              }}
              multiple
              disabled={docBusy}
              chooseLabel="בחירת קבצים"
            />
            <div className="space-y-1">
              <div className="text-sm font-medium">קטגוריה</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value)}
                disabled={docBusy}
              >
                <option value="">ללא קטגוריה</option>
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">שנת המסמך (לחיפוש לפי שנה)</div>
              <Input inputMode="numeric" value={docYear} onChange={(e) => setDocYear(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="secondary" onClick={() => setDocOpen(false)} disabled={docBusy}>ביטול</Button>
            <Button onClick={() => void submitDoc()} disabled={docBusy}>{docBusy ? "מעלה..." : "העלאה"}</Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <ConfirmDialog
        open={Boolean(del)}
        onOpenChange={(o) => !o && setDel(null)}
        title="מחיקה"
        description={del ? `למחוק "${del.label}"? לא ניתן לשחזר.` : ""}
        confirmLabel="מחיקה"
        destructive
        loading={delBusy}
        onConfirm={confirmDelete}
      />
    </>
  );
}
