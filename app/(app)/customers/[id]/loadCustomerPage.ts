import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { chunkStrings } from "@/lib/financial/utils";
import { toHebrewError } from "@/lib/error-messages";
import { getCustomerReceivables, type CustomerReceivable } from "@/lib/collections";
import { getCustomerActivity, type CustomerActivity } from "@/lib/communications";
import { getCustomerPromises, type PaymentPromise } from "@/lib/promises";
import { getEntityAuditTrail, type EntityAuditSource } from "@/lib/audit";
import { withLinkColumn } from "@/lib/customers/workerLink";
import {
  buildCounterpartyBalance,
  getCustomerLoanPositions,
  hasAnyPosition,
} from "@/lib/customers/counterpartyBalance";
import { pinFrom } from "@/lib/delivery-location";
import { STORAGE_BUCKET } from "@/lib/storage";
import type { MorningLocalDocument } from "@/lib/morning/types";
import { addressNotFound, addressPoint } from "@/lib/address/columns";
import {
  buildOrderRows,
  buildProjectRows,
  compareDocumentsNewestFirst,
  comparePaymentsNewestFirst,
  lastClearedPaymentAt,
  num,
  str,
  summarizeCustomerMoney,
  type CustomerContactRow,
  type CustomerDocumentItem,
  type CustomerDocumentsResult,
  type CustomerHistory,
  type CustomerLeaseRow,
  type CustomerPageTop,
  type CustomerPaymentRow,
  type CustomerPaymentsResult,
  type CustomerTaskItem,
  type Row,
} from "@/app/(app)/customers/[id]/customerPageModel";

// Every read a customer's page makes, started at once. Each goes out the moment
// what it needs is in — the order payments as soon as the orders are read, not
// after everything else — instead of the three waves the page used to wait
// through one after another.
//
// `top` is what the page waits for before it shows anything: the customer and
// its money, and beside them the light reads (contacts, tags, tasks, the call
// log, promises), which land in the same time and so give their sections their
// real open/closed state on the first paint. The heavy ones — every payment,
// the documents with their signed links, the history — are sent after the
// page, into sections that are folded until they arrive (`payments`,
// `documents`, `history`), so nothing moves when they do.
//
// Two rules for every list here: nothing is silently cut off at the database's
// 1000 rows (fetchAllPaged pages through), and an id list never goes out
// longer than 150 (a longer address is refused, and the failure used to go
// unnoticed — 2026-10-11).

const IN_BATCH = 150;
/** The documents the page lists (the rest are a link away) — only these get a signed link. */
export const DOCUMENTS_SHOWN = 10;

const CUSTOMER_SELECT =
  "id,name,name_for_invoice,registration_number,email,phone,whatsapp,address,addr_place_id,addr_city,addr_street,addr_house_number,addr_lat,addr_lng,delivery_instructions,delivery_lat,delivery_lng,notes,active,requires_prepayment,morning_client_id,morning_synced_at,morning_match_status,morning_last_sync_error";

