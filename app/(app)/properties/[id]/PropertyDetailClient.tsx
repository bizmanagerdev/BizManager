"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, DocumentIcon, TaskIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { ExpenseDialog, type EditingExpenseData, type EditingRecurringTemplateData } from "@/components/expenses/ExpenseDialog";
import { IncomeDialog } from "@/components/financial/IncomeDialog";
import { CustomerPicker, type PickedCustomer } from "@/components/customers/CustomerPicker";
import { TaskUpsertDialog, type UserOption } from "@/components/tasks/TaskUpsertDialog";
import { DOCUMENT_CATEGORIES, inferDefaultDocumentCategory } from "@/lib/documents";
import { formatCurrency } from "@/lib/payroll";
import {
  depositTypeLabel,
  leaseStatusLabel,
  pickCurrentLease,
  propertyDisplayName,
  recurringFrequencyLabel,
  taskStatusLabel,
  type LeaseAgreement,
  type PropertyActivity,
  type PropertyExpense,
  type PropertyRecurringTemplate,
  type PropertyTask,
  type PropertyWithLeases,
} from "@/lib/properties";
import { toHebrewError } from "@/lib/error-messages";
import { offlineUpload } from "@/lib/offline-upload";
import { createLease, updateLease, deleteLease, setLeaseDocument, type LeaseInput } from "../actions";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import RentScheduleSection from "./RentScheduleSection";
import PropertyDetailsCard from "./PropertyDetailsCard";
import PropertyPurchaseCard from "./PropertyPurchaseCard";
import PropertyFurnitureCard from "./PropertyFurnitureCard";

function fmtDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

const EMPTY_LEASE_FORM = {
  customer: null as PickedCustomer | null,
  start_date: "",
  end_date: "",
  monthly_rent_amount: "",
  status: "active",
  notes: "",
  deposit_type: "",
  deposit_amount: "",
  deposit_reference: "",
};

type LeaseForm = typeof EMPTY_LEASE_FORM;

function toLeaseForm(lease: LeaseAgreement): LeaseForm {
  return {
    customer: { id: lease.customerId, name: lease.customerName ?? "שוכר", phone: null },
    start_date: lease.startDate ?? "",
    end_date: lease.endDate ?? "",
    monthly_rent_amount: lease.monthlyRentAmount ? String(lease.monthlyRentAmount) : "",
    status: lease.status ?? "active",
    notes: lease.notes ?? "",
    deposit_type: lease.depositType ?? "",
    deposit_amount: lease.depositAmount != null ? String(lease.depositAmount) : "",
    deposit_reference: lease.depositReference ?? "",
  };
}

function toEditingTemplate(t: PropertyRecurringTemplate, propertyId: string): EditingRecurringTemplateData {
  return {
    id: t.id,
    template_name: t.templateName,
    category: t.category,
    amount: t.amount,
    is_variable_amount: t.isVariableAmount,
    auto_paid: t.autoPaid,
    reminder_work_days_before: t.reminderWorkDaysBefore,
    description_template: t.descriptionTemplate,
    notes_template: t.notesTemplate,
    business_domain: t.businessDomain,
    project_id: null,
    order_id: null,
    property_id: propertyId,
    account_id: t.accountId,
    included_in_base_price: false,
    billed_to_customer: false,
    project_expense_notes_template: null,
    frequency: t.frequency,
    interval_months: t.intervalMonths,
    expense_day_of_month: t.expenseDayOfMonth,
    expense_month_of_year: t.expenseMonthOfYear,
    start_date: t.startDate,
    end_date: t.endDate,
    is_active: t.isActive,
  };
}

