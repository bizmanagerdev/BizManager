"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import ProjectDetailsActions, { REMINDERS_SECTION_ID } from "@/app/(app)/projects/[id]/ProjectDetailsActions";
import EntityActivityTimeline from "@/app/(app)/activity/EntityActivityTimeline";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import ProjectMobileHeader from "@/app/(app)/projects/[id]/ProjectMobileHeader";
import ProjectPageHeading, { projectTypeLabel } from "@/app/(app)/projects/[id]/ProjectPageHeading";
import ProjectRemindersSection from "@/app/(app)/projects/[id]/ProjectRemindersSection";
import type { ProjectShareData } from "@/app/(app)/projects/[id]/ProjectShareActions";
import { ArrowLeftIcon, ClipboardIcon, DeliveryIcon, HistoryIcon, HomeIcon, LocationIcon, NoteIcon } from "@/components/ui/icons";
import { AddressLink } from "@/components/ui/address-link";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { ProjectStatusPicker } from "@/components/projects/ProjectStatusPicker";
import { ItemsToMoveList } from "@/components/projects/ItemsToMoveList";
import type {
  AssignableUser,
  ExpenseListItem,
  ProjectFinancials,
  ProjectOverview,
  ProjectSalaryAgreement,
  ProjectTaskProgress,
  ProjectWorkerBalance,
} from "@/app/(app)/projects/[id]/ProjectTabsClient";
import { formatMovingEndpoint } from "@/lib/projects/movingAddress";
import { splitPaymentAmounts } from "@/lib/orders/paymentStatus";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import type { FinancialAttachment, PaymentRow } from "@/lib/payments";
import type { WorkSessionRow } from "@/lib/payroll";
import type { LedgerPrefs } from "@/lib/projectLedgerPrefs";
import { CustomerContactCard } from "@/components/customers/CustomerContactCard";
import { formatShortDate } from "@/lib/date";
import type { ProjectPageCore } from "@/lib/projects/project-page";
import type { ProjectPageExtras } from "@/app/(app)/projects/[id]/loadProjectPageExtras";
import { useSettled } from "@/hooks/useSettled";

// A project's page, from what was read for it: the project itself
// (lib/projects/project-page.ts) and the parts only the server reads
// (loadProjectPageExtras.ts — `extras`, null while they're on their way: the
// documents and history hold their place, and the rows' attachments, Morning
// documents and "entered by" lines fill in when they arrive).

function ProjectTabsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid h-14 grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-2xl border bg-card/95" />
        ))}
      </div>
      <div className="animate-pulse space-y-3">
        <div className="h-40 rounded-xl border bg-muted/40" />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="h-80 rounded-xl border bg-muted/40" />
          <div className="h-80 rounded-xl border bg-muted/40" />
        </div>
      </div>
    </div>
  );
}

const ProjectTabsClient = dynamic(() => import("@/app/(app)/projects/[id]/ProjectTabsClient"), {
  loading: () => <ProjectTabsSkeleton />,
});

type Row = Record<string, unknown>;

