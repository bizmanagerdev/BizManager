"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AddIcon,
  ChevronDownIcon,
  DeleteIcon,
  DocumentIcon,
  EditIcon,
  ExternalLinkIcon,
  MoreIcon,
  TaskIcon,
} from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SwipeActions } from "@/components/ui/swipe-actions";
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
import {
  isVehicleTaskOpen,
  paidVehicleExpenseAmount,
  taskStatusLabel,
  type VehicleActivity,
  type VehicleDocument,
  type VehicleExpense,
  type VehicleTask,
} from "@/lib/vehicles";
import { toHebrewError } from "@/lib/error-messages";
import { offlineUpload } from "@/lib/offline-upload";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit } from "@/lib/undo-engine";
import { cn } from "@/lib/utils";

// Mobile: swipe a row to reveal עריכה/מחיקה, same as every other list in the
// app. Desktop: no swipe gesture, so the same two actions collapse into a "⋮".
function RowActionsMenu({
  onEdit,
  onDelete,
  deleteLabel,
}: {
  onEdit?: () => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          title="פעולות"
          aria-label="פעולות"
        >
          <MoreIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {onEdit ? (
          <DropdownMenuItem onClick={onEdit}>
            <EditIcon className="me-2 h-4 w-4" />
            עריכה
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <DeleteIcon className="me-2 h-4 w-4" />
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  // One row's swipe strip open at a time, scoped to this year group.
  const [swipedId, setSwipedId] = useState<string | null>(null);
  return (
    <div className="border-b last:border-0">
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
          {docs.map((d) => {
            const body = (
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium">{d.title || d.fileName || "מסמך"}</div>
                  <div className="text-xs text-muted-foreground">
                    {[d.documentType, fmtDate(d.uploadedAt)].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                {d.url ? (
                  <Button asChild variant="outline" size="icon" aria-label="פתיחה" title="פתיחה" className="shrink-0">
                    <a href={d.url} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon className="h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
              </div>
            );
            return (
              <div key={d.id} className="border-b last:border-0">
                <div className="lg:hidden">
                  <SwipeActions
                    className="rounded-none"
                    open={swipedId === d.id}
                    onOpenChange={(next) => setSwipedId(next ? d.id : null)}
                    actions={[
                      {
                        key: "delete",
                        label: "מחיקה",
                        icon: <DeleteIcon className="h-4 w-4" />,
                        onSelect: () => onDelete(d),
                        className: "bg-destructive text-destructive-foreground",
                      },
                    ]}
                  >
                    <div className="bg-card py-2">{body}</div>
                  </SwipeActions>
                </div>
                <div className="hidden items-center gap-2 py-2 lg:flex">
                  {body}
                  <RowActionsMenu onDelete={() => onDelete(d)} deleteLabel="מחיקת מסמך" />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function monthLabel(monthKey: string): string {
  if (!monthKey) return "ללא תאריך";
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

// Groups expenses by calendar month, newest first, each with its own
// subtotal — the same "statement" shape as the bank ledger (BankClient.tsx),
// so a car with years of history stays scannable instead of one flat list.
function groupExpensesByMonth(
  expenses: VehicleExpense[]
): Array<{ key: string; label: string; items: VehicleExpense[]; subtotal: number }> {
  const groups = new Map<string, VehicleExpense[]>();
  for (const e of expenses) {
    const key = e.date ? e.date.slice(0, 7) : "";
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return b.localeCompare(a);
    })
    .map(([key, items]) => ({
      key,
      label: monthLabel(key),
      items,
      subtotal: items.reduce((sum, e) => sum + e.amount, 0),
    }));
}

function ExpenseMonthGroup({
  label,
  items,
  subtotal,
  defaultOpen,
  onEdit,
  onDelete,
}: {
  label: string;
  items: VehicleExpense[];
  subtotal: number;
  defaultOpen: boolean;
  onEdit: (expense: VehicleExpense) => void;
  onDelete: (expense: VehicleExpense) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // One row's swipe strip open at a time, scoped to this month group.
  const [swipedId, setSwipedId] = useState<string | null>(null);
  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 bg-muted/30 px-3 py-2 text-start"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {label}
          <Badge variant="neutral">{items.length}</Badge>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold">{formatCurrency(subtotal)}</span>
          <ChevronDownIcon className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open ? (
        <div className="p-2">
          {items.map((e) => {
            const body = (
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium">{e.description || e.category || "הוצאה"}</div>
                  <div className="text-xs text-muted-foreground">
                    {[e.description ? e.category : null, fmtDate(e.date)].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <span className="shrink-0 font-semibold">{formatCurrency(e.amount)}</span>
              </div>
            );
            return (
              <div key={e.id} className="border-b last:border-0">
                <div className="lg:hidden">
                  <SwipeActions
                    className="rounded-none"
                    open={swipedId === e.id}
                    onOpenChange={(next) => setSwipedId(next ? e.id : null)}
                    actions={[
                      {
                        key: "edit",
                        label: "עריכה",
                        icon: <EditIcon className="h-4 w-4" />,
                        onSelect: () => onEdit(e),
                        className: "bg-secondary text-secondary-foreground",
                      },
                      {
                        key: "delete",
                        label: "מחיקה",
                        icon: <DeleteIcon className="h-4 w-4" />,
                        onSelect: () => onDelete(e),
                        className: "bg-destructive text-destructive-foreground",
                      },
                    ]}
                  >
                    <div className="bg-card py-2">{body}</div>
                  </SwipeActions>
                </div>
                <div className="hidden items-center gap-2 py-2 lg:flex">
                  {body}
                  <RowActionsMenu onEdit={() => onEdit(e)} onDelete={() => onDelete(e)} deleteLabel="מחיקת הוצאה" />
                </div>
              </div>
            );
          })}
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
  // one swiped-open row at a time (expenses scope this per month group instead — see ExpenseMonthGroup)
  const [taskSwipedId, setTaskSwipedId] = useState<string | null>(null);

  const paidExpenseTotal = paidVehicleExpenseAmount(expenses);
  const openTaskCount = tasks.filter((t) => isVehicleTaskOpen(t.status)).length;

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

  // Quick done/not-done toggle, right from the checkbox — mirrors ProjectTasksMini's
  // checkbox but through this file's own optimistic-patch + undo pattern (matches
  // how edit/delete already work here) instead of separate local state.
  function toggleTaskDone(t: VehicleTask) {
    const nextStatus = t.status === "done" ? "todo" : "done";
    scheduleDeferredEdit({
      scope: "vehicle-task",
      id: t.id,
      message: nextStatus === "done" ? "המשימה סומנה כהושלמה." : "המשימה הוחזרה לביצוע.",
      patch: { status: nextStatus },
      onCommit: async () => {
        const res = await fetch("/api/tasks/update-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: t.id, status: nextStatus }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "עדכון הסטטוס נכשל.") };
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
            <div>
              <CardTitle className="text-base">הוצאות ({expenses.length})</CardTitle>
              {expenses.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  סה״כ שולם: <span className="font-semibold text-foreground">{formatCurrency(paidExpenseTotal)}</span>
                </p>
              ) : null}
            </div>
            <Button size="sm" variant="outline" onClick={openAddExpense}>
              <AddIcon className="h-4 w-4" />
              הוצאה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין הוצאות מתויגות לרכב זה.</p>
            ) : (
              groupExpensesByMonth(expenses).map((group, i) => (
                <ExpenseMonthGroup
                  key={group.key || "none"}
                  label={group.label}
                  items={group.items}
                  subtotal={group.subtotal}
                  defaultOpen={i === 0}
                  onEdit={openEditExpense}
                  onDelete={(e) => setDel({ kind: "expense", id: e.id, label: e.category || "הוצאה" })}
                />
              ))
            )}
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-1 text-base">
                <TaskIcon className="h-4 w-4" />
                משימות ({tasks.length})
              </CardTitle>
              {tasks.length > 0 ? (
                <p className="text-xs text-muted-foreground">{openTaskCount}/{tasks.length} פתוחות</p>
              ) : null}
            </div>
            <Button size="sm" variant="outline" onClick={openAddTask}>
              <AddIcon className="h-4 w-4" />
              משימה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין משימות מתויגות לרכב זה.</p>
            ) : (
              tasks.map((t) => {
                const done = t.status === "done";
                const body = (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => toggleTaskDone(t)}
                      aria-label={done ? "סימון כלא הושלמה" : "סימון כהושלמה"}
                      className="h-4 w-4 shrink-0 accent-[rgb(var(--green-4))]"
                    />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className={cn("truncate font-medium", done && "text-muted-foreground line-through")}>
                        {t.subject || "משימה"}
                      </div>
                      <div className="text-xs text-muted-foreground">{fmtDate(t.dueDate) || "—"}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0">{taskStatusLabel(t.status)}</Badge>
                  </div>
                );
                return (
                  <div key={t.id} className="border-b last:border-0">
                    <div className="lg:hidden">
                      <SwipeActions
                        className="rounded-none"
                        open={taskSwipedId === t.id}
                        onOpenChange={(next) => setTaskSwipedId(next ? t.id : null)}
                        actions={[
                          {
                            key: "edit",
                            label: "עריכה",
                            icon: <EditIcon className="h-4 w-4" />,
                            onSelect: () => openEditTask(t.id),
                            className: "bg-secondary text-secondary-foreground",
                          },
                          {
                            key: "delete",
                            label: "מחיקה",
                            icon: <DeleteIcon className="h-4 w-4" />,
                            onSelect: () => setDel({ kind: "task", id: t.id, label: t.subject || "משימה" }),
                            className: "bg-destructive text-destructive-foreground",
                          },
                        ]}
                      >
                        <div className="bg-card py-2">{body}</div>
                      </SwipeActions>
                    </div>
                    <div className="hidden items-center gap-2 py-2 lg:flex">
                      {body}
                      <RowActionsMenu
                        onEdit={() => openEditTask(t.id)}
                        onDelete={() => setDel({ kind: "task", id: t.id, label: t.subject || "משימה" })}
                        deleteLabel="מחיקת משימה"
                      />
                    </div>
                  </div>
                );
              })
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
            <Button size="sm" variant="outline" onClick={openAddDoc}>
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