function toEditingExpense(e: PropertyExpense): EditingExpenseData {
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

type Props = {
  propertyId: string;
  property: PropertyWithLeases;
  activity: PropertyActivity;
  users: UserOption[];
  currentUserId: string;
};

type LeaseDocState = { documentId: string | null; documentUrl: string | null; documentFileName: string | null };
const EMPTY_LEASE_DOC: LeaseDocState = { documentId: null, documentUrl: null, documentFileName: null };

const PURCHASE_DOCUMENT_CATEGORIES = new Set(["מסמכי רכישה", "נסח טאבו"]);

export default function PropertyDetailClient({ propertyId, property, activity, users, currentUserId }: Props) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const leases = property.leases;
  const address = propertyDisplayName(property);

  // expense
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<EditingExpenseData | null>(null);
  // recurring template
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EditingRecurringTemplateData | null>(null);
  // income
  const [incomeOpen, setIncomeOpen] = useState(false);
  // lease
  const [leaseOpen, setLeaseOpen] = useState(false);
  const [editLeaseId, setEditLeaseId] = useState<string | null>(null);
  const [leaseForm, setLeaseForm] = useState<LeaseForm>(EMPTY_LEASE_FORM);
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [leaseDoc, setLeaseDoc] = useState<LeaseDocState>(EMPTY_LEASE_DOC);
  const [leaseDocBusy, setLeaseDocBusy] = useState(false);
  const [pendingLeaseDocFile, setPendingLeaseDocFile] = useState<File | null>(null);
  // Re-sync the open lease dialog's document view whenever fresh server data
  // arrives (e.g. after refresh() following a successful upload) — otherwise
  // the dialog keeps showing the stale "no document attached" prompt even
  // though the attach already succeeded.
  useEffect(() => {
    if (!editLeaseId) return;
    const lease = property.leases.find((l) => l.id === editLeaseId);
    if (!lease) return;
    setLeaseDoc({
      documentId: lease.documentId,
      documentUrl: lease.documentUrl,
      documentFileName: lease.documentFileName,
    });
  }, [editLeaseId, property]);
  // task
  const [taskOpen, setTaskOpen] = useState(false);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  // document
  const [docOpen, setDocOpen] = useState(false);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docCategory, setDocCategory] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  // delete
  const [del, setDel] = useState<{ kind: "expense" | "payment" | "document" | "lease" | "task" | "template"; id: string; label: string } | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const currentLease = pickCurrentLease(leases);
  const otherLeases = leases.filter((l) => l.id !== currentLease?.id);
  const checkPayments = activity.payments.filter((p) => p.method === "check");
  const otherPayments = activity.payments.filter((p) => p.method !== "check");
  const purchaseDocuments = activity.documents.filter((d) => PURCHASE_DOCUMENT_CATEGORIES.has(d.documentType ?? ""));
  const photos = activity.documents.filter((d) => d.documentType === "צילום");
  const otherDocuments = activity.documents.filter(
    (d) => !PURCHASE_DOCUMENT_CATEGORIES.has(d.documentType ?? "") && d.documentType !== "צילום"
  );
  function openAddExpense() {
    setEditingExpense(null);
    setExpenseOpen(true);
  }
  function openEditExpense(e: PropertyExpense) {
    setEditingExpense(toEditingExpense(e));
    setExpenseOpen(true);
  }
  function openAddTemplate() {
    setEditingTemplate(null);
    setTemplateOpen(true);
  }
  function openEditTemplate(t: PropertyRecurringTemplate) {
    setEditingTemplate(toEditingTemplate(t, propertyId));
    setTemplateOpen(true);
  }
  function openAddLease() {
    setEditLeaseId(null);
    setLeaseForm(EMPTY_LEASE_FORM);
    setLeaseDoc(EMPTY_LEASE_DOC);
    setPendingLeaseDocFile(null);
    setLeaseOpen(true);
  }
  function openEditLease(lease: LeaseAgreement) {
    setEditLeaseId(lease.id);
    setLeaseForm(toLeaseForm(lease));
    setLeaseDoc({
      documentId: lease.documentId,
      documentUrl: lease.documentUrl,
      documentFileName: lease.documentFileName,
    });
    setPendingLeaseDocFile(null);
    setLeaseOpen(true);
  }
  function openAddDoc() {
    setDocFiles([]);
    setDocCategory("");
    setDocOpen(true);
  }
  function openAddPurchaseDoc() {
    setDocFiles([]);
    setDocCategory("מסמכי רכישה");
    setDocOpen(true);
  }
  function openAddPhotos() {
    setDocFiles([]);
    setDocCategory("צילום");
    setDocOpen(true);
  }
  function openAddTask() {
    setEditTaskId(null);
    setTaskOpen(true);
  }
  function openEditTask(id: string) {
    setEditTaskId(id);
    setTaskOpen(true);
  }

  async function uploadLeaseDoc(leaseId: string, file: File) {
    setLeaseDocBusy(true);
    try {
      const result = await offlineUpload("/api/documents/upload", {
        fields: { business_domain: "property_management", property_id: propertyId },
        file,
        label: file.name,
      });
      if (result.queued) {
        // The queue only replays the raw upload — it has no way to also call
        // setLeaseDocument once connectivity returns, so the attach step
        // needs a manual follow-up. Say so plainly instead of implying the
        // lease is already linked.
        toast.success("הקובץ יישמר ויועלה בהתחברות מחדש. לאחר ההעלאה יש לפתוח את החוזה שוב ולצרף את המסמך.");
        return;
      }
      if (!result.ok) {
        toast.error("שגיאה בהעלאת המסמך", { description: result.error });
        return;
      }
      const documentId = (result.data as { document?: { id?: string } } | null)?.document?.id;
      if (!documentId) {
        toast.error("שגיאה בהעלאת המסמך", { description: "לא התקבל מזהה מסמך מהשרת." });
        return;
      }
      const attachResult = await setLeaseDocument(propertyId, leaseId, documentId);
      if (!attachResult.ok) {
        toast.error(attachResult.error);
        return;
      }
      toast.success("המסמך צורף לחוזה.");
      refresh();
    } finally {
      setLeaseDocBusy(false);
    }
  }

  async function detachLeaseDoc() {
    if (!editLeaseId) return;
    setLeaseDocBusy(true);
    try {
      const result = await setLeaseDocument(propertyId, editLeaseId, null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLeaseDoc(EMPTY_LEASE_DOC);
      toast.success("המסמך הוסר מהחוזה.");
      refresh();
    } finally {
      setLeaseDocBusy(false);
    }
  }

  async function submitLease() {
    if (!leaseForm.customer) {
      toast.error("יש לבחור לקוח.");
      return;
    }
    if (!leaseForm.start_date) {
      toast.error("יש להזין תאריך התחלת שכירות.");
      return;
    }
    if (!(Number(leaseForm.monthly_rent_amount) > 0)) {
      toast.error("יש להזין מחיר חודשי תקין.");
      return;
    }
    const input: LeaseInput = {
      customer_id: leaseForm.customer.id,
      start_date: leaseForm.start_date,
      end_date: leaseForm.end_date,
      monthly_rent_amount: leaseForm.monthly_rent_amount,
      status: leaseForm.status,
      notes: leaseForm.notes,
      deposit_type: leaseForm.deposit_type,
      deposit_amount: leaseForm.deposit_amount,
      deposit_reference: leaseForm.deposit_reference,
    };
    setLeaseBusy(true);
    try {
      const result = editLeaseId
        ? await updateLease(propertyId, editLeaseId, input)
        : await createLease(propertyId, input);
      if (result.ok) {
        toast.success(editLeaseId ? "החוזה עודכן." : "החוזה נוסף.");
        if (!editLeaseId && pendingLeaseDocFile && result.id) {
          await uploadLeaseDoc(result.id, pendingLeaseDocFile);
        }
        setLeaseOpen(false);
        refresh();
      } else {
        toast.error(result.error);
      }
    } finally {
      setLeaseBusy(false);
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
      let done = 0;
      // Files still pending after this run — starts as a copy of every
      // selected file, and each success/queue shifts its file off the front
      // so a retry after a partial failure never re-submits (and duplicates)
      // a file that already uploaded successfully.
      const remaining = [...docFiles];
      for (const file of docFiles) {
        const fields: Record<string, string> = {
          business_domain: "property_management",
          property_id: propertyId,
        };
        if (docCategory.trim()) fields.category = docCategory.trim();
        const result = await offlineUpload("/api/documents/upload", {
          fields,
          file,
          label: file.name,
        });
        if (result.queued) {
          done += 1;
          remaining.shift();
        } else if (result.ok) {
          uploaded += 1;
          done += 1;
          remaining.shift();
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
      } else {
        setDocFiles(remaining);
      }
    } finally {
      setDocBusy(false);
    }
  }

  async function confirmDelete() {
    if (!del) return;
    setDelBusy(true);
    try {
      if (del.kind === "lease") {
        const result = await deleteLease(propertyId, del.id);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success("החוזה נמחק");
        setDel(null);
        refresh();
        return;
      }
      const endpoint =
        del.kind === "expense"
          ? ["/api/expenses/delete", { id: del.id, property_id: propertyId }]
          : del.kind === "payment"
            ? ["/api/payments/delete", { id: del.id }]
            : del.kind === "task"
              ? ["/api/tasks/delete", { id: del.id }]
              : del.kind === "template"
                ? ["/api/recurring-expenses/delete", { id: del.id }]
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

  return (
    <>
      <PropertyDetailsCard propertyId={propertyId} property={property} />

      {/* Leases */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">שכירות</CardTitle>
          <Button size="sm" onClick={openAddLease}>
            <AddIcon className="h-4 w-4" />
            חוזה חדש
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {currentLease ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-3">
              <div className="min-w-0 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{currentLease.customerName ?? "שוכר"}</span>
                  <Badge variant={currentLease.status === "active" ? "success" : "neutral"}>
                    {leaseStatusLabel(currentLease.status)}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {[
                    fmtDate(currentLease.startDate) && `החל מ-${fmtDate(currentLease.startDate)}`,
                    currentLease.endDate ? `עד ${fmtDate(currentLease.endDate)}` : "ללא תאריך סיום",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {currentLease.depositType ? (
                  <div className="text-xs text-muted-foreground">
                    {[
                      depositTypeLabel(currentLease.depositType),
                      currentLease.depositAmount != null ? formatCurrency(currentLease.depositAmount) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <span className="font-semibold">{formatCurrency(currentLease.monthlyRentAmount)}/חודש</span>
                <EditButton onClick={() => openEditLease(currentLease)} label="עריכת חוזה" />
                <DeleteButton
                  onClick={() => setDel({ kind: "lease", id: currentLease.id, label: "חוזה שכירות" })}
                  label="מחיקת חוזה"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">אין חוזה שכירות פעיל — הנכס פנוי.</p>
          )}

          {otherLeases.length > 0 ? (
            <CollapsibleSection title={`היסטוריית חוזים (${otherLeases.length})`} defaultOpen={false}>
              <div className="space-y-2">
                {otherLeases.map((lease) => (
                  <div key={lease.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{lease.customerName ?? "שוכר"}</span>
                        <Badge variant="neutral">{leaseStatusLabel(lease.status)}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[fmtDate(lease.startDate), fmtDate(lease.endDate)].filter(Boolean).join(" – ")}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-sm">{formatCurrency(lease.monthlyRentAmount)}/חודש</span>
                      <EditButton onClick={() => openEditLease(lease)} label="עריכת חוזה" />
                      <DeleteButton
                        onClick={() => setDel({ kind: "lease", id: lease.id, label: "חוזה שכירות" })}
                        label="מחיקת חוזה"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Expenses */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">הוצאות ({activity.expenses.length})</CardTitle>
            <Button size="sm" onClick={openAddExpense}>
              <AddIcon className="h-4 w-4" />
              הוצאה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {activity.expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין הוצאות לנכס זה.</p>
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
                    <EditButton onClick={() => openEditExpense(e)} label="עריכה" />
                    <DeleteButton onClick={() => setDel({ kind: "expense", id: e.id, label: e.category || "הוצאה" })} label="מחיקת הוצאה" />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Income (non-check — rent checks live in the rent-schedule section below) */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">הכנסות אחרות ({otherPayments.length})</CardTitle>
            <Button size="sm" onClick={() => setIncomeOpen(true)}>
              <AddIcon className="h-4 w-4" />
              הכנסה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {otherPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין הכנסות נוספות לנכס זה.</p>
            ) : (
              otherPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{p.method || "תשלום"}</div>
                    <div className="text-xs text-muted-foreground">{fmtDate(p.date) || "—"}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="font-semibold text-emerald-600">{formatCurrency(p.amount)}</span>
                    <DeleteButton onClick={() => setDel({ kind: "payment", id: p.id, label: "הכנסה" })} label="מחיקת הכנסה" />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <RentScheduleSection
          propertyId={propertyId}
          currentLease={currentLease}
          payments={checkPayments}
          onDeleteRequest={(id, label) => setDel({ kind: "payment", id, label })}
        />

        {/* Tasks */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-1 text-base">
              <TaskIcon className="h-4 w-4" />
              משימות ({activity.tasks.length})
            </CardTitle>
            <Button size="sm" onClick={openAddTask}>
              <AddIcon className="h-4 w-4" />
              משימה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {activity.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין משימות לנכס זה.</p>
            ) : (
              activity.tasks.map((t: PropertyTask) => (
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

        {/* Recurring charges — water/electricity/arnona/vaad bayit etc. */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">הוצאות קבועות ({activity.recurringTemplates.length})</CardTitle>
            <Button size="sm" onClick={openAddTemplate}>
              <AddIcon className="h-4 w-4" />
              הוצאה קבועה
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {activity.recurringTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין הוצאות קבועות לנכס זה (מים, חשמל, ארנונה, ועד בית וכו׳).</p>
            ) : (
              activity.recurringTemplates.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <div className="truncate font-medium">{t.templateName || t.category || "הוצאה קבועה"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[t.category, recurringFrequencyLabel(t)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!t.isActive ? <Badge variant="neutral">לא פעיל</Badge> : null}
                    <span className="font-semibold">{formatCurrency(t.amount ?? 0)}</span>
                    <EditButton onClick={() => openEditTemplate(t)} label="עריכה" />
                    <DeleteButton
                      onClick={() => setDel({ kind: "template", id: t.id, label: t.templateName || t.category || "הוצאה קבועה" })}
                      label="מחיקת הוצאה קבועה"
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <PropertyPurchaseCard
          propertyId={propertyId}
          property={property}
          documents={purchaseDocuments}
          onAddDocument={openAddPurchaseDoc}
          onDeleteDocument={(id, label) => setDel({ kind: "document", id, label })}
        />

        <PropertyFurnitureCard propertyId={propertyId} property={property} />

        {/* Photo gallery */}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">תמונות הנכס ({photos.length})</CardTitle>
            <Button size="sm" onClick={openAddPhotos}>
              <AddIcon className="h-4 w-4" />
              הוספת תמונות
            </Button>
          </CardHeader>
          <CardContent>
            {photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין תמונות לנכס זה.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {photos.map((photo) => (
                  <div key={photo.id} className="space-y-1">
                    <a
                      href={photo.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-xl border border-border/70 bg-background/70"
                    >
                      {photo.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo.url} alt={photo.title ?? photo.fileName ?? "תמונה"} className="h-28 w-full object-cover" />
                      ) : (
                        <div className="flex h-28 w-full items-center justify-center text-xs text-muted-foreground">אין תצוגה</div>
                      )}
                    </a>
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[11px] text-muted-foreground">{fmtDate(photo.uploadedAt)}</span>
                      <DeleteButton onClick={() => setDel({ kind: "document", id: photo.id, label: photo.title || "תמונה" })} label="מחיקת תמונה" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-1 text-base">
              <DocumentIcon className="h-4 w-4" />
              מסמכים ({otherDocuments.length})
            </CardTitle>
            <Button size="sm" onClick={openAddDoc}>
              <AddIcon className="h-4 w-4" />
              מסמך
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {otherDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין מסמכים נוספים לנכס זה.</p>
            ) : (
              otherDocuments.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="truncate font-medium text-primary hover:underline">
                        {d.title || d.fileName || "מסמך"}
                      </a>
                    ) : (
                      <div className="truncate font-medium">{d.title || d.fileName || "מסמך"}</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {[d.documentType, fmtDate(d.uploadedAt)].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
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
        lockedPropertyId={propertyId}
        editingSourceLabel={address}
        showAttachments
        onSaved={() => refresh()}
      />

      {/* Recurring charge dialog (add + edit) — same shared dialog, recurring mode */}
      <ExpenseDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        editingRecurringTemplate={editingTemplate}
        defaultRecurring
        lockedPropertyId={propertyId}
        editingSourceLabel={address}
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
        fixedTarget={{ type: "property", id: propertyId }}
        onSaved={() => refresh()}
      />

      {/* Income dialog (add) */}
      <IncomeDialog
        open={incomeOpen}
        onOpenChange={setIncomeOpen}
        projects={[]}
        orders={[]}
        properties={[]}
        lockedPropertyId={propertyId}
        onSaved={() => {
          setIncomeOpen(false);
          refresh();
        }}
      />

      {/* Lease dialog (add + edit) */}
      <FormDialog
        open={leaseOpen}
        onOpenChange={setLeaseOpen}
        title={editLeaseId ? "עריכת חוזה שכירות" : "חוזה שכירות חדש"}
        description={`הנכס: ${address}`}
        size="formLg"
        onSubmit={() => void submitLease()}
        submitLabel={editLeaseId ? "שמירה" : "הוספה"}
        busyLabel="שומר..."
        busy={leaseBusy}
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">שוכר (לקוח) *</div>
            <CustomerPicker
              value={leaseForm.customer}
              onChange={(customer) => setLeaseForm((prev) => ({ ...prev, customer }))}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך התחלת שכירות *</div>
              <DateInput
                value={leaseForm.start_date}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, start_date: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך סיום</div>
              <DateInput
                value={leaseForm.end_date}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, end_date: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">מחיר חודשי *</div>
              <CurrencyInput
                type="number"
                min="0"
                step="0.01"
                value={leaseForm.monthly_rent_amount}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, monthly_rent_amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">סטטוס</div>
              <NativeSelect
                value={leaseForm.status}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, status: e.target.value }))}
              >
                <option value="active">פעיל</option>
                <option value="ended">הסתיים</option>
                <option value="cancelled">בוטל</option>
              </NativeSelect>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">בטוחה</div>
              <NativeSelect
                value={leaseForm.deposit_type}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, deposit_type: e.target.value }))}
              >
                <option value="">ללא</option>
                <option value="cash">פיקדון כספי</option>
                <option value="bank_guarantee">ערבות בנקאית</option>
                <option value="security_check">צ׳ק ביטחון</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">סכום</div>
              <CurrencyInput
                value={leaseForm.deposit_amount}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, deposit_amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">מספר צ׳ק / אסמכתא</div>
              <Input
                value={leaseForm.deposit_reference}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, deposit_reference: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">הערות</div>
            <Textarea value={leaseForm.notes} onChange={(e) => setLeaseForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">מסמך חתום</div>
            {editLeaseId ? (
              leaseDoc.documentUrl ? (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-2 text-sm">
                  <a href={leaseDoc.documentUrl} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">
                    {leaseDoc.documentFileName || "מסמך"}
                  </a>
                  <Button type="button" variant="secondary" size="sm" onClick={detachLeaseDoc} disabled={leaseDocBusy}>
                    הסרה
                  </Button>
                </div>
              ) : (
                <FileUploadActions
                  files={[]}
                  onFilesSelected={(files) => {
                    const file = files[0];
                    if (file) void uploadLeaseDoc(editLeaseId, file);
                  }}
                  disabled={leaseDocBusy}
                  chooseLabel="העלאת הסכם חתום"
                />
              )
            ) : pendingLeaseDocFile ? (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-2 text-sm">
                <span className="truncate">{pendingLeaseDocFile.name}</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => setPendingLeaseDocFile(null)}>
                  הסרה
                </Button>
              </div>
            ) : (
              <>
                <FileUploadActions
                  files={[]}
                  onFilesSelected={(files) => setPendingLeaseDocFile(files[0] ?? null)}
                  chooseLabel="בחירת הסכם חתום"
                />
                <p className="text-xs text-muted-foreground">הקובץ יועלה וישויך לחוזה עם השמירה.</p>
              </>
            )}
          </div>
        </div>
      </FormDialog>

      {/* Document upload dialog (add) */}
      <FormDialog
        open={docOpen}
        onOpenChange={setDocOpen}
        title={`העלאת מסמך לנכס: ${address}`}
        description="הקובץ נשמר בארכיון המסמכים ומקושר לנכס הזה."
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
              // Only auto-infer from the file name when there's exactly one file —
              // a multi-file batch shares a single category for all files, so
              // guessing from file #1 alone would mis-file the rest (e.g. a photo
              // + a PDF selected together would put the PDF in the photo gallery).
              if (files.length === 1 && !docCategory) setDocCategory(inferDefaultDocumentCategory(files[0]?.name));
            }}
            multiple
            disabled={docBusy}
            chooseLabel="בחירת קבצים"
          />
          <div className="space-y-1">
            <div className="text-sm font-medium">קטגוריה</div>
            <NativeSelect value={docCategory} onChange={(e) => setDocCategory(e.target.value)} disabled={docBusy}>
              <option value="">ללא קטגוריה</option>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </FormDialog>

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