function getFirstString(obj: Row | null | undefined, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDate(value: string | null | undefined) {
  return formatShortDate(value, "—");
}

// A job that starts and ends on the same day reads as one date, not the same
// date printed twice with a dash between.
function formatDateRange(start: string | null | undefined, end: string | null | undefined) {
  const startText = start ? formatDate(start) : null;
  const endText = end ? formatDate(end) : null;
  if (startText && endText) {
    return startText === endText ? startText : `${startText} – ${endText}`;
  }
  return startText ?? endText ?? null;
}

const cleanField = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const NO_ATTACHMENTS: ProjectPageExtras["attachments"] = { expense: {}, session: {}, payment: {} };
const NO_AUDIT: ProjectPageExtras["expenseAudit"] = {};
const NO_DOCUMENTS: ProjectPageExtras["projectDocuments"] = [];
const NO_MORNING_DOCUMENTS: ProjectPageExtras["morningDocuments"] = [];

export default function ProjectPageView({
  id,
  core,
  extras,
  viewer,
}: {
  id: string;
  core: ProjectPageCore;
  /** The server-only parts; null while they're on their way. */
  extras: ProjectPageExtras | null;
  viewer: { role: string; ledgerPrefs: LedgerPrefs };
}) {
  const { dashboardRow, details } = core;
  const attachments = extras?.attachments ?? NO_ATTACHMENTS;

  // The overview, the money totals and the task counts — the three shapes
  // the page used — from the one dashboard row, with the projects row's own
  // fields on the overview.
  const { overview, financials, tasks } = useMemo(() => {
    if (!dashboardRow) return { overview: null, financials: null, tasks: null };
    const d = dashboardRow;
    const overview = {
      id: d.id,
      name: d.name,
      status: d.status,
      project_type: d.project_type,
      start_date: d.start_date,
      end_date: d.end_date,
      agreed_base_price: d.agreed_base_price,
      actual_price: d.actual_price,
      expenses_billed_separately: d.expenses_billed_separately,
      customer_id: d.customer_id,
      customer_name: d.customer_name,
      project_manager_id: d.project_manager_id,
      project_manager_name: d.project_manager_name,
      created_at: d.created_at,
      updated_at: d.updated_at,
      notes: typeof details?.notes === "string" ? details.notes : null,
      items_to_move: Array.isArray(details?.items_to_move)
        ? details.items_to_move.filter((item): item is string => typeof item === "string")
        : null,
      origin_address: typeof details?.origin_address === "string" ? details.origin_address : null,
      origin_floor: typeof details?.origin_floor === "string" ? details.origin_floor : null,
      origin_has_elevator: typeof details?.origin_has_elevator === "boolean" ? details.origin_has_elevator : null,
      destination_address: typeof details?.destination_address === "string" ? details.destination_address : null,
      destination_floor: typeof details?.destination_floor === "string" ? details.destination_floor : null,
      destination_has_elevator:
        typeof details?.destination_has_elevator === "boolean" ? details.destination_has_elevator : null,
      price_includes_vat: details?.price_includes_vat === true,
      no_charge: details?.no_charge === true,
      // Not shown in the edit form, but sent back with it (the update route
      // takes the whole record — without them it cleared them).
      branch_id: typeof details?.branch_id === "string" ? details.branch_id : null,
      payment_terms: typeof details?.payment_terms === "string" ? details.payment_terms : null,
      due_date: typeof details?.due_date === "string" ? details.due_date.slice(0, 10) : null,
      vat_rate:
        typeof details?.vat_rate === "number"
          ? details.vat_rate
          : typeof details?.vat_rate === "string"
            ? Number(details.vat_rate)
            : null,
    } as ProjectOverview;
    const financials = {
      id: d.id,
      agreed_base_price: d.agreed_base_price,
      actual_price: d.actual_price,
      total_expenses: d.total_expenses,
      expenses_billed: d.expenses_billed,
      customer_total_price: d.customer_total_price,
      gross_profit: d.gross_profit,
    } as ProjectFinancials;
    const tasks = {
      project_id: d.id,
      total_tasks: d.total_tasks,
      completed_tasks: d.completed_tasks,
      open_tasks: d.open_tasks,
    } as ProjectTaskProgress;
    return { overview, financials, tasks };
  }, [dashboardRow, details]);

  // The expenses (with their files) and the worker shifts (with what's been
  // paid on each, and their files), newest first.
  const combinedExpenseList = useMemo<ExpenseListItem[]>(() => {
    const expensesById = new Map<string, Row>();
    for (const expense of core.expenses) {
      if (typeof expense.id !== "string") continue;
      const files = attachments.expense[expense.id];
      expensesById.set(expense.id, files ? { ...expense, attachments: files } : expense);
    }
    const expenseList = core.projectExpenses.map(
      (pe): ExpenseListItem => ({
        source_type: "expense",
        project_expense: pe,
        expense: typeof pe.expense_id === "string" ? expensesById.get(pe.expense_id) ?? null : null,
        session: null,
      })
    );
    const sessionList = (core.attendanceSessions as WorkSessionRow[]).map((session): ExpenseListItem => {
      const effective = core.sessionDebtById[session.id] ?? null;
      const paidAmount = effective?.paid_amount;
      const owedAmount = effective?.owed_amount;
      return {
        source_type: "session",
        project_expense: null,
        expense: null,
        session: {
          ...session,
          paid_amount: typeof paidAmount === "number" || typeof paidAmount === "string" ? paidAmount : null,
          owed_amount: typeof owedAmount === "number" || typeof owedAmount === "string" ? owedAmount : null,
          payment_status: typeof effective?.payment_status === "string" ? effective.payment_status : null,
          last_payment_date: typeof effective?.last_payment_date === "string" ? effective.last_payment_date : null,
          // Only meaningful when payment_status is "not_due" (covered by a
          // payslip that isn't due yet) — lets the status badge say WHEN.
          due_date: typeof effective?.due_date === "string" ? effective.due_date : null,
          attachments: attachments.session[session.id] ?? [],
        },
      };
    });
    return [...expenseList, ...sessionList].sort((a, b) => {
      const ad =
        a.source_type === "session" ? a.session?.clock_in : ((a.expense?.expense_date ?? a.expense?.created_at) as string | undefined);
      const bd =
        b.source_type === "session" ? b.session?.clock_in : ((b.expense?.expense_date ?? b.expense?.created_at) as string | undefined);
      const at = ad ? new Date(ad).getTime() : 0;
      const bt = bd ? new Date(bd).getTime() : 0;
      return bt - at;
    });
  }, [core.expenses, core.projectExpenses, core.attendanceSessions, core.sessionDebtById, attachments]);

  const paymentsWithPhotos = useMemo(
    () =>
      core.payments.map((payment) => {
        const files = typeof payment.id === "string" ? attachments.payment[payment.id] : undefined;
        return (files ? { ...payment, attachments: files as FinancialAttachment[] } : payment) as PaymentRow;
      }),
    [core.payments, attachments]
  );

  const customerOptions = useMemo(
    () =>
      core.customers
        .map((row) => ({
          id: typeof row.id === "string" ? row.id : "",
          label: cleanField(getFirstString(row, ["name"])) ?? cleanField(getFirstString(row, ["name_for_invoice"])) ?? "לקוח",
        }))
        .filter((row) => row.id && row.label),
    [core.customers]
  );
  const managerOptions = useMemo(
    () =>
      core.assignableUsers
        .map((row) => {
          const fullName = typeof row.full_name === "string" ? row.full_name.trim() : "";
          const email = typeof row.email === "string" ? row.email.trim() : "";
          return { id: typeof row.id === "string" ? row.id : "", label: fullName || email, active: row.active };
        })
        .filter((row) => row.id && row.label && row.active !== false)
        .map((row) => ({ id: row.id, label: row.label })),
    [core.assignableUsers]
  );

  const projectDocuments = extras?.projectDocuments ?? NO_DOCUMENTS;
  const projectDocumentsError = extras?.projectDocumentsError ?? null;

  const overviewCustomerId = typeof overview?.customer_id === "string" ? overview.customer_id : null;
  const { customerRow, branchRow } = core;
  const status = typeof overview?.status === "string" ? overview.status : "";
  const projectName = typeof overview?.name === "string" ? overview.name : "פרויקט";
  const customerName = typeof overview?.customer_name === "string" ? overview.customer_name : "";
  const customerBranchName = cleanField(branchRow?.name);
  const customerPhone = cleanField(branchRow?.phone) ?? cleanField(customerRow?.phone);
  const customerWhatsapp = customerPhone;
  const customerEmail = cleanField(customerRow?.email);
  const customerAddress = cleanField(branchRow?.address) ?? cleanField(customerRow?.address);
  const customerInvoiceName = cleanField(customerRow?.name_for_invoice);
  const projectNotes = typeof overview?.notes === "string" && overview.notes.trim() ? overview.notes.trim() : null;
  const startDate = typeof overview?.start_date === "string" ? overview.start_date : null;
  const endDate = typeof overview?.end_date === "string" ? overview.end_date : null;
  const projectManagerName =
    typeof overview?.project_manager_name === "string" && overview.project_manager_name.trim()
      ? overview.project_manager_name.trim()
      : null;
  const projectType = typeof overview?.project_type === "string" ? overview.project_type : null;
  const itemsToMove = Array.isArray(overview?.items_to_move) ? overview.items_to_move : [];
  const moveOrigin = formatMovingEndpoint({
    address: overview?.origin_address ?? null,
    floor: overview?.origin_floor ?? null,
    hasElevator: overview?.origin_has_elevator ?? null,
  });
  const moveDestination = formatMovingEndpoint({
    address: overview?.destination_address ?? null,
    floor: overview?.destination_floor ?? null,
    hasElevator: overview?.destination_has_elevator ?? null,
  });
  const projectDueDate = typeof details?.due_date === "string" ? details.due_date.slice(0, 10) : null;
  const projectPaymentTerms = typeof details?.payment_terms === "string" ? details.payment_terms : null;

  // The customer, as a card at the top of the page body — name, how to reach
  // them, and a way through to the customer's own page.
  const customerSideCard = (
    <CustomerContactCard
      customerId={overviewCustomerId}
      name={customerName || "ללא לקוח משויך"}
      invoiceName={customerInvoiceName}
      branchName={customerBranchName}
      phone={customerPhone}
      whatsapp={customerWhatsapp}
      email={customerEmail}
      address={customerAddress}
      entityType="project"
      entityId={id}
    />
  );

  // The job itself, as the third card of the head row: where it goes, what's
  // being moved, and anything written down about it. Renders only when there IS
  // something to say — otherwise the head row is just לקוח + תשלום.
  const hasRoute = projectType === "moving" && Boolean(moveOrigin || moveDestination);
  const hasItems = projectType === "moving" && itemsToMove.length > 0;
  // Desktop headline: the route on one line, from → to, each behind its own glyph.
  const routeHeadline = hasRoute ? (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-2 text-base font-bold leading-snug">
      {moveOrigin ? (
        <AddressLink address={moveOrigin} className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
            <HomeIcon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">{moveOrigin}</span>
        </AddressLink>
      ) : null}
      {moveOrigin && moveDestination ? <ArrowLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden /> : null}
      {moveDestination ? (
        <AddressLink address={moveDestination} className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground">
            <LocationIcon className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">{moveDestination}</span>
        </AddressLink>
      ) : null}
    </span>
  ) : null;

  // A project with no route and no load has nothing to put in this card except
  // what someone wrote about it. Then the note IS the card.
  const notesOnlyCard = !hasRoute && !hasItems && Boolean(projectNotes);

  // A שיפוצים / לוגיסטיקה project has no route or load to show: the third
  // head-row slot says where the job stands, when it runs, and how far the work has got.
  const taskTotal = Number(tasks?.total_tasks ?? 0) || 0;
  const taskDone = Number(tasks?.completed_tasks ?? 0) || 0;
  const taskPercent = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : null;
  const projectStatusCard = (
    <StatActionCard
      icon={<ClipboardIcon className="h-5 w-5" />}
      label="סטטוס הפרויקט"
      value={<ProjectStatusPicker projectId={id} status={status} canEdit={viewer.role === "admin" || viewer.role === "office"} />}
      details={[
        {
          label: "תאריכים",
          value:
            startDate || endDate ? (
              <span dir="ltr">
                {formatDate(startDate)}
                {endDate && endDate !== startDate ? ` – ${formatDate(endDate)}` : ""}
              </span>
            ) : (
              "—"
            ),
        },
        { label: "מנהל פרויקט", value: projectManagerName ?? "לא הוגדר" },
        {
          label: "משימות",
          value:
            taskTotal > 0 ? (
              <span>
                {taskDone}/{taskTotal}
                {taskPercent !== null ? ` · ${taskPercent}%` : ""}
              </span>
            ) : (
              "אין משימות"
            ),
        },
      ]}
    >
      {taskTotal > 0 && taskPercent !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success" style={{ width: `${taskPercent}%` }} />
        </div>
      ) : null}
    </StatActionCard>
  );

  const detailsSideCard =
    hasRoute || hasItems || projectNotes ? (
      <StatActionCard
        icon={notesOnlyCard ? <NoteIcon className="h-5 w-5" /> : <DeliveryIcon className="h-5 w-5" />}
        label={notesOnlyCard ? "הערות" : projectType === "moving" ? "הובלה" : "פרטי העבודה"}
        // Desktop: the route is the headline (one line, from → to). Phone: no
        // headline at all — the label already says "הובלה" and the route sits
        // right below as stacked rows. Notes-only cards put the note here.
        value={
          <span className="block">
            {notesOnlyCard ? (
              <span className="block whitespace-pre-wrap text-base font-bold leading-snug">{projectNotes}</span>
            ) : null}
            {routeHeadline ? <span className="hidden text-lg font-bold leading-snug lg:block">{routeHeadline}</span> : null}
            {!notesOnlyCard ? (
              <span className="block text-lg font-bold leading-snug lg:hidden">
                {hasItems ? `${itemsToMove.length} פריטים להעברה` : hasRoute ? "מסלול ההובלה" : "פרטי העבודה"}
              </span>
            ) : null}
          </span>
        }
      >
        <div className="space-y-3">
          {/* Phone keeps the stacked route rows; on desktop the route moved up into the headline. */}
          {hasRoute ? (
            <div className="space-y-2 lg:hidden">
              {moveOrigin ? (
                <AddressLink address={moveOrigin} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
                    <HomeIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.6875rem] text-muted-foreground">מוצא</span>
                    <span className="block font-medium">{moveOrigin}</span>
                  </span>
                </AddressLink>
              ) : null}
              {moveDestination ? (
                <AddressLink address={moveDestination} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground">
                    <LocationIcon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[0.6875rem] text-muted-foreground">יעד</span>
                    <span className="block font-medium">{moveDestination}</span>
                  </span>
                </AddressLink>
              ) : null}
            </div>
          ) : null}

          {hasItems ? (
            <div className={hasRoute ? "border-t border-border/50 pt-3 lg:border-t-0 lg:pt-0" : undefined}>
              <ItemsToMoveList items={itemsToMove} />
            </div>
          ) : null}

          {/* Skipped when the note is already the card's headline. */}
          {projectNotes && !notesOnlyCard ? (
            <div className="rounded-2xl bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">הערות: </span>
              <span className="whitespace-pre-wrap">{projectNotes}</span>
            </div>
          ) : null}
        </div>
      </StatActionCard>
    ) : null;

  // What שיתוף / הדפסה send out. Money only for the roles that may see it, and
  // "שולם" is collected money only — same rule as the collection card.
  const canSeeProjectMoney = viewer.role === "admin" || viewer.role === "office";
  const shareTotal =
    toNumber(financials?.customer_total_price) ?? toNumber(overview?.actual_price) ?? toNumber(overview?.agreed_base_price) ?? 0;
  const sharePaid = splitPaymentAmounts(
    core.payments.map((payment) => ({
      amount_total: toNumber(payment.amount_total) ?? 0,
      net_amount: toNumber(payment.net_amount),
      payment_status: typeof payment.payment_status === "string" ? payment.payment_status : null,
      due_date: typeof payment.due_date === "string" ? payment.due_date : null,
    }))
  ).collected;
  const customerDisplayName = customerBranchName ? `${customerName} · סניף ${customerBranchName}` : customerName;
  const projectShareData: ProjectShareData = {
    projectName,
    customerName: customerDisplayName || "ללא לקוח",
    customerPhone,
    statusLabel: status ? getProjectStatusLabel(status) : "",
    typeLabel: projectTypeLabel(projectType),
    dateRange: formatDateRange(startDate, endDate),
    managerName: projectManagerName,
    origin: projectType === "moving" ? moveOrigin : null,
    destination: projectType === "moving" ? moveDestination : null,
    itemsToMove,
    notes: projectNotes,
    money: canSeeProjectMoney ? { total: shareTotal, paid: sharePaid, balance: Math.max(shareTotal - sharePaid, 0) } : null,
  };

  const projectActivity = extras?.activity ?? [];

  return (
    // Phone: ONE vertical rhythm — 0.75rem between the header chips and the
    // first card, and between every card. Desktop keeps the roomier stack.
    <div className="space-y-3 md:space-y-5">
      {/* Phone: what the project is, when it runs and who to call. */}
      <ProjectMobileHeader
        status={status}
        typeLabel={projectTypeLabel(projectType)}
        startDateText={startDate ? formatDate(startDate) : null}
        endDateText={endDate ? formatDate(endDate) : null}
      />

      {/* Desktop heading, same shape as an order: where you are, what this
          is, and the handful of things you can do to it. */}
      <ProjectPageHeading
        customerId={overviewCustomerId}
        customerDisplayName={customerDisplayName}
        customerPhone={customerPhone}
        projectName={projectName}
        projectType={projectType}
        actions={
          overview ? (
            <ProjectDetailsActions
              project={overview}
              customerOptions={customerOptions}
              managerOptions={managerOptions}
              projectDocuments={projectDocuments}
              projectDocumentsError={projectDocumentsError}
              share={projectShareData}
            />
          ) : null
        }
      />

      {core.errors.overview ? (
        <div className="text-destructive text-sm">שגיאה בטעינת פרויקט: {core.errors.overview}</div>
      ) : !overview ? (
        <div className="text-sm text-muted-foreground">הפרויקט לא נמצא.</div>
      ) : (
        <ProjectTabsClient
          viewerRole={viewer.role}
          initialLedgerPrefs={viewer.ledgerPrefs}
          overview={overview}
          currentVatRate={core.currentVatRate}
          paymentTerms={projectPaymentTerms}
          dueDate={projectDueDate}
          financials={financials}
          tasks={tasks}
          projectTasks={core.projectTasks}
          projectDocuments={projectDocuments}
          projectDocumentsError={projectDocumentsError}
          documentsPending={extras === null}
          assignableUsers={core.assignableUsers as AssignableUser[]}
          expenses={combinedExpenseList}
          expenseRecordedByNameByValue={core.expenseRecordedByNameByValue}
          recurringTemplateNames={core.recurringTemplateNames}
          recurringTemplateAuthors={core.recurringTemplateAuthors}
          expenseAuditById={extras?.expenseAudit ?? NO_AUDIT}
          payments={paymentsWithPhotos}
          morningDocuments={extras?.morningDocuments ?? NO_MORNING_DOCUMENTS}
          morningDocumentsError={extras?.morningDocumentsError ?? null}
          paymentRecordedByNameByValue={core.paymentRecordedByNameByValue}
          paymentAuditById={extras?.paymentAudit ?? NO_AUDIT}
          workerBalance={(core.workerBalance ?? null) as ProjectWorkerBalance}
          owed={core.owed}
          salaryAgreements={core.salaryAgreements as ProjectSalaryAgreement[]}
          monthlySalaryItems={core.monthlySalaryItems}
          accountNameById={core.accountNameById}
          wageAccountIdsBySource={core.wageAccountIdsBySource}
          moneyError={core.errors.projectExpenses ?? core.errors.expenses ?? core.errors.sessions ?? core.errors.payments ?? null}
          customerCard={customerSideCard}
          detailsCard={detailsSideCard}
          statusCard={projectStatusCard}
          activitySection={
            viewer.role === "admin" ? (
              <CollapsibleSection
                defaultOpen
                title="היסטוריית פעילות"
                icon={<HistoryIcon className="h-4 w-4 text-primary" />}
                summary={
                  projectActivity.length > 0 ? <span className="text-muted-foreground">{projectActivity.length} רשומות</span> : null
                }
              >
                {extras ? (
                  <EntityActivityTimeline items={projectActivity} previewCount={5} />
                ) : (
                  <div className="h-20 animate-pulse rounded-xl bg-muted/40" aria-busy="true" />
                )}
              </CollapsibleSection>
            ) : null
          }
          remindersSection={
            viewer.role === "admin" || viewer.role === "office" ? (
              <ProjectRemindersSection
                id={REMINDERS_SECTION_ID}
                projectId={id}
                customerId={typeof overview.customer_id === "string" ? overview.customer_id : undefined}
                canManage
              />
            ) : null
          }
        />
      )}

      {/* Phone: the same actions, as the top bar's ⋮ menu. Renders nothing on
          the page itself — it only registers the menu (and keeps its dialogs mounted). */}
      {overview ? (
        <ProjectDetailsActions
          project={overview}
          customerOptions={customerOptions}
          managerOptions={managerOptions}
          projectDocuments={projectDocuments}
          projectDocumentsError={projectDocumentsError}
          share={projectShareData}
          layout="menu"
        />
      ) : null}
    </div>
  );
}

/** The page with its server-only parts filled in as they arrive (`extras`, sent after the page). */
export function ProjectPageStreamed({
  extras,
  ...props
}: Omit<Parameters<typeof ProjectPageView>[0], "extras"> & { extras: PromiseLike<ProjectPageExtras> | null }) {
  return <ProjectPageView {...props} extras={useSettled(extras, props.id)} />;
}
