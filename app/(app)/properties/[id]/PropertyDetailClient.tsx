"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, DocumentIcon, ImageIcon, MoreIcon, RecurringIcon, SearchIcon, TaskIcon } from "@/components/ui/icons";
import { MetaRow } from "@/components/ui/meta-row";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { deleteRecurringExpenseTemplate } from "@/lib/recurring/deleteTemplate";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import {
  ExpenseDialog,
  type EditingExpenseData,
  type EditingRecurringTemplateData,
  type ExpenseWorkerOption,
} from "@/components/expenses/ExpenseDialog";
import { IncomeDialog } from "@/components/financial/IncomeDialog";
import { CustomerPicker, type PickedCustomer } from "@/components/customers/CustomerPicker";
import type { UserOption } from "@/components/tasks/TaskUpsertDialog";
import { DOCUMENT_CATEGORIES, inferDefaultDocumentCategory } from "@/lib/documents";
import { formatCurrency, type SalaryAgreementRow } from "@/lib/payroll";
import type { UserRole } from "@/lib/auth/requireProfile";
import { appendDictatedText } from "@/lib/dictation";
import { filterByText } from "@/lib/search/listSearch";
import { formatDateWithTime, formatShortDateTime } from "@/lib/date";
import {
  pickCurrentLease,
  propertyDisplayName,
  propertyTypeLabel,
  recurringFrequencyLabel,
  taskStatusLabel,
  type LeaseAgreement,
  type PropertyActivity,
  type PropertyExpense,
  type PropertyPayment,
  type PropertyRecurringTemplate,
  type PropertySession,
  type PropertyTask,
  type PropertyWithLeases,
} from "@/lib/properties";
import { toHebrewError } from "@/lib/error-messages";
import { offlineUpload } from "@/lib/offline-upload";
import { createLease, updateLease, deleteLease, deleteProperty, setLeaseDocument, type LeaseInput } from "../actions";
import { EditButton } from "@/components/ui/icon-button";
import { DocumentLink, DocumentRow, DocumentTile } from "@/components/ui/document-tile";
import MissingDocumentsChecklist from "@/components/documents/MissingDocumentsChecklist";
import { isImageDocument } from "@/lib/documents";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit } from "@/lib/undo-engine";
import { invalidateQuickCreateCache } from "@/components/layout/QuickCreateMenu";
import ProjectMovements from "@/app/(app)/projects/[id]/ProjectMovements";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import RentScheduleDialog from "./RentScheduleSection";
import PropertyDetailsCard from "./PropertyDetailsCard";
import PropertyPageHeading from "./PropertyPageHeading";
import PropertyMoneyCard from "./PropertyMoneyCard";
import PropertyIncomeEditDialog from "./PropertyIncomeEditDialog";
import PropertyRentPaymentDialog from "./PropertyRentPaymentDialog";
import PropertyCheckArrivedDialog from "./PropertyCheckArrivedDialog";
import { PropertyRentersCard, PropertyRentersRentCard, PropertyRentersSection, renterStatuses } from "./PropertyRenters";
import { hasRenters, renterPayments, runningLeases } from "@/lib/property-rent";
import { israelDateKey } from "@/lib/timezone";
import { PropertyRentCard, PropertyTenantCard } from "./PropertyLeaseCards";
import { buildPropertyMovements } from "./propertyMovements";
import type { PropertyStaffUser } from "@/lib/properties";
import { hebrewDayName } from "@/lib/rent-periods";

const HEBREW_DAYS = Array.from({ length: 30 }, (_, i) => i + 1);
import PropertyPurchaseCard from "./PropertyPurchaseCard";
import PropertyFurnitureCard from "./PropertyFurnitureCard";
import PropertyUtilitiesCard from "./PropertyUtilitiesCard";

const TaskUpsertDialog = dynamic(
  () => import("@/components/tasks/TaskUpsertDialog").then((mod) => mod.TaskUpsertDialog),
  { loading: () => null }
);

