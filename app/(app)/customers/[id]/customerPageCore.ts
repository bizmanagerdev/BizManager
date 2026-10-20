import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { chunkStrings } from "@/lib/financial/utils";
import { toHebrewError } from "@/lib/error-messages";
import { getCustomerReceivables, type CustomerReceivable } from "@/lib/collections";
import type { CustomerActivity } from "@/lib/communications";
import type { PaymentPromise } from "@/lib/promises";
import { withLinkColumn } from "@/lib/customers/workerLink";
import { buildCounterpartyBalance, getCustomerLoanPositions, hasAnyPosition } from "@/lib/customers/counterpartyBalance";
import { pinFrom } from "@/lib/delivery-location";
import type { MorningLocalDocument } from "@/lib/morning/types";
import { addressNotFound, addressPoint } from "@/lib/address/columns";
import {
  buildOrderRows,
  buildProjectRows,
  comparePaymentsNewestFirst,
  lastClearedPaymentAt,
  num,
  str,
  summarizeCustomerMoney,
  type CustomerContactRow,
  type CustomerLeaseRow,
  type CustomerPageTop,
  type CustomerPaymentRow,
  type CustomerPaymentsResult,
  type CustomerTaskItem,
  type Row,
} from "@/app/(app)/customers/[id]/customerPageModel";

// A customer's page, split by where it can be read (2026-10-20): the CORE —
// the customer, its orders, projects, money, leases, contacts, tags, tasks,
// loans and every payment — reads only tables the phone's copy holds, so the
// same code runs on the server and on the device (the page drawn from the
// device, lib/powersync/dashboard-local.ts "customerPage"). What only the
// server reads — the call log, payment promises, Morning documents, a linked
// worker's pay owed, the documents and the history — is in loadCustomerPage.ts
// and joins the core on the page (mergeCustomerPage). Nothing here may import
// server-only code.
//
// Two rules for every list here: nothing is silently cut off at the database's
// 1000 rows (fetchAllPaged pages through), and an id list never goes out
// longer than 150 (a longer address is refused, and the failure used to go
// unnoticed — 2026-10-11).

const IN_BATCH = 150;

export const CUSTOMER_SELECT =
  "id,name,name_for_invoice,registration_number,email,phone,whatsapp,address,addr_place_id,addr_city,addr_street,addr_house_number,addr_lat,addr_lng,delivery_instructions,delivery_lat,delivery_lng,notes,active,requires_prepayment,morning_client_id,morning_synced_at,morning_match_status,morning_last_sync_error";