type Page = (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>;

const paged = (page: Page) => fetchAllPaged<Row>(page);

/** One read per ≤150 ids, all at once, merged. */
function inBatches(ids: string[], read: (batch: string[]) => Promise<Row[]>): Promise<Row[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return Promise.all(chunkStrings(ids, IN_BATCH).map(read)).then((parts) => parts.flat());
}

function idsOf(rows: Row[], key: string) {
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

const NO_LOANS = { owedToUs: 0, owedByUs: 0, loans: [] };
const NO_ACTIVITY: CustomerActivity = { logs: [], reminders: [] };

export function startCustomerPageReads(
  supabase: SupabaseClient,
  id: string,
  viewer: {
    /** The viewer's role, once the "who's asking" check has it. */
    role: Promise<string>;
    viewerId: Promise<string>;
  }
) {
  // admin/office: the management parts (tasks, the call log, promises,
  // loans). The history is admin only, mirroring /activity access.
  const canManage = viewer.role.then((role) => role === "admin" || role === "office");
  const isAdmin = viewer.role.then((role) => role === "admin");

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
  const morningDocuments = paged((from, to) =>
    supabase
      .from("morning_documents")
      .select(
        "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
      )
      .eq("customer_id", id)
      .order("issued_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
  ).catch(() => [] as Row[]);

  // מאזן מול העסק — everything this person owes us and we owe them, gathered
  // from the three places it lives (orders/projects, loans, payroll). Loans are
  // read for ANY customer: a lender doesn't have to be a worker. The payroll
  // half only applies when the customer is linked to a users row.
  const loans = canManage
    .then((ok) => (ok ? getCustomerLoanPositions(supabase, id) : NO_LOANS))
    .catch(() => NO_LOANS);
  const workerSide = Promise.all([customer, canManage])
    .then(([row, ok]) => {
      const linkedUserId = str(row, "linked_user_id");
      if (!linkedUserId || !ok) return null;
      return Promise.all([
        supabase.from("users").select("id,full_name,email").eq("id", linkedUserId).maybeSingle(),
        supabase.from("worker_balance_summary_view").select("user_id,owed_amount").eq("user_id", linkedUserId).maybeSingle(),
      ]).then(([user, balance]) => ({ user: (user.data ?? null) as Row | null, owed: (balance.data ?? null) as Row | null }));
    })
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

  // The call log and reminders the גבייה section opens with (the panel used to
  // fetch them itself after the page, and the receivables a second time).
  const activity = canManage
    .then((ok) => (ok ? getCustomerActivity(supabase, id) : NO_ACTIVITY))
    .catch(() => NO_ACTIVITY);
  const promises = canManage
    .then((ok) => (ok ? getCustomerPromises(supabase, id) : []))
    .catch(() => [] as PaymentPromise[]);

  const top: Promise<CustomerPageTop | null> = Promise.all([
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
    morningDocuments,
    loans,
    workerSide,
    tasks,
    taskReminders,
    users,
    activity,
    promises,
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
      morningRows,
      loanPositions,
      worker,
      taskRows,
      taskReminderRows,
      userRows,
      activityResult,
      promiseRows,
      manages,
      viewerId,
    ]) => {
      if (!customerRow) return null;

      const orderRows = buildOrderRows(orderResult.rows);
      const projectRows = buildProjectRows(projectResult.rows, financialRows, projectPaymentRows);
      const money = summarizeCustomerMoney({ orders: orderRows, projects: projectRows, receivables: receivableRows });

      const linkedUserId = str(customerRow, "linked_user_id");
      const linkedWorker =
        worker?.user && linkedUserId
          ? { id: linkedUserId, name: str(worker.user, "full_name") || str(worker.user, "email") || "עובד" }
          : null;
      const counterparty = buildCounterpartyBalance({
        salesOwedToUs: money.openBalance,
        loansOwedToUs: loanPositions.owedToUs,
        loansOwedByUs: loanPositions.owedByUs,
        // Salary is reported beside the net, never inside it — it accrues daily
        // and clears on payday, so netting it would make the figure mean
        // something different depending on where in the month you look.
        payrollOwed: linkedWorker ? num(worker?.owed?.owed_amount) : null,
      });

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
          linkedUserId: linkedUserId || null,
          morningClientId: str(customerRow, "morning_client_id") || null,
          morningMatchStatus: str(customerRow, "morning_match_status") || null,
          morningSyncedAt: str(customerRow, "morning_synced_at") || null,
          morningLastSyncError: str(customerRow, "morning_last_sync_error") || null,
        },
        orders: orderRows,
        projects: projectRows,
        leases: leaseRows,
        money,
        balance: manages && hasAnyPosition(counterparty) ? counterparty : null,
        linkedWorker,
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
        morningDocuments: morningRows as unknown as MorningLocalDocument[],
        tasks: toTasks(taskRows, taskReminderRows, userRows, viewerId),
        taskUsers: userRows
          .filter((user) => user.active !== false)
          .map((user) => ({
            id: str(user, "id"),
            label: str(user, "full_name") || str(user, "email"),
            color: str(user, "avatar_color") || null,
          }))
          .filter((user) => user.id && user.label),
        collection: { logs: activityResult.logs, reminders: activityResult.reminders, receivables: receivableRows },
        promises: promiseRows,
        errors: { orders: orderResult.error, projects: projectResult.error },
      };
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

  // Documents linked to the customer directly or through its orders/projects.
  // The order/project link is the one shown as the source when a document
  // carries both.
  const documents: Promise<CustomerDocumentsResult> = Promise.all([
    paged((from, to) =>
      supabase
        .from("document_links")
        .select("document_id,entity_type,entity_id")
        .eq("entity_type", "customer")
        .eq("entity_id", id)
        .order("document_id", { ascending: true })
        .range(from, to)
    ),
    orderIds.then((ids) => documentLinks(supabase, "order", ids)),
    projectIds.then((ids) => documentLinks(supabase, "project", ids)),
  ])
    .then(async ([customerLinks, orderLinks, projectLinks]) => {
      const linkByDocumentId = new Map<string, Row>();
      for (const link of [...customerLinks, ...orderLinks, ...projectLinks]) {
        const documentId = str(link, "document_id");
        if (!documentId) continue;
        const existing = linkByDocumentId.get(documentId);
        if (!existing || str(existing, "entity_type") === "customer") linkByDocumentId.set(documentId, link);
      }
      const rows = await inBatches(Array.from(linkByDocumentId.keys()), (batch) =>
        paged((from, to) =>
          supabase
            .from("documents")
            .select("id,document_type,title,file_name,storage_key,uploaded_at")
            .in("id", batch)
            .order("id", { ascending: true })
            .range(from, to)
        )
      );
      const items = rows
        .map((doc) => {
          const link = linkByDocumentId.get(str(doc, "id"));
          const entityType = str(link, "entity_type");
          return {
            item: {
              id: str(doc, "id"),
              name: str(doc, "title") || str(doc, "file_name") || "מסמך",
              // Its own name, for הורדה: the title is prose, the file name has the type.
              fileName: str(doc, "file_name") || null,
              type: str(doc, "document_type") || null,
              uploadedAt: str(doc, "uploaded_at") || null,
              url: null,
              sourceType: entityType === "order" || entityType === "project" ? entityType : "customer",
              sourceId: str(link, "entity_id"),
            } satisfies CustomerDocumentItem,
            storageKey: str(doc, "storage_key"),
          };
        })
        .sort((a, b) => compareDocumentsNewestFirst(a.item, b.item));

      const shown = items.slice(0, DOCUMENTS_SHOWN);
      const keys = Array.from(new Set(shown.map((entry) => entry.storageKey).filter(Boolean)));
      const signedByKey = new Map<string, string>();
      if (keys.length > 0) {
        const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(keys, 60 * 60);
        for (const entry of signed ?? []) {
          if (entry.path && entry.signedUrl) signedByKey.set(entry.path, entry.signedUrl);
        }
      }
      return {
        documents: shown.map((entry) => ({ ...entry.item, url: signedByKey.get(entry.storageKey) ?? null })),
        total: items.length,
        error: null,
      };
    })
    .catch((error) => ({ documents: [], total: 0, error: toHebrewError(error, "טעינת המסמכים נכשלה.") }));

  // Per-entity activity timeline (admin only): this customer's own changes
  // plus their orders, projects, and payments. Each id list goes as its own
  // ≤150 source; the trail merges them and keeps the newest.
  const history: Promise<CustomerHistory> = Promise.all([isAdmin, orderIds, projectIds])
    .then(([admin, orderIdList, projectIdList]) => {
      if (!admin) return { items: [], error: null };
      const sources: EntityAuditSource[] = [
        { tableName: "customers", recordId: id },
        { tableName: "orders", jsonKey: "customer_id", value: id },
        { tableName: "projects", jsonKey: "customer_id", value: id },
        ...chunkStrings(orderIdList, IN_BATCH).map((values) => ({ tableName: "payments", jsonKey: "order_id", values })),
        ...chunkStrings(projectIdList, IN_BATCH).map((values) => ({ tableName: "payments", jsonKey: "project_id", values })),
      ];
      return getEntityAuditTrail(supabase, sources);
    })
    .catch((error) => ({ items: [], error: toHebrewError(error, "טעינת ההיסטוריה נכשלה.") }));

  return { top, payments, documents, history };
}

function documentLinks(supabase: SupabaseClient, entityType: "order" | "project", ids: string[]) {
  return inBatches(ids, (batch) =>
    paged((from, to) =>
      supabase
        .from("document_links")
        .select("document_id,entity_type,entity_id")
        .eq("entity_type", entityType)
        .in("entity_id", batch)
        .order("document_id", { ascending: true })
        .order("entity_id", { ascending: true })
        .range(from, to)
    )
  );
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
