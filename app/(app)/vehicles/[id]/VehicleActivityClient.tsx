"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, DocumentIcon, TaskIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { ExpenseDialog, type EditingExpenseData } from "@/components/expenses/ExpenseDialog";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { TaskUpsertDialog, type UserOption } from "@/components/tasks/TaskUpsertDialog";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { DOCUMENT_CATEGORIES, inferDefaultDocumentCategory } from "@/lib/documents";
import { formatCurrency } from "@/lib/payroll";
import { taskStatusLabel, type VehicleActivity, type VehicleExpense } from "@/lib/vehicles";
import { toHebrewError } from "@/lib/error-messages";
import { offlineUpload } from "@/lib/offline-upload";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, registerReversibleCreate } from "@/lib/undo-engine";

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
    account_id: e.accountId,
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

  const expenses = useUndoOverlay(activity.expenses, (e) => e.id, "vehicle-expense");
  const payments = useUndoOverlay(activity.payments, (p) => p.id, "vehicle-payment");
  const tasks = useUndoOverlay(activity.tasks, (t) => t.id, "vehicle-task");
  const documents = useUndoOverlay(activity.documents, (d) => d.id, "vehicle-document");

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
  const [incAccountId, setIncAccountId] = useState("");
  const [incAccountsList, setIncAccountsList] = useState<Account[]>([]);
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
    if (incAccountsList.length > 0 && !incAccountId) {
      toast.error("יש לבחור חשבון לתנועה.");
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
          account_id: incAccountId || null,
          notes: incNotes.trim() || null,
          tag_ids: [tagId],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה ביצירת ההכנסה", { description: toHebrewError(json?.error, "") });
        return;
      }
      setIncomeOpen(false);
      refresh();
      const newId = (json?.payment as { id?: string } | null)?.id;
      if (!newId) {
        toast.success("ההכנסה נוספה");
        return;
      }
      registerReversibleCreate({
        scope: "vehicle-payment",
        id: newId,
        message: "ההכנסה נוספה",
        onUndo: async () => {
          const delRes = await fetch("/api/payments/delete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: newId }),
          });
          const delJson = await delRes.json().catch(() => ({}));
          refresh();
          if (!delRes.ok) return { ok: false, error: toHebrewError(delJson?.error, "ביטול נכשל.") };
          return { ok: true };
        },
      });
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
      // uploaded + queued files are both "done"; a queued upload was saved to the
      // device and replays when the connection returns (ConnectionToasts announces it).
      let done = 0;
      for (const file of docFiles) {
        const fields: Record<string, string> = {
          business_domain: "general_business",
          tag_ids: JSON.stringify([tagId]),
        };
        if (docCategory.trim()) fields.category = docCategory.trim();
        if (docYear.trim()) fields.ref_year = docYear.trim();
        const result = await offlineUpload("/api/documents/upload", {
          fields,
          file,
          label: file.name,
        });
        if (result.queued) {
          done += 1;
        } else if (result.ok) {
          uploaded += 1;
          done += 1;
        } else {
          toast.error("שגיאה בהעלאת מסמך", { description: result.error });
          break;
        }
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? "המסמך הועלה" : `${uploaded} מסמכים הועלו`);
      }
      if (done === docFiles.length) {
        setDocOpen(false);
        refresh();
      }
    } finally {
      setDocBusy(false);
    }
  }

  function confirmDelete() {
    if (!del) return;
    const target = del;
    setDel(null);
    const scope =
      target.kind === "expense"
        ? "vehicle-expense"
        : target.kind === "payment"
          ? "vehicle-payment"
          : target.kind === "task"
            ? "vehicle-task"
            : "vehicle-document";
    scheduleDeferredDelete({
      scope,
      id: target.id,
      message: "נמחק",
      onCommit: async () => {
        const endpoint =
          target.kind === "expense"
            ? ["/api/expenses/delete", { id: target.id }]
            : target.kind === "payment"
              ? ["/api/payments/delete", { id: target.id }]
              : target.kind === "task"
                ? ["/api/tasks/delete", { id: target.id }]
                : ["/api/documents/delete", { document_id: target.id }];
        const res = await fetch(endpoint[0] as string, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(endpoint[1]),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "המחיקה נכשלה.") };
        refresh();
        return { ok: true };
      },
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Expenses */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">הוצאות ({expenses.length})</CardTitle>
            <Button size="sm" onClick={openAddExpense}>
              <AddIcon className="h-4 w-4" />
              הוצאה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין הוצאות מתויגות לרכב זה.</p>
            ) : (
              expenses.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{e.description || e.category || "הוצאה"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[e.description ? e.category : null, fmtDate(e.date)].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="font-semibold text-destructive">{formatCurrency(e.amount)}</span>
                    <EditButton onClick={() => openEditExpense(e)} label="עריכה" />
                    <DeleteButton onClick={() => setDel({ kind: "expense", id: e.id, label: e.category || "הוצאה" })} label="מחיקת הוצאה" />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Income */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">הכנסות ({payments.length})</CardTitle>
            <Button size="sm" onClick={openAddIncome}>
              <AddIcon className="h-4 w-4" />
              הכנסה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין הכנסות מתויגות לרכב זה.</p>
            ) : (
              payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{p.method || "תשלום"}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(p.date) || "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="font-semibold text-emerald-600">{formatCurrency(p.amount)}</span>
                    {p.projectId ? null : (
                      <DeleteButton onClick={() => setDel({ kind: "payment", id: p.id, label: "הכנסה" })} label="מחיקת הכנסה" />
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
              <TaskIcon className="h-4 w-4" />
              משימות ({tasks.length})
            </CardTitle>
            <Button size="sm" onClick={openAddTask}>
              <AddIcon className="h-4 w-4" />
              משימה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין משימות מתויגות לרכב זה.</p>
            ) : (
              tasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{t.subject || "משימה"}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(t.dueDate) || "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline">{taskStatusLabel(t.status)}</Badge>
                    <EditButton onClick={() => openEditTask(t.id)} label="עריכה" />
                    <DeleteButton onClick={() => setDel({ kind: "task", id: t.id, label: t.subject || "משימה" })} label="מחיקת משימה" />
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
              <DocumentIcon className="h-4 w-4" />
              מסמכים ({documents.length})
            </CardTitle>
            <Button size="sm" onClick={openAddDoc}>
              <AddIcon className="h-4 w-4" />
              מסמך
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין מסמכים מתויגים לרכב זה.</p>
            ) : (
              documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{d.title || d.fileName || "מסמך"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[d.documentType, fmtDate(d.uploadedAt)].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {d.refYear ? <Badge variant="neutral">{d.refYear}</Badge> : null}
                    <DeleteButton onClick={() => setDel({ kind: "document", id: d.id, label: d.title || "מסמך" })} label="מחיקת מסמך" />
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
      <FormDialog
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        title={`הוספת הכנסה לרכב: ${vehicleName}`}
        description="ההכנסה נרשמת ומתויגת לרכב הזה."
        size="formMd"
        onSubmit={() => void submitIncome()}
        submitLabel="הוספה"
        busyLabel="שומר..."
        busy={incBusy}
      >
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
              <NativeSelect
                value={incMethod}
                onChange={(e) => {
                  const m = e.target.value;
                  setIncMethod(m);
                  setIncAccountId((prev) => prev || defaultAccountForMethod(incAccountsList, m));
                }}
              >
                {SIMPLE_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </NativeSelect>
            </div>
            <AccountSelect
              required
              value={incAccountId}
              onChange={setIncAccountId}
              onLoaded={(list) => {
                setIncAccountsList(list);
                setIncAccountId((prev) => prev || defaultAccountForMethod(list, incMethod));
              }}
            />
            <div className="space-y-1">
              <div className="text-sm font-medium">הערות</div>
              <div className="relative">
                <Textarea
                  value={incNotes}
                  onChange={(e) => setIncNotes(e.target.value)}
                  className="pe-11"
                />
                <DictateButton
                  onTranscript={(text) => setIncNotes((prev) => appendDictatedText(prev, text))}
                  className="absolute bottom-1 end-1 h-8 w-8"
                />
              </div>
            </div>
          </div>
      </FormDialog>

      {/* Document upload dialog (add) */}
      <FormDialog
        open={docOpen}
        onOpenChange={setDocOpen}
        title={`העלאת מסמך לרכב: ${vehicleName}`}
        description="הקובץ נשמר בארכיון המסמכים ומתויג לרכב הזה."
        onSubmit={() => void submitDoc()}
        submitLabel="העלאה"
        busyLabel="מעלה..."
        busy={docBusy}
      >
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
              <NativeSelect
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value)}
                disabled={docBusy}
              >
                <option value="">ללא קטגוריה</option>
                {DOCUMENT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">שנת המסמך (לחיפוש לפי שנה)</div>
              <Input inputMode="numeric" value={docYear} onChange={(e) => setDocYear(e.target.value)} />
            </div>
          </div>
      </FormDialog>

      <ConfirmDialog
        open={Boolean(del)}
        onOpenChange={(o) => !o && setDel(null)}
        title="מחיקה"
        description={del ? `למחוק "${del.label}"?` : ""}
        confirmLabel="מחיקה"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}