type Page = (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>;

export const paged = (page: Page) => fetchAllPaged<Row>(page);

/** One read per ≤150 ids, all at once, merged. */
export function inBatches(ids: string[], read: (batch: string[]) => Promise<Row[]>): Promise<Row[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return Promise.all(chunkStrings(ids, IN_BATCH).map(read)).then((parts) => parts.flat());
}

export function idsOf(rows: Row[], key: string) {
  return Array.from(new Set(rows.map((row) => str(row, key)).filter(Boolean)));
}

/** A read whose failure the page states (orders, projects) rather than hides. */
async function withError(rows: Promise<Row[]>): Promise<{ rows: Row[]; error: string | null }> {
  try {
    return { rows: await rows, error: null };
  } catch (error) {
    return { rows: [], error: toHebrewError(error, "הטעינה נכשלה.") };
  }
}

const NO_LOANS = { owedToUs: 0, owedByUs: 0 };

/** The page's core: all of the top but what only the server reads, and what the balance is made of. */
export type CustomerPageCore = Omit<CustomerPageTop, "balance" | "morningDocuments" | "collection" | "promises"> & {
  /** Term-aware days-late — the money card's and the גבייה panel's. */
  receivables: CustomerReceivable[];
  /** Open loans with this customer (admin/office). */
  loans: { owedToUs: number; owedByUs: number };
  /** The viewer is admin or office: the management parts are read and shown. */
  manages: boolean;
};

/** What only the server reads for the top of the page (loadCustomerPage.ts). */
export type CustomerServerParts = {
  morningDocuments: MorningLocalDocument[];
  /** The call log and reminders the גבייה section opens with. */
  activity: CustomerActivity;
  promises: PaymentPromise[];
  /** A linked worker's pay owed (worker_balance_summary_view) — null when not linked, or not staff. */
  payrollOwed: number | null;
};

export const NO_SERVER_PARTS: CustomerServerParts = {
  morningDocuments: [],
  activity: { logs: [], reminders: [] },
  promises: [],
  payrollOwed: null,
};

/** The page's top from its core and the server's parts (none yet: the device's core alone). */
export function mergeCustomerPage(core: CustomerPageCore, server: CustomerServerParts | null): CustomerPageTop {
  const parts = server ?? NO_SERVER_PARTS;
  const { receivables, loans, manages, ...rest } = core;
  // מאזן מול העסק. Salary is reported beside the net, never inside it — it
  // accrues daily and clears on payday, so netting it would make the figure
  // mean something different depending on where in the month you look.
  const counterparty = buildCounterpartyBalance({
    salesOwedToUs: core.money.openBalance,
    loansOwedToUs: loans.owedToUs,
    loansOwedByUs: loans.owedByUs,
    payrollOwed: core.linkedWorker ? parts.payrollOwed ?? 0 : null,
  });
  return {
    ...rest,
    balance: manages && hasAnyPosition(counterparty) ? counterparty : null,
    morningDocuments: parts.morningDocuments,
    collection: { logs: parts.activity.logs, reminders: parts.activity.reminders, receivables },
    promises: parts.promises,
  };
}

/**
 * The core's reads, each started the moment what it needs is in. `core` is
 * null when the customer isn't there. `payments` (every order, project and
 * rent payment, merged newest first) and the order / project ids follow.
 */
export function startCustomerCoreReads(
  supabase: SupabaseClient,
  id: string,
  viewer: {
    /** The viewer's role, once the "who's asking" check has it. */
    role: Promise<string>;
    viewerId: Promise<string>;
  }
) {
  // admin/office: the management parts (tasks, loans).
  const canManage = viewer.role.then((role) => role === "admin" || role === "office");

  const customer = withLinkColumn<Row>(CUSTOMER_SELECT, (select) =>
    supabase.from("customers").select(select).eq("id", id).maybeSingle()
  ).then((result) => result.data);

  // Per-order money comes from order_overview_view so the numbers here always
  // match the orders list (incl. the items-derived fallback for ₪0 orders).
  const orders = withError(
    paged((from, to) =>
      supabase
        .from("order_overview_view")
        .select(
          "order_id,order_date,status,total_amount,collected_amount,pending_amount,overdue_amount,remaining_balance,payment_count,next_due_date"
        )
        .eq("customer_id", id)
        .order("order_date", { ascending: false })
        .order("order_id", { ascending: false })
        .range(from, to)
    )
  );
  const projects = withError(
    paged((from, to) =>
      supabase
        .from("projects")
        .select("id,customer_id,name,status,start_date,end_date,agreed_base_price,actual_price,price_includes_vat,vat_rate")
        .eq("customer_id", id)
        .order("start_date", { ascending: false, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to)
    )
  );
  const orderIds = orders.then((result) => idsOf(result.rows, "order_id"));
  const projectIds = projects.then((result) => idsOf(result.rows, "id"));

  const projectFinancials = projectIds
    .then((ids) =>
      inBatches(ids, (batch) =>
        paged((from, to) =>
          supabase
            .from("project_financials_view")
            .select("id,customer_total_price,expenses_billed")
            .in("id", batch)
            .order("id", { ascending: true })
            .range(from, to)
        )
      )
    )
    .catch(() => [] as Row[]);
  const projectPayments = projectIds
    .then((ids) =>
      inBatches(ids, (batch) =>
        paged((from, to) =>
          supabase
            .from("payments")
            .select("id,project_id,amount_total,net_amount,payment_date,payment_method,payment_status,due_date,check_number,created_at")
            .in("project_id", batch)
            .order("payment_date", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
        )
      )
    )
    .catch(() => [] as Row[]);

  // A tenant is a customer like any other — this is their lease history.
  const leases = paged((from, to) =>
    supabase
      .from("lease_agreements")
      .select("id,property_id,start_date,end_date,monthly_rent_amount,status,deposit_type,deposit_amount,property:properties(id,name,address)")
      .eq("customer_id", id)
      .order("start_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to)
  )
    .then((rows) => rows.map(toLease))
    .catch(() => [] as CustomerLeaseRow[]);

  // Term-aware days-late for the money card — the same source the גבייה panel
  // uses, so the two never disagree. Handed to the panel as its first data.
  const receivables = getCustomerReceivables(supabase, id).catch(() => [] as CustomerReceivable[]);

  const contacts = paged((from, to) =>
    supabase
      .from("contacts")
      .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes")
      .eq("customer_id", id)
      .order("is_primary", { ascending: false })
      .order("full_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  ).catch(() => [] as Row[]);
  const branches = paged((from, to) =>
    supabase
      .from("customer_branches")
      .select("id,customer_id,name,address,phone,active,addr_city,addr_street,addr_house_number,addr_lat,addr_lng")
      .eq("customer_id", id)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  ).catch(() => [] as Row[]);
  const tagLinks = Promise.resolve(
    supabase.from("entity_tags").select("tag:tags(id,name,color)").eq("entity_type", "customer").eq("entity_id", id)
  )
    .then((result) => (result.data ?? []) as Row[])
    .catch(() => [] as Row[]);

  // Loans are read for ANY customer: a lender doesn't have to be a worker.
  const loans = canManage
    .then((ok) => (ok ? getCustomerLoanPositions(supabase, id) : NO_LOANS))
    .catch(() => NO_LOANS);
  const linkedUserId = customer.then((row) => str(row, "linked_user_id") || null).catch(() => null);
  // The linked worker's name (the payroll half of the balance is the server's).
  const linkedUser = Promise.all([linkedUserId, canManage])
    .then(([userId, ok]) =>
      userId && ok
        ? Promise.resolve(supabase.from("users").select("id,full_name,email").eq("id", userId).maybeSingle()).then(
            (result) => (result.data ?? null) as Row | null
          )
        : null
    )
    .catch(() => null);

  // This customer's tasks (independent customer_id link), whether each has an
  // open reminder, and the staff for the "add task" dialog.
  const tasks = canManage
    .then((ok) =>
      ok
        ? paged((from, to) =>
            supabase
              .from("tasks")
              .select("id,subject,status,priority,due_date,assigned_user_id,is_private,private_owner_id")
              .eq("customer_id", id)
              .neq("status", "cancelled")
              .order("due_date", { ascending: true, nullsFirst: false })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : []
    )
    .catch(() => [] as Row[]);
  const taskReminders = tasks
    .then((rows) =>
      inBatches(idsOf(rows, "id"), (batch) =>
        paged((from, to) =>
          supabase
            .from("reminders")
            .select("id,task_id")
            .in("task_id", batch)
            .eq("status", "pending")
            .order("id", { ascending: true })
            .range(from, to)
        )
      )
    )
    .catch(() => [] as Row[]);
  const users = canManage
    .then((ok) =>
      ok
        ? paged((from, to) =>
            supabase
              .from("users")
              .select("id,full_name,email,avatar_color,active")
              .neq("role", "worker_no_access")
              .order("full_name", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to)
          )
        : []
    )
    .catch(() => [] as Row[]);

  const core: Promise<CustomerPageCore | null> = Promise.all([
    customer,
    orders,
    projects,
    projectFinancials,
    projectPayments,
    leases,
    receivables,
    contacts,
    branches,
    tagLinks,
    loans,
    linkedUser,
    tasks,
    taskReminders,
    users,
    canManage,
    viewer.viewerId,
  ]).then(
    ([
      customerRow,
      orderResult,
      projectResult,
      financialRows,
      projectPaymentRows,
      leaseRows,
      receivableRows,
      contactRows,
      branchRows,
      tagRows,
      loanPositions,
      linkedUserRow,
      taskRows,
      taskReminderRows,
      userRows,
      manages,
      viewerId,
    ]) => {
      if (!customerRow) return null;

      const orderRows = buildOrderRows(orderResult.rows);
      const projectRows = buildProjectRows(projectResult.rows, financialRows, projectPaymentRows);
      const money = summarizeCustomerMoney({ orders: orderRows, projects: projectRows, receivables: receivableRows });
      const linkedUserIdValue = str(customerRow, "linked_user_id");

      return {
        customer: {
          id,
          name: str(customerRow, "name") || str(customerRow, "name_for_invoice") || "לקוח",
          invoiceName: str(customerRow, "name_for_invoice") || null,
          registrationNumber: str(customerRow, "registration_number") || null,
          phone: str(customerRow, "phone") || null,
          whatsapp: str(customerRow, "whatsapp") || null,
          email: str(customerRow, "email") || null,
          address: str(customerRow, "address") || null,
          deliveryInstructions: str(customerRow, "delivery_instructions") || null,
          deliveryPin: pinFrom(customerRow.delivery_lat, customerRow.delivery_lng),
          addressNotFound: addressNotFound(customerRow as Record<string, unknown>),
          addressPoint: addressPoint(customerRow as Record<string, unknown>),
          notes: str(customerRow, "notes") || null,
          active: customerRow.active !== false,
          requiresPrepayment: customerRow.requires_prepayment === true,
          linkedUserId: linkedUserIdValue || null,
          morningClientId: str(customerRow, "morning_client_id") || null,
          morningMatchStatus: str(customerRow, "morning_match_status") || null,
          morningSyncedAt: str(customerRow, "morning_synced_at") || null,
          morningLastSyncError: str(customerRow, "morning_last_sync_error") || null,
        },
        orders: orderRows,
        projects: projectRows,
        leases: leaseRows,
        money,
        linkedWorker:
          linkedUserRow && linkedUserIdValue
            ? { id: linkedUserIdValue, name: str(linkedUserRow, "full_name") || str(linkedUserRow, "email") || "עובד" }
            : null,
        contacts: contactRows.map(toContact),
        branches: branchRows
          .filter((branch) => branch.active !== false)
          .map((branch) => ({
            id: str(branch, "id"),
            name: str(branch, "name"),
            address: str(branch, "address") || null,
            phone: str(branch, "phone") || null,
            point: addressPoint(branch),
          })),
        tags: tagRows
          .map((link) => (link as { tag?: { id?: string; name?: string; color?: string | null } }).tag)
          .filter((tag): tag is { id: string; name: string; color?: string | null } => Boolean(tag && tag.id && tag.name))
          .sort((a, b) => a.name.localeCompare(b.name, "he") || a.id.localeCompare(b.id)),
        tasks: toTasks(taskRows, taskReminderRows, userRows, viewerId),
        taskUsers: userRows
          .filter((user) => user.active !== false)
          .map((user) => ({
            id: str(user, "id"),
            label: str(user, "full_name") || str(user, "email"),
            color: str(user, "avatar_color") || null,
          }))
          .filter((user) => user.id && user.label),
        errors: { orders: orderResult.error, projects: projectResult.error },
        receivables: receivableRows,
        loans: { owedToUs: loanPositions.owedToUs, owedByUs: loanPositions.owedByUs },
        manages,
      } satisfies CustomerPageCore;
    }
  );

  // ── after the page ──

  const orderPayments = orderIds.then((ids) =>
    inBatches(ids, (batch) =>
      paged((from, to) =>
        supabase
          .from("payments")
          .select("id,order_id,amount_total,payment_date,payment_method,payment_status,due_date,check_number,created_at")
          .in("order_id", batch)
          .order("payment_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
      )
    )
  );
  const propertyPayments = leases.then((rows) =>
    inBatches(
      Array.from(new Set(rows.map((lease) => lease.propertyId).filter(Boolean))),
      (batch) =>
        paged((from, to) =>
          supabase
            .from("payments")
            .select("id,property_id,amount_total,payment_date,payment_method,payment_status,due_date,check_number,created_at")
            .in("property_id", batch)
            .order("payment_date", { ascending: false })
            .order("id", { ascending: false })
            .range(from, to)
        )
    )
  );

  // Orders + projects + property rent, merged, newest first — every one, so the
  // section's count is the real one (it read the newest 60 order payments and
  // counted those).
  const payments: Promise<CustomerPaymentsResult> = Promise.all([
    orderPayments,
    projectPayments,
    propertyPayments,
    projects,
    leases,
  ])
    .then(([orderRows, projectRows, propertyRows, projectResult, leaseRows]) => {
      const projectNameById = new Map(projectResult.rows.map((row) => [str(row, "id"), str(row, "name") || "פרויקט"]));
      const propertyNameById = new Map(leaseRows.map((lease) => [lease.propertyId, lease.label]));
      const all = [...orderRows, ...projectRows, ...propertyRows].map((row): CustomerPaymentRow => {
        const orderId = str(row, "order_id");
        const projectId = str(row, "project_id");
        const propertyId = str(row, "property_id");
        return {
          id: str(row, "id"),
          date: str(row, "payment_date") || null,
          method: str(row, "payment_method") || null,
          status: (str(row, "payment_status") || "cleared").toLowerCase(),
          dueDate: str(row, "due_date") || null,
          checkNumber: str(row, "check_number") || null,
          createdAt: str(row, "created_at") || null,
          amount: num(row.amount_total),
          source: orderId
            ? { type: "order", id: orderId, label: "" }
            : projectId
              ? { type: "project", id: projectId, label: projectNameById.get(projectId) ?? "פרויקט" }
              : propertyId
                ? { type: "property", id: propertyId, label: propertyNameById.get(propertyId) ?? "נכס" }
                : null,
        };
      });
      all.sort(comparePaymentsNewestFirst);
      return { payments: all, lastPaymentAt: lastClearedPaymentAt(all), error: null };
    })
    .catch((error) => ({ payments: [], lastPaymentAt: null, error: toHebrewError(error, "טעינת התשלומים נכשלה.") }));

  return { core, payments, orderIds, projectIds, linkedUserId, canManage };
}

function toLease(row: Row): CustomerLeaseRow {
  const property = (Array.isArray(row.property) ? row.property[0] : row.property) as Row | undefined;
  return {
    id: str(row, "id"),
    propertyId: str(row, "property_id"),
    label: (property && (str(property, "name") || str(property, "address"))) || "נכס",
    status: str(row, "status"),
    startDate: str(row, "start_date") || null,
    endDate: str(row, "end_date") || null,
    monthlyRentAmount: num(row.monthly_rent_amount),
    depositType: str(row, "deposit_type") || null,
    depositAmount: row.deposit_amount == null ? null : num(row.deposit_amount),
  };
}

function toContact(row: Row): CustomerContactRow {
  return {
    id: str(row, "id"),
    fullName: str(row, "full_name"),
    role: str(row, "role") || null,
    phone: str(row, "phone") || null,
    email: str(row, "email") || null,
    whatsapp: str(row, "whatsapp") || null,
    isPrimary: row.is_primary === true,
    active: row.active !== false,
    notes: str(row, "notes") || null,
  };
}

function toTasks(taskRows: Row[], reminderRows: Row[], userRows: Row[], viewerId: string): CustomerTaskItem[] {
  const reminderTaskIds = new Set(reminderRows.map((row) => str(row, "task_id")).filter(Boolean));
  const userNameById = new Map(userRows.map((user) => [str(user, "id"), str(user, "full_name") || str(user, "email")]));
  return (
    taskRows
      // Private tasks are visible only to their owner (RLS also enforces this).
      .filter((task) => task.is_private !== true || str(task, "private_owner_id") === viewerId)
      .map((task) => {
        const assigneeId = str(task, "assigned_user_id");
        return {
          id: str(task, "id"),
          subject: str(task, "subject") || "משימה",
          status: str(task, "status") || null,
          priority: str(task, "priority") || null,
          due_date: str(task, "due_date") || null,
          assigned_user_name: assigneeId ? userNameById.get(assigneeId) || null : null,
          has_open_reminder: reminderTaskIds.has(str(task, "id")),
          is_private: task.is_private === true,
        };
      })
  );
}