/** For real moments (a file's upload) — the day and the hour (owner, 2026-10-15). */
function fmtDateTime(value: string | null) {
  return formatShortDateTime(value, "");
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
  keys_handed_over: "",
  rent_day_of_month: "",
  rent_calendar: "gregorian",
  rent_hebrew_day: "1",
  period_months: "1",
  area_sqm: "",
  unit_label: "",
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
    keys_handed_over: lease.keysHandedOver != null ? String(lease.keysHandedOver) : "",
    rent_day_of_month: lease.rentDayOfMonth != null ? String(lease.rentDayOfMonth) : "",
    rent_calendar: lease.rentCalendar,
    rent_hebrew_day: lease.rentHebrewDay != null ? String(lease.rentHebrewDay) : "1",
    period_months: String(lease.periodMonths),
    area_sqm: lease.areaSqm != null ? String(lease.areaSqm) : "",
    unit_label: lease.unitLabel ?? "",
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

/**
 * A user as this page needs to know them — for the task-assignee list, the
 * session-worker picker, AND resolving a session row's display name (which
 * needs EVERY worker who ever clocked in here, active or not — see the
 * unfiltered query in page.tsx). One shape, filtered differently per use in
 * this component rather than fetched three different ways server-side.
 */
export type { PropertyStaffUser };

type Props = {
  propertyId: string;
  property: PropertyWithLeases;
  activity: PropertyActivity;
  users: PropertyStaffUser[];
  salaryAgreements: SalaryAgreementRow[];
  currentUserId: string;
  currentUserRole: UserRole;
  /**
   * The server's part of the page has come (lib/properties.ts — its documents,
   * files and recurring bills). On the device version it fills in after the
   * page; until then those sections say they're loading, not that there's none.
   */
  serverPartsReady?: boolean;
};

type LeaseDocState = { documentId: string | null; documentUrl: string | null; documentFileName: string | null };
const EMPTY_LEASE_DOC: LeaseDocState = { documentId: null, documentUrl: null, documentFileName: null };

const PURCHASE_DOCUMENT_CATEGORIES = new Set(["מסמכי רכישה", "נסח טאבו"]);

export default function PropertyDetailClient({
  propertyId,
  property,
  activity,
  users,
  salaryAgreements,
  currentUserId,
  currentUserRole,
  serverPartsReady = true,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => { router.refresh(); });
  const leases = useUndoOverlay(property.leases, (l) => l.id, "property-lease");
  const activityExpenses = useUndoOverlay(activity.expenses, (e) => e.id, "property-expense");
  const activitySessions = useUndoOverlay(activity.sessions, (s) => s.id, "property-session");
  const activityPayments = useUndoOverlay(activity.payments, (p) => p.id, "property-payment");
  const activityDocuments = useUndoOverlay(activity.documents, (d) => d.id, "property-document");
  const activityTasks = useUndoOverlay(activity.tasks, (t) => t.id, "property-task");
  const activityTemplates = useUndoOverlay(activity.recurringTemplates, (t) => t.id, "property-template");
  // A generated row reads by its template's name — the same label the ledger
  // and the payments calendar use. The core knows the names of the bills its
  // expenses came from; the bills listed here (and edited) win.
  const templateNameById = useMemo(
    () =>
      new Map([
        ...Object.entries(activity.templateNames ?? {}),
        ...activityTemplates.filter((t) => t.templateName).map((t) => [t.id, t.templateName as string] as const),
      ]),
    [activity.templateNames, activityTemplates]
  );
  const expenseLabel = (e: PropertyExpense) =>
    (e.recurringTemplateId && templateNameById.get(e.recurringTemplateId)) || e.description || e.category || "הוצאה";
  const address = propertyDisplayName(property);
  // Opened from a list card's renter or rent row (#tenant, #rent, #renters):
  // that part of the page, once it's on screen.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  // Task assignment stays limited to active, dashboard-having staff (unchanged
  // behavior from before `users` widened to include everyone).
  const taskUsers: UserOption[] = users
    .filter((u) => u.active && u.role !== "worker_no_access")
    .map((u) => ({ id: u.id, label: u.label, color: u.color }));
  // The session worker picker allows session-only/קבלנות workers too (they
  // just can't be assigned a dashboard-facing task) — same as the project page.
  const workerOptions: ExpenseWorkerOption[] = users
    .filter((u) => u.active)
    .map((u) => ({
      id: u.id,
      label: u.label,
      role: (u.role ?? undefined) as ExpenseWorkerOption["role"],
      payroll_worker_type: u.payrollWorkerType as ExpenseWorkerOption["payroll_worker_type"],
      pay_tracking_mode: u.payTrackingMode,
    }));

  // expense
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<EditingExpenseData | null>(null);
  const [editingSession, setEditingSession] = useState<PropertySession | null>(null);
  // income
  const [editingPayment, setEditingPayment] = useState<PropertyPayment | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Which renter's schedule, on a property with several (null: the current lease).
  const [scheduleLeaseId, setScheduleLeaseId] = useState<string | null>(null);
  // the property itself
  const [detailsEditOpen, setDetailsEditOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [deletePropertyOpen, setDeletePropertyOpen] = useState(false);
  // the money table's search (owner's card: "חיפוש בחלק של הוצאות")
  const [search, setSearch] = useState("");
  // recurring template
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EditingRecurringTemplateData | null>(null);
  // income
  const [incomeOpen, setIncomeOpen] = useState(false);
  // a lease's rent, with the month(s) it pays
  const [rentPaymentOpen, setRentPaymentOpen] = useState(false);
  const [rentPaymentLeaseId, setRentPaymentLeaseId] = useState<string | null>(null);
  // A due rent check that cleared — into which account.
  const [arrival, setArrival] = useState<{ payment: PropertyPayment; title: string } | null>(null);
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
  const [checklistKey, setChecklistKey] = useState(0);
  const [docBusy, setDocBusy] = useState(false);
  // delete
  const [del, setDel] = useState<{ kind: "expense" | "payment" | "document" | "lease" | "task" | "template" | "session"; id: string; label: string } | null>(null);

  const currentLease = pickCurrentLease(leases);
  // A storage property, or one let to several at once: its renters, each with
  // its own rent (PropertyRenters.tsx).
  const today = israelDateKey();
  const running = runningLeases(leases, today);
  const withRenters = hasRenters(property.propertyType, running.length);
  const renters = withRenters ? renterStatuses(running, activityPayments, today) : [];
  const scheduleLease = leases.find((l) => l.id === scheduleLeaseId) ?? currentLease;
  const rentPaymentLease = leases.find((l) => l.id === rentPaymentLeaseId) ?? currentLease;
  const openSchedule = (lease: LeaseAgreement | null) => {
    setScheduleLeaseId(lease?.id ?? null);
    setScheduleOpen(true);
  };
  const openRentPayment = (lease: LeaseAgreement) => {
    setRentPaymentLeaseId(lease.id);
    setRentPaymentOpen(true);
  };
  const otherLeases = leases.filter((l) => l.id !== currentLease?.id);
  const purchaseDocuments = activityDocuments.filter((d) => PURCHASE_DOCUMENT_CATEGORIES.has(d.documentType ?? ""));
  // A picture of the property is an image with nothing more specific said about
  // it. Matching the file kind as well as the "צילום" category picks up images
  // that arrived from elsewhere uncategorised — but a document that IS filed as
  // something (a photographed חשבונית) stays in the documents list rather than
  // landing in the gallery.
  const isPropertyPhoto = (d: (typeof activityDocuments)[number]) =>
    d.documentType === "צילום" ||
    (!d.documentType && isImageDocument({ file_name: d.fileName, document_type: d.documentType }));
  const photos = activityDocuments.filter(isPropertyPhoto);
  const otherDocuments = activityDocuments.filter(
    (d) => !PURCHASE_DOCUMENT_CATEGORIES.has(d.documentType ?? "") && !isPropertyPhoto(d)
  );
  const userNameById = new Map(users.map((u) => [u.id, u.label]));

  // Every income, expense and shift as one table, and what's still to come
  // as a second (propertyMovements.ts).
  const movements = useMemo(
    () =>
      buildPropertyMovements({
        payments: activityPayments,
        leases,
        currentLease,
        expenses: activityExpenses,
        sessions: activitySessions,
        sessionAttachments: activity.sessionAttachments,
        accountNames: activity.accountNames,
        templateNameById,
        users,
        onEditPayment: setEditingPayment,
        onDeletePayment: (payment) => setDel({ kind: "payment", id: payment.id, label: "הכנסה" }),
        onToggleCleared: toggleCleared,
        onCheckArrived: (payment, title) => setArrival({ payment, title }),
        onEditExpense: openEditExpense,
        onDeleteExpense: (expense) => setDel({ kind: "expense", id: expense.id, label: expenseLabel(expense) }),
        onEditSession: openEditSession,
        onDeleteSession: (session) =>
          setDel({ kind: "session", id: session.id, label: `משמרת (${userNameById.get(session.user_id) ?? "עובד"})` }),
      }),
    // The handlers only set state; the rows change with the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activityPayments, leases, currentLease, activityExpenses, activitySessions, activity.sessionAttachments, activity.accountNames, templateNameById, users]
  );
  const movementTexts = (m: (typeof movements.done)[number]) => [
    m.name,
    m.category,
    m.hint,
    m.account,
    m.amount != null ? String(m.amount) : null,
    ...m.extras.map((x) => x.value),
  ];
  const visibleDone = filterByText(movements.done, movementTexts, search);
  const visibleExpected = filterByText(movements.expected, movementTexts, search);

  /** A rent check: נפרע, or back to waiting. */
  function toggleCleared(payment: PropertyPayment) {
    const collected = payment.paymentStatus !== "cleared";
    scheduleDeferredEdit({
      scope: "property-payment",
      id: payment.id,
      message: collected ? "התשלום סומן כנפרע." : "הסימון בוטל.",
      patch: { paymentStatus: collected ? "cleared" : "pending" },
      onCommit: async () => {
        const res = await fetch("/api/payments/mark-collected", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: payment.id, collected }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "") };
        refresh();
        return { ok: true };
      },
    });
  }

  async function deleteThisProperty() {
    setDeletePropertyOpen(false);
    const result = await deleteProperty(propertyId);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    invalidateQuickCreateCache();
    toast.success("הנכס נמחק.");
    router.push("/properties");
  }
  function openAddExpense() {
    setEditingExpense(null);
    setEditingSession(null);
    setExpenseOpen(true);
  }
  function openEditExpense(e: PropertyExpense) {
    setEditingExpense(toEditingExpense(e));
    setEditingSession(null);
    setExpenseOpen(true);
  }
  function openEditSession(s: PropertySession) {
    setEditingExpense(null);
    setEditingSession(s);
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
  function openAddDocWithCategory(categoryCode: string) {
    setDocFiles([]);
    setDocCategory(categoryCode);
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
        // Filed as חוזה/הסכם, not the generic default — a signed lease is the
        // one document on a property whose category is never in doubt, and it
        // makes it findable by category in the archive.
        fields: {
          business_domain: "property_management",
          property_id: propertyId,
          category: "חוזה/הסכם",
        },
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
      toast.error("יש להזין סכום תקין.");
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
      keys_handed_over: leaseForm.keys_handed_over,
      rent_day_of_month: leaseForm.rent_day_of_month,
      rent_calendar: leaseForm.rent_calendar,
      rent_hebrew_day: leaseForm.rent_hebrew_day,
      period_months: leaseForm.period_months,
      area_sqm: leaseForm.area_sqm,
      unit_label: leaseForm.unit_label,
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
        setChecklistKey((k) => k + 1);
        refresh();
      } else {
        setDocFiles(remaining);
      }
    } finally {
      setDocBusy(false);
    }
  }

  function confirmDelete() {
    if (!del) return;
    const target = del;
    setDel(null);
    scheduleDeferredDelete({
      scope: `property-${target.kind}`,
      id: target.id,
      message: target.kind === "lease" ? "החוזה נמחק" : "נמחק",
      onCommit: async () => {
        if (target.kind === "lease") {
          const result = await deleteLease(propertyId, target.id);
          if (!result.ok) return { ok: false, error: result.error };
          refresh();
          return { ok: true };
        }
        if (target.kind === "template") {
          const result = await deleteRecurringExpenseTemplate(target.id);
          if (!result.ok) return { ok: false, error: toHebrewError(result.error, "") };
          refresh();
          return { ok: true };
        }
        const endpoint =
          target.kind === "expense"
            ? ["/api/expenses/delete", { id: target.id, property_id: propertyId }]
            : target.kind === "payment"
              ? ["/api/payments/delete", { id: target.id }]
              : target.kind === "task"
                ? ["/api/tasks/delete", { id: target.id }]
                : target.kind === "session"
                  ? ["/api/payroll/sessions/delete", { session_id: target.id }]
                  : ["/api/documents/delete", { document_id: target.id }];
        const res = await fetch(endpoint[0] as string, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(endpoint[1]),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: toHebrewError(json?.error, "") };
        refresh();
        return { ok: true };
      },
    });
  }

  return (
    // @container: the page's columns go by the room there is in text units —
    // at the largest text a laptop gets them stacked, not squeezed (8rem cards).
    <div className="space-y-3 @container md:space-y-5">
      <PropertyPageHeading
        name={address}
        typeLabel={property.propertyType ? propertyTypeLabel(property.propertyType) : null}
        rented={currentLease?.status === "active"}
        inactive={!property.isActive}
        actions={
          <div className="flex items-center gap-1.5">
            <EditButton onClick={() => setDetailsEditOpen(true)} label="עריכת פרטי הנכס" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="עוד פעולות">
                  <MoreIcon className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setReminderOpen(true)}>תזכורת</DropdownMenuItem>
                <DropdownMenuItem onClick={openAddLease}>חוזה חדש</DropdownMenuItem>
                {currentLease ? (
                  <DropdownMenuItem onClick={() => openSchedule(null)}>קביעת תשלומים מראש</DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={() => setDeletePropertyOpen(true)}
                  className="text-destructive focus:text-destructive"
                >
                  מחיקת הנכס
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* The head row, like a project's: what it is, who rents it, and where
          this month's rent stands. The three share the tallest one's height. */}
      <div className="grid grid-cols-1 gap-3 lg:@[31rem]:grid-cols-3">
        <PropertyDetailsCard
          propertyId={propertyId}
          property={property}
          editOpen={detailsEditOpen}
          onEditOpenChange={setDetailsEditOpen}
        />
        {withRenters ? (
          <>
            <PropertyRentersCard renters={renters} onNew={openAddLease} />
            <PropertyRentersRentCard renters={renters} />
          </>
        ) : (
          <>
            <PropertyTenantCard
              lease={currentLease}
              pastLeases={otherLeases}
              keyCount={property.keyCount}
              filesReady={serverPartsReady}
              onEdit={openEditLease}
              onNew={openAddLease}
              onDelete={(lease) => setDel({ kind: "lease", id: lease.id, label: "חוזה שכירות" })}
            />
            <PropertyRentCard
              lease={currentLease}
              payments={activityPayments}
              onRecord={() => (currentLease ? openRentPayment(currentLease) : setIncomeOpen(true))}
              onSchedule={() => openSchedule(null)}
            />
          </>
        )}
      </div>

      {/* The main column takes the head row's first two cards' width, the side
          column the third's — same gap, so their edges line up. */}
      <div className="flex flex-col gap-3 lg:@[31rem]:grid lg:@[31rem]:grid-cols-[minmax(0,1fr)_calc((100%_-_1.5rem)/3)] lg:@[31rem]:items-start">
        <div className="min-w-0 space-y-3">
          {withRenters ? (
            <PropertyRentersSection
              renters={renters}
              ended={leases.filter((l) => !running.some((r) => r.id === l.id))}
              onRecord={openRentPayment}
              onSchedule={openSchedule}
              onEdit={openEditLease}
              onDelete={(lease) => setDel({ kind: "lease", id: lease.id, label: "חוזה שכירות" })}
              onNew={openAddLease}
            />
          ) : null}
          <CollapsibleSection
            collapsible={false}
            title={
              <span className="flex items-center gap-1.5">
                תנועות
                <SectionCount count={movements.done.length} />
              </span>
            }
            contentClassName="@container flex flex-col text-sm"
            action={
              <div className="flex items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" onClick={() => setIncomeOpen(true)}>
                  <AddIcon className="h-4 w-4" />
                  הכנסה
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={openAddExpense}>
                  <AddIcon className="h-4 w-4" />
                  הוצאה
                </Button>
              </div>
            }
          >
            <div className="relative mb-2">
              <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש בתנועות — שם, קטגוריה, סכום…"
                aria-label="חיפוש בתנועות"
                className="ps-9"
              />
            </div>
            <ProjectMovements
              movements={visibleDone}
              groupBy="none"
              sortBy="date"
              // Newest first (owner, 2026-10-21); the expected list below stays soonest first.
              sortDirection="desc"
              showBilled={false}
              emptyText={search.trim() ? "לא נמצאו תנועות לחיפוש הזה." : "אין עדיין הכנסות או הוצאות לנכס הזה."}
            />
          </CollapsibleSection>

          {movements.expected.length > 0 ? (
            <CollapsibleSection
              defaultOpen
              title={
                <span className="flex items-center gap-1.5">
                  צפויים
                  <SectionCount count={movements.expected.length} />
                </span>
              }
              contentClassName="@container flex flex-col text-sm"
            >
              <p className="mb-2 text-xs text-muted-foreground">צ׳קים שעוד לא נפרעו, והוצאות שעוד לא שולמו.</p>
              <ProjectMovements
                movements={visibleExpected}
                groupBy="none"
                sortBy="date"
                sortDirection="asc"
                showBilled={false}
                emptyText="לא נמצאו תנועות לחיפוש הזה."
              />
            </CollapsibleSection>
          ) : null}

          <CollapsibleSection
            defaultOpen={activityTasks.length > 0}
            title="משימות"
            icon={<TaskIcon className={SECTION_ICON_CLASS} />}
            summary={activityTasks.length > 0 ? <SectionCount count={activityTasks.length} /> : null}
            action={
              <Button type="button" size="sm" variant="outline" onClick={openAddTask}>
                <AddIcon className="h-4 w-4" />
                משימה
              </Button>
            }
          >
            {activityTasks.length === 0 ? (
              <EmptyState dense>אין משימות לנכס הזה.</EmptyState>
            ) : (
              <ul className="divide-y">
                {activityTasks.map((t: PropertyTask) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <button type="button" onClick={() => openEditTask(t.id)} className="min-w-0 text-start text-sm">
                      <div className="font-medium">{t.subject || "משימה"}</div>
                      <div className="text-xs text-muted-foreground">{formatDateWithTime(t.dueDate, t.dueTime, "—")}</div>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="outline">{taskStatusLabel(t.status)}</Badge>
                      <RowMenu
                        label="פעולות למשימה"
                        onEdit={() => openEditTask(t.id)}
                        onDelete={() => setDel({ kind: "task", id: t.id, label: t.subject || "משימה" })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            defaultOpen
            title="מסמכים"
            icon={<DocumentIcon className={SECTION_ICON_CLASS} />}
            summary={otherDocuments.length > 0 ? <SectionCount count={otherDocuments.length} /> : null}
            action={
              <Button type="button" size="sm" variant="outline" onClick={openAddDoc}>
                <AddIcon className="h-4 w-4" />
                מסמך
              </Button>
            }
            contentClassName="space-y-3"
          >
            <MissingDocumentsChecklist
              entityType="property"
              entityId={propertyId}
              refreshKey={checklistKey}
              onUpload={openAddDocWithCategory}
            />
            {otherDocuments.length === 0 ? (
              <EmptyState dense>{serverPartsReady ? "אין מסמכים נוספים לנכס הזה." : "טוען מסמכים…"}</EmptyState>
            ) : (
              // The row opens the file; view and download at its end on hover, the
              // delete in its quiet ⋮ (owner, 2026-10-12).
              <div className="space-y-2">
                {otherDocuments.map((d) => (
                  <DocumentRow
                    key={d.id}
                    name={d.title || d.fileName || "מסמך"}
                    fileName={d.fileName}
                    url={d.url}
                    meta={<MetaRow as="span" items={[d.documentType, fmtDateTime(d.uploadedAt)]} fallback="—" />}
                    onDelete={() => setDel({ kind: "document", id: d.id, label: d.title || "מסמך" })}
                    deleteLabel="מחיקת מסמך"
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            defaultOpen={photos.length > 0}
            title="תמונות"
            icon={<ImageIcon className={SECTION_ICON_CLASS} />}
            summary={photos.length > 0 ? <SectionCount count={photos.length} /> : null}
            action={
              <Button type="button" size="sm" variant="outline" onClick={openAddPhotos}>
                <AddIcon className="h-4 w-4" />
                תמונות
              </Button>
            }
          >
            {photos.length === 0 ? (
              <EmptyState dense>{serverPartsReady ? "אין תמונות לנכס הזה." : "טוען תמונות…"}</EmptyState>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {/* View and download on hover, the delete in the photo's quiet ⋮
                    (owner, 2026-10-12). */}
                {photos.map((photo) => (
                  <DocumentTile
                    key={photo.id}
                    name={photo.title ?? photo.fileName ?? "תמונה"}
                    fileName={photo.fileName}
                    url={photo.url}
                    isImage
                    hideName
                    previewClassName="h-28"
                    imageSizes="(max-width: 640px) 50vw, 200px"
                    date={fmtDateTime(photo.uploadedAt)}
                    onDelete={() => setDel({ kind: "document", id: photo.id, label: photo.title || "תמונה" })}
                    deleteLabel="מחיקת תמונה"
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>
        </div>

        {/* The side column: the money in one card, then what repeats. */}
        <div className="min-w-0 space-y-3">
          <PropertyMoneyCard payments={activityPayments} expenses={activityExpenses} sessions={activitySessions} />

          <CollapsibleSection
            defaultOpen
            title="הוצאות קבועות"
            icon={<RecurringIcon className={SECTION_ICON_CLASS} />}
            summary={activityTemplates.length > 0 ? <SectionCount count={activityTemplates.length} /> : null}
            action={
              <Button type="button" size="sm" variant="outline" onClick={openAddTemplate}>
                <AddIcon className="h-4 w-4" />
                הוספה
              </Button>
            }
          >
            {activityTemplates.length === 0 ? (
              <EmptyState dense>{serverPartsReady ? "אין הוצאות קבועות (מים, חשמל, ארנונה, ועד בית…)." : "טוען הוצאות קבועות…"}</EmptyState>
            ) : (
              <ul className="divide-y">
                {activityTemplates.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                    <button type="button" onClick={() => openEditTemplate(t)} className="min-w-0 text-start text-sm">
                      <div className="font-medium">{t.templateName || t.category || "הוצאה קבועה"}</div>
                      <MetaRow className="text-xs text-muted-foreground" items={[t.category, recurringFrequencyLabel(t)]} />
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {!t.isActive ? <Badge variant="neutral">לא פעיל</Badge> : null}
                      <span className="text-sm font-semibold tabular-nums">{formatCurrency(t.amount ?? 0)}</span>
                      <RowMenu
                        label="פעולות להוצאה הקבועה"
                        onEdit={() => openEditTemplate(t)}
                        onDelete={() =>
                          setDel({ kind: "template", id: t.id, label: t.templateName || t.category || "הוצאה קבועה" })
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CollapsibleSection>

          {/* The rest of what's known about it — the purchase, the furniture, the
              utility account numbers, each edited in place — at the side
              (owner, 2026-10-21), so the money has the page's width. */}
          <PropertyPurchaseCard
            propertyId={propertyId}
            property={property}
            documents={purchaseDocuments}
            onAddDocument={openAddPurchaseDoc}
            onDeleteDocument={(id, label) => setDel({ kind: "document", id, label })}
          />
          <PropertyFurnitureCard propertyId={propertyId} property={property} />
          <PropertyUtilitiesCard propertyId={propertyId} property={property} />
        </div>
      </div>

      {/* Expense dialog — add/edit an expense, or edit a worker session (both close over
          the same open/save flow; which mode depends on which editing* prop is set). */}
      <ExpenseDialog
        open={expenseOpen}
        onOpenChange={(open) => {
          setExpenseOpen(open);
          if (!open) setEditingSession(null);
        }}
        editingExpense={editingExpense}
        editingSession={editingSession}
        lockedPropertyId={propertyId}
        editingSourceLabel={address}
        showAttachments
        users={workerOptions}
        salaryAgreements={salaryAgreements}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
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
        users={taskUsers}
        currentUserId={currentUserId}
        fixedTarget={{ type: "property", id: propertyId }}
        onSaved={() => refresh()}
      />

      {/* Edit any of its incomes (the note is its title). */}
      <PropertyCheckArrivedDialog
        payment={arrival?.payment ?? null}
        title={arrival?.title ?? ""}
        onClose={() => setArrival(null)}
      />

      <PropertyIncomeEditDialog
        payment={editingPayment}
        onClose={() => setEditingPayment(null)}
        leases={leases}
        currentLease={currentLease}
      />

      {/* The year's rent checks, set ahead of time. */}
      <RentScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        propertyId={propertyId}
        currentLease={scheduleLease}
        payments={withRenters && scheduleLease ? renterPayments(scheduleLease.id, activityPayments, running.length === 1) : activityPayments}
      />

      <PropertyRentPaymentDialog
        open={rentPaymentOpen}
        onOpenChange={setRentPaymentOpen}
        propertyId={propertyId}
        lease={rentPaymentLease}
        payments={
          withRenters && rentPaymentLease ? renterPayments(rentPaymentLease.id, activityPayments, running.length === 1) : activityPayments
        }
      />

      <AddReminderButton
        entityType="property"
        entityId={propertyId}
        label={address}
        hideTrigger
        open={reminderOpen}
        onOpenChange={setReminderOpen}
      />

      <ConfirmDialog
        open={deletePropertyOpen}
        onOpenChange={setDeletePropertyOpen}
        title="מחיקת הנכס"
        description={`למחוק את ${address}? אי אפשר למחוק נכס שיש לו חוזים, הכנסות, הוצאות או משימות.`}
        confirmLabel="מחיקה"
        destructive
        onConfirm={deleteThisProperty}
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
              <div className="text-sm font-medium">{leaseForm.period_months === "12" ? "סכום לשנה *" : "מחיר חודשי *"}</div>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              {/* What THIS tenant got — the apartment's full set is on the property
                  ("מספר מפתחות"), and the two are compared at move-out. */}
              <div className="text-sm font-medium">מפתחות שנמסרו לשוכר</div>
              <Input
                inputMode="numeric"
                value={leaseForm.keys_handed_over}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, keys_handed_over: e.target.value }))}
                placeholder={property.keyCount != null ? `בדירה יש ${property.keyCount}` : undefined}
              />
            </div>
          </div>
          {/* When it's paid (owner, 2026-10-20): on a day of the regular month or
              of the Hebrew month — "every א׳ … whatever the English date is,
              that's when it's due, the alert, everything" — monthly or yearly. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">תשלום לפי</div>
              <NativeSelect
                value={leaseForm.rent_calendar}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, rent_calendar: e.target.value }))}
              >
                <option value="gregorian">תאריך לועזי</option>
                <option value="hebrew">תאריך עברי</option>
              </NativeSelect>
            </div>
            {leaseForm.rent_calendar === "hebrew" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">יום בחודש העברי</div>
                <NativeSelect
                  value={leaseForm.rent_hebrew_day}
                  onChange={(e) => setLeaseForm((prev) => ({ ...prev, rent_hebrew_day: e.target.value }))}
                >
                  {HEBREW_DAYS.map((day) => (
                    <option key={day} value={String(day)}>
                      {hebrewDayName(day)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : (
              <div className="space-y-1">
                {/* Drives where rent lands on the payments board. Left empty it
                    falls back to the day the lease started. */}
                <div className="text-sm font-medium">יום תשלום בחודש</div>
                <Input
                  inputMode="numeric"
                  value={leaseForm.rent_day_of_month}
                  onChange={(e) => setLeaseForm((prev) => ({ ...prev, rent_day_of_month: e.target.value }))}
                  placeholder={leaseForm.start_date ? `כברירת מחדל: ${Number(leaseForm.start_date.slice(8, 10)) || 1}` : "1–31"}
                />
              </div>
            )}
            <div className="space-y-1">
              <div className="text-sm font-medium">תדירות</div>
              <NativeSelect
                value={leaseForm.period_months}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, period_months: e.target.value }))}
              >
                <option value="1">כל חודש</option>
                <option value="12">פעם בשנה</option>
              </NativeSelect>
            </div>
          </div>
          {/* A storage spot: which one, and how big. */}
          {property.propertyType === "storage" || leaseForm.unit_label || leaseForm.area_sqm ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">יחידה / תא</div>
                <Input
                  value={leaseForm.unit_label}
                  onChange={(e) => setLeaseForm((prev) => ({ ...prev, unit_label: e.target.value }))}
                  placeholder="תא 4"
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">שטח (מ״ר)</div>
                <Input
                  inputMode="decimal"
                  value={leaseForm.area_sqm}
                  onChange={(e) => setLeaseForm((prev) => ({ ...prev, area_sqm: e.target.value }))}
                />
              </div>
            </div>
          ) : null}
          <div className="space-y-1">
            <div className="text-sm font-medium">הערות</div>
            <div className="relative">
              <Textarea
                value={leaseForm.notes}
                onChange={(e) => setLeaseForm((prev) => ({ ...prev, notes: e.target.value }))}
                className="pe-11"
              />
              <DictateButton
                onTranscript={(text) =>
                  setLeaseForm((prev) => ({ ...prev, notes: appendDictatedText(prev.notes, text) }))
                }
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">מסמך חתום</div>
            {editLeaseId ? (
              leaseDoc.documentUrl ? (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 p-2 text-sm">
                  <DocumentLink
                    name={leaseDoc.documentFileName || "מסמך"}
                    fileName={leaseDoc.documentFileName}
                    url={leaseDoc.documentUrl}
                    className="text-primary hover:underline"
                  >
                    {leaseDoc.documentFileName || "מסמך"}
                  </DocumentLink>
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
                <span>{pendingLeaseDocFile.name}</span>
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
        description={del ? `למחוק "${del.label}"?` : ""}
        confirmLabel="מחיקה"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function RowMenu({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground" aria-label={label}>
          <MoreIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuItem onClick={onEdit}>עריכה</DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          מחיקה
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
