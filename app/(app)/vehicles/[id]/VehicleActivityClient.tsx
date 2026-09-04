"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, ChevronDownIcon, DocumentIcon, TaskIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { ExpenseDialog, type EditingExpenseData } from "@/components/expenses/ExpenseDialog";
import { TaskUpsertDialog, type UserOption } from "@/components/tasks/TaskUpsertDialog";
import { DOCUMENT_CATEGORIES, inferDefaultDocumentCategory } from "@/lib/documents";
import { formatCurrency } from "@/lib/payroll";
import { taskStatusLabel, type VehicleActivity, type VehicleDocument, type VehicleExpense } from "@/lib/vehicles";
import { toHebrewError } from "@/lib/error-messages";
import { offlineUpload } from "@/lib/offline-upload";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete } from "@/lib/undo-engine";
import { cn } from "@/lib/utils";

function fmtDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

// Groups documents by the year they're FOR (refYear — e.g. a 2026 טסט
// certificate), falling back to the upload year when it's not set. Newest
// year first, with "ללא שנה" (unset on both) always last — so an archive
// that grows to many years stays scannable instead of one long flat list.
function groupDocumentsByYear(documents: VehicleDocument[]): Array<{ year: number | null; docs: VehicleDocument[] }> {
  const groups = new Map<number | null, VehicleDocument[]>();
  for (const doc of documents) {
    const year = doc.refYear ?? (doc.uploadedAt ? new Date(doc.uploadedAt).getFullYear() : null);
    const key = Number.isFinite(year) ? (year as number) : null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(doc);
    else groups.set(key, [doc]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a;
  }).map(([year, docs]) => ({ year, docs }));
}

function DocumentYearGroup({
  year,
  docs,
  defaultOpen,
  onDelete,
}: {
  year: number | null;
  docs: VehicleDocument[];
  defaultOpen: boolean;
  onDelete: (doc: VehicleDocument) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 bg-muted/30 px-3 py-2 text-start"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {year ?? "ללא שנה"}
          <Badge variant="neutral">{docs.length}</Badge>
        </span>
        <ChevronDownIcon className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-2 p-3 pt-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
              <div className="min-w-0 text-sm">
                <div className="truncate font-medium">{d.title || d.fileName || "מסמך"}</div>
                <div className="text-xs text-muted-foreground">
                  {[d.documentType, fmtDate(d.uploadedAt)].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <DeleteButton onClick={() => onDelete(d)} label="מחיקת מסמך" />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  const tasks = useUndoOverlay(activity.tasks, (t) => t.id, "vehicle-task");
  const documents = useUndoOverlay(activity.documents, (d) => d.id, "vehicle-document");

  // expense
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<EditingExpenseData | null>(null);
  // task
  const [taskOpen, setTaskOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
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
  function openAddDoc() {
    setDocFiles([]);
    setDocYear("");
    setDocCategory("");
    setDocOpen(true);
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
      target.kind === "expense" ? "vehicle-expense" : target.kind === "task" ? "vehicle-task" : "vehicle-document";
    scheduleDeferredDelete({
      scope,
      id: target.id,
      message: "נמחק",
      onCommit: async () => {
        const endpoint =
          target.kind === "expense"
            ? ["/api/expenses/delete", { id: target.id }]
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
        <Card className="lg:col-span-2">
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
              groupDocumentsByYear(documents).map((group, i) => (
                <DocumentYearGroup
                  key={group.year ?? "none"}
                  year={group.year}
                  docs={group.docs}
                  defaultOpen={i === 0}
                  onDelete={(d) => setDel({ kind: "document", id: d.id, label: d.title || "מסמך" })}
                />
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
