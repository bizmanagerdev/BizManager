import type { AbstractPowerSyncDatabase, CrudEntry } from "@powersync/web";
import { computeInsertSortOrder } from "@/lib/tasks/sortOrder";
import {
  newCustomerRow,
  parseNewCustomerBranches,
  parseNewCustomerContacts,
  type NewCustomerInput,
} from "@/lib/customers/new-customer";
import { PROJECT_ROW_COLUMNS, type ProjectRowFields } from "@/lib/projects/project-input";
import { isReminderAction, reminderActionUpdates, type ReminderAction } from "@/lib/reminders/reminder-action";

// Saves made on the device copy first ("instant saves"): the change is written
// into the person's own copy — so every page drawn from it shows it at once —
// and PowerSync queues it and hands it to BizConnector.uploadData, which sends
// it through the SAME API route the page used before (permission checks,
// notifications, translations, reminder closing, the history log). With no
// signal it waits and goes when the connection is back. If the server refuses
// it, the change is dropped and the copy goes back to the server's version at
// the next sync.
//
// Tasks: created (the + menu, the board's quick add, the task form), edited in
// the task form (its fields, members and tags), moved / reordered / marked
// done anywhere, deleted; and comments added. Customers and projects: created,
// and projects edited (their forms), their status changed, a quote approved, a
// price set. Orders: created and edited (the order form — written by
// lib/orders/device-order-writes.ts, sent from here). Reminders: done,
// snoozed, dismissed, reopened. Payments: added to an order or a project, and
// marked collected. A new row gets its id here (the routes accept it), so it's
// the same row once the server has it.
//
// What isn't a column of the row — a task's members, tags and the reminders
// set while creating it — rides in the row's local-only `_extras` column
// (lib/powersync/schema.ts; the server never sends it, so a sync clears it),
// so it goes up in the same queue, in order, with the change it belongs to.

type Db = Pick<AbstractPowerSyncDatabase, "execute" | "getOptional">;

/** A task's own fields, as the task routes take them. */
export type TaskFields = {
  subject: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  city: string | null;
  address: string | null;
  assigned_user_id: string | null;
  priority: string;
  status: string;
  business_domain: string;
  project_id: string | null;
  property_id: string | null;
  customer_id: string | null;
  is_private: boolean;
};

/** What goes with a task's change that isn't a column of it. */
export type TaskExtras = {
  member_ids?: string[];
  tag_ids?: string[];
  /** Set while creating it (on a saved task each reminder is written on its own). */
  reminders?: { remind_at: string; content: string | null }[];
};

const TASK_FIELD_COLUMNS = [
  "subject", "description", "due_date", "due_time", "city", "address", "assigned_user_id", "priority", "status",
  "business_domain", "project_id", "property_id", "customer_id", "is_private",
] as const satisfies readonly (keyof TaskFields)[];

const LINK_COLUMNS = ["business_domain", "project_id", "property_id"] as const;

/** PowerSync stores a boolean as 1/0. */
function sqlValue(value: unknown): unknown {
  return typeof value === "boolean" ? (value ? 1 : 0) : value;
}

/** The extras as stored — with a nonce, so the same extras set twice are still two changes. */
function extrasJson(extras: TaskExtras): string {
  return JSON.stringify({ ...extras, n: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

/** A new task on the device copy, at the top of its column (as the server puts it). Returns its id. */
export async function createTaskOnDevice(
  db: Db,
  task: { id: string; fields: TaskFields; extras?: TaskExtras; creatorId: string }
): Promise<string> {
  const { fields } = task;
  const top = await db.getOptional<{ sort_order: number | null }>(
    fields.status === "todo"
      ? "SELECT min(sort_order) AS sort_order FROM tasks WHERE status = 'todo' OR status IS NULL"
      : "SELECT min(sort_order) AS sort_order FROM tasks WHERE status = ?",
    fields.status === "todo" ? [] : [fields.status]
  );
  const columns = [...TASK_FIELD_COLUMNS, "private_owner_id", "sort_order", "created_at", "_extras"];
  const values = [
    ...TASK_FIELD_COLUMNS.map((column) => sqlValue(fields[column])),
    task.creatorId,
    computeInsertSortOrder(null, top?.sort_order ?? null),
    new Date().toISOString(),
    extrasJson(task.extras ?? {}),
  ];
  await db.execute(
    `INSERT INTO tasks (id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`,
    [task.id, ...values]
  );
  return task.id;
}

/** A task's fields and/or members and tags changed (the task form). */
export async function updateTaskOnDevice(
  db: Db,
  id: string,
  changes: Partial<TaskFields>,
  extras?: Pick<TaskExtras, "member_ids" | "tag_ids">
): Promise<void> {
  const columns = TASK_FIELD_COLUMNS.filter((column) => column in changes);
  const sets = columns.map((column) => `${column} = ?`);
  const values: unknown[] = columns.map((column) => sqlValue(changes[column]));
  if (extras && (extras.member_ids || extras.tag_ids)) {
    sets.push("_extras = ?");
    values.push(extrasJson(extras));
  }
  if (sets.length === 0) return;
  await db.execute(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
}

/** A task marked done, reopened, or moved to another column (anywhere but the board's drag). */
export async function setTaskStatusOnDevice(db: Db, id: string, status: string): Promise<void> {
  await db.execute("UPDATE tasks SET status = ? WHERE id = ?", [status, id]);
}

/** A card moved: to another column and/or another position in it. */
export async function moveTaskOnDevice(db: Db, id: string, status: string, sortOrder: number): Promise<void> {
  await db.execute("UPDATE tasks SET status = ?, sort_order = ?, updated_at = ? WHERE id = ?", [
    status,
    sortOrder,
    new Date().toISOString(),
    id,
  ]);
}

/** A card deleted. */
export async function deleteTaskOnDevice(db: Db, id: string): Promise<void> {
  await db.execute("DELETE FROM tasks WHERE id = ?", [id]);
}

/** A comment added to a task. */
export async function addCommentOnDevice(
  db: Db,
  comment: { id: string; taskId: string; authorId: string; body: string }
): Promise<void> {
  await db.execute("INSERT INTO task_comments (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)", [
    comment.id,
    comment.taskId,
    comment.authorId,
    comment.body,
    new Date().toISOString(),
  ]);
}

/** A comment's text changed (its author's, or office/admin's — the server's rule decides). */
export async function editCommentOnDevice(db: Db, id: string, body: string): Promise<void> {
  // body_he: the old Hebrew copy no longer says the same thing; the server
  // makes a new one for an Arabic writer.
  await db.execute("UPDATE task_comments SET body = ?, body_he = NULL, updated_at = ? WHERE id = ?", [
    body,
    new Date().toISOString(),
    id,
  ]);
}

/** A comment deleted. */
export async function deleteCommentOnDevice(db: Db, id: string): Promise<void> {
  await db.execute("DELETE FROM task_comments WHERE id = ?", [id]);
}

/**
 * "לטיפול בהמשך": the person's snooze of a task, until a time (a new one, or a
 * new time for theirs) — or, with `until` null, the task back now. One row per
 * task and person, as on the server (lib/tasks/snooze.ts).
 */
export async function snoozeTaskOnDevice(
  db: Db,
  snooze: { taskId: string; userId: string; until: string | null }
): Promise<void> {
  if (snooze.until === null) {
    await db.execute("DELETE FROM task_snoozes WHERE task_id = ? AND user_id = ?", [snooze.taskId, snooze.userId]);
    return;
  }
  const now = new Date().toISOString();
  const existing = await db.getOptional<{ id: string }>("SELECT id FROM task_snoozes WHERE task_id = ? AND user_id = ?", [
    snooze.taskId,
    snooze.userId,
  ]);
  if (existing) {
    await db.execute("UPDATE task_snoozes SET until = ?, notified_at = NULL, updated_at = ? WHERE id = ?", [
      snooze.until,
      now,
      existing.id,
    ]);
    return;
  }
  await db.execute(
    "INSERT INTO task_snoozes (id, task_id, user_id, until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), snooze.taskId, snooze.userId, snooze.until, now, now]
  );
}

// ── Customers ────────────────────────────────────────────────────────────────
// Created on the phone first (the + menu's customer form, the new-customer
// form inside the project / order forms). The row is the one the server
// makes (lib/customers/new-customer.ts); its street, tags, contacts and
// branches ride in `_extras` and go up with it in one request — the route
// creates them right after the customer. They show once it's there.

/** A new customer on the device copy. */
export async function createCustomerOnDevice(db: Db, customer: { id: string; input: NewCustomerInput }): Promise<void> {
  const { input } = customer;
  const row = { ...newCustomerRow(input), linked_user_id: input.linked_user_id };
  const extras = {
    street: input.street,
    tag_ids: input.tag_ids,
    contacts: input.contacts,
    branches: input.branches,
    n: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const columns = [...Object.keys(row), "created_at", "_extras"];
  const values = [...Object.values(row).map(sqlValue), new Date().toISOString(), JSON.stringify(extras)];
  await db.execute(
    `INSERT INTO customers (id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`,
    [customer.id, ...values]
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────
// Created and edited on the phone first (the project form; a project page's
// edit form). The row is the one the server makes (lib/projects/project-input.ts);
// an edit goes up as the whole row as it stands on the phone — the update
// route takes the full record — so its branch, terms and due date go with it.

function projectValues(row: ProjectRowFields): unknown[] {
  return PROJECT_ROW_COLUMNS.map((column) =>
    column === "items_to_move" ? (row.items_to_move ? JSON.stringify(row.items_to_move) : null) : sqlValue(row[column])
  );
}

/** A new project on the device copy. `vatRate`: the rate it freezes, as this copy knows it (the server's is kept). */
export async function createProjectOnDevice(
  db: Db,
  project: { id: string; row: ProjectRowFields; vatRate: number | null }
): Promise<void> {
  const now = new Date().toISOString();
  const columns = [...PROJECT_ROW_COLUMNS, "vat_rate", "created_at", "updated_at"];
  await db.execute(
    `INSERT INTO projects (id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`,
    [project.id, ...projectValues(project.row), project.vatRate, now, now]
  );
}

/** A project edited: its whole row (as the update route takes it). */
export async function updateProjectOnDevice(
  db: Db,
  project: { id: string; row: ProjectRowFields; vatRate: number | null }
): Promise<void> {
  const columns = [...PROJECT_ROW_COLUMNS, "vat_rate", "updated_at"];
  await db.execute(`UPDATE projects SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`, [
    ...projectValues(project.row),
    project.vatRate,
    new Date().toISOString(),
    project.id,
  ]);
}

/** A project's row on the device, in the routes' shape. */
export function deviceProjectBody(id: string, data: Record<string, unknown>): Record<string, unknown> {
  const flag = (value: unknown) => value === 1 || value === true;
  const flagOrNull = (value: unknown) => (value === null || value === undefined ? null : flag(value));
  let items: unknown = null;
  if (typeof data.items_to_move === "string" && data.items_to_move) {
    try {
      items = JSON.parse(data.items_to_move);
    } catch {
      items = null;
    }
  }
  const body: Record<string, unknown> = { id };
  for (const column of PROJECT_ROW_COLUMNS) body[column] = data[column] ?? null;
  return {
    ...body,
    price_includes_vat: flag(data.price_includes_vat),
    no_charge: flag(data.no_charge),
    expenses_billed_separately: flag(data.expenses_billed_separately),
    items_to_move: Array.isArray(items) ? items : null,
    origin_has_elevator: flagOrNull(data.origin_has_elevator),
    destination_has_elevator: flagOrNull(data.destination_has_elevator),
  };
}

/**
 * A project change that goes up through its own route, not as the whole row:
 * its status (the status picker), a quote approved, its agreed price (the
 * project page). Only what it changes is sent — nothing else on the row as
 * this phone last saw it goes with it.
 */
export type ProjectChange =
  | { kind: "status"; status: string }
  | { kind: "approve-quote"; agreed_base_price: number }
  | { kind: "agreed-price"; agreed_base_price: number | null };

/** The columns a project change sets, as its route sets them. */
function projectChangeColumns(change: ProjectChange): Record<string, unknown> {
  if (change.kind === "status") return { status: change.status };
  if (change.kind === "approve-quote") {
    return { status: "planned", agreed_base_price: change.agreed_base_price, actual_price: change.agreed_base_price };
  }
  const price = change.agreed_base_price ?? 0;
  return { agreed_base_price: price, actual_price: price };
}

/** A project change on the device copy; false when the phone doesn't have the project (save on the server). */
export async function changeProjectOnDevice(db: Db, id: string, change: ProjectChange): Promise<boolean> {
  const stored = await db.getOptional<{ id: string }>("SELECT id FROM projects WHERE id = ?", [id]);
  if (!stored) return false;
  const columns = {
    ...projectChangeColumns(change),
    updated_at: new Date().toISOString(),
    _extras: JSON.stringify({ change, n: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
  };
  await db.execute(`UPDATE projects SET ${Object.keys(columns).map((column) => `${column} = ?`).join(", ")} WHERE id = ?`, [
    ...Object.values(columns),
    id,
  ]);
  return true;
}

/** A project change, as its `_extras` holds it. */
function projectChangeOf(value: unknown): ProjectChange | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const change = (JSON.parse(value) as { change?: { kind?: unknown; status?: unknown; agreed_base_price?: unknown } }).change;
    if (!change) return null;
    const price = change.agreed_base_price;
    if (change.kind === "status" && typeof change.status === "string") return { kind: "status", status: change.status };
    if (change.kind === "approve-quote" && typeof price === "number") return { kind: "approve-quote", agreed_base_price: price };
    if (change.kind === "agreed-price" && (typeof price === "number" || price === null)) {
      return { kind: "agreed-price", agreed_base_price: price };
    }
    return null;
  } catch {
    return null;
  }
}

function projectChangeRequest(id: string, change: ProjectChange): DeviceSaveRequest {
  if (change.kind === "status") {
    return { kind: "project-status", url: "/api/projects/update-status", body: { id, status: change.status } };
  }
  if (change.kind === "approve-quote") {
    return {
      kind: "project-approve-quote",
      url: "/api/projects/approve-quote",
      body: { id, agreed_base_price: change.agreed_base_price },
    };
  }
  return {
    kind: "project-price",
    url: "/api/projects/update-agreed-base-price",
    body: { project_id: id, agreed_base_price: change.agreed_base_price },
  };
}

// ── Reminders ────────────────────────────────────────────────────────────────
// Done, snoozed, dismissed or reopened on the phone first (the dashboard's
// today list, the alert strip, the inbox, a project's / order's reminders):
// the row changes as the action route changes it (lib/reminders/reminder-action.ts),
// so the lists drawn from the copy drop it at once; the action itself rides in
// `_extras` and goes up to the same route.

/** A reminder acted on, on the device copy; false when the phone can't do it (do it on the server). */
export async function actOnReminderOnDevice(
  db: Db,
  act: { id: string; action: ReminderAction; snoozeUntil?: string; userId: string }
): Promise<boolean> {
  const row = await db.getOptional<{ source: string | null }>("SELECT source FROM reminders WHERE id = ?", [act.id]);
  if (!row) return false;
  const result = reminderActionUpdates(row, act.action, { snoozeUntil: act.snoozeUntil, userId: act.userId });
  // An action the server would refuse (a snooze time already past): it says why.
  if ("error" in result) return false;
  const columns = {
    ...result.updates,
    _extras: JSON.stringify({
      action: act.action,
      ...(act.action === "snooze" ? { snooze_until: act.snoozeUntil } : {}),
      n: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }),
  };
  await db.execute(`UPDATE reminders SET ${Object.keys(columns).map((column) => `${column} = ?`).join(", ")} WHERE id = ?`, [
    ...Object.values(columns),
    act.id,
  ]);
  return true;
}

/** A reminder's action, as its `_extras` holds it. */
function reminderActOf(value: unknown): { action: ReminderAction; snooze_until?: string } | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as { action?: unknown; snooze_until?: unknown };
    if (!isReminderAction(parsed.action)) return null;
    return typeof parsed.snooze_until === "string"
      ? { action: parsed.action, snooze_until: parsed.snooze_until }
      : { action: parsed.action };
  } catch {
    return null;
  }
}

// ── Payments ─────────────────────────────────────────────────────────────────
// Added on the phone first (an order's payment form, a project's income form)
// and marked collected (an order's payment row): the row is the one the server
// makes (lib/orders/order-payment-input.ts, lib/payments/payment-input.ts), so
// the order's paid status, the project's money and the dashboard show it at
// once. The form's request rides in `_extras` and goes up to the same route —
// the Morning receipt is issued there, when it arrives. An order's own lines
// and payments, written with the order, carry no `_extras`: its request takes
// them (isCarriedChange).

/** The route a payment made on the phone goes up through. */
export type PaymentRoute = "order-payment" | "project-payment" | "mark-collected";

const PAYMENT_ROUTES: Record<PaymentRoute, { kind: DeviceSaveKind; url: string }> = {
  "order-payment": { kind: "order-payment", url: "/api/orders/payments/create" },
  "project-payment": { kind: "project-payment", url: "/api/payments/create" },
  "mark-collected": { kind: "payment-collected", url: "/api/payments/mark-collected" },
};

const nonce = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A new payment on the device copy: its row, and the form's request to send. */
export async function addPaymentOnDevice(
  db: Db,
  payment: { id: string; row: Record<string, unknown>; route: "order-payment" | "project-payment"; body: Record<string, unknown> }
): Promise<void> {
  const now = new Date().toISOString();
  const columns = [...Object.keys(payment.row), "created_at", "updated_at", "_extras"];
  await db.execute(
    `INSERT INTO payments (id, ${columns.join(", ")}) VALUES (?, ${columns.map(() => "?").join(", ")})`,
    [
      payment.id,
      ...Object.values(payment.row).map(sqlValue),
      now,
      now,
      JSON.stringify({ route: payment.route, body: payment.body, n: nonce() }),
    ]
  );
}

/** A payment marked collected (or back to waiting); false when the phone doesn't have it. */
export async function markPaymentCollectedOnDevice(db: Db, id: string, collected: boolean): Promise<boolean> {
  const stored = await db.getOptional<{ id: string }>("SELECT id FROM payments WHERE id = ?", [id]);
  if (!stored) return false;
  const now = new Date().toISOString();
  // cleared_at as the database's trigger sets it.
  await db.execute("UPDATE payments SET payment_status = ?, cleared_at = ?, updated_at = ?, _extras = ? WHERE id = ?", [
    collected ? "cleared" : "pending",
    collected ? now : null,
    now,
    JSON.stringify({ route: "mark-collected", body: { id, collected }, n: nonce() }),
    id,
  ]);
  return true;
}

/** A payment's change, as its `_extras` holds it. */
function paymentExtras(value: unknown): { route: PaymentRoute; body: Record<string, unknown> } | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as { route?: unknown; body?: unknown };
    if (typeof parsed.route !== "string" || !(parsed.route in PAYMENT_ROUTES)) return null;
    if (!parsed.body || typeof parsed.body !== "object") return null;
    return { route: parsed.route as PaymentRoute, body: parsed.body as Record<string, unknown> };
  } catch {
    return null;
  }
}

function customerCreateBody(id: string, data: Record<string, unknown>): Record<string, unknown> {
  let extras: Record<string, unknown> = {};
  try {
    extras = typeof data._extras === "string" && data._extras ? (JSON.parse(data._extras) as Record<string, unknown>) : {};
  } catch {
    extras = {};
  }
  const flag = (value: unknown) => value === 1 || value === true;
  return {
    id,
    name: data.name ?? "",
    name_for_invoice: data.name_for_invoice ?? null,
    registration_number: data.registration_number ?? null,
    phone: data.phone ?? null,
    whatsapp: data.whatsapp ?? null,
    email: data.email ?? null,
    city: data.city ?? "",
    address: typeof extras.street === "string" ? extras.street : null,
    notes: data.notes ?? null,
    requires_prepayment: flag(data.requires_prepayment),
    linked_user_id: data.linked_user_id ?? null,
    tag_ids: Array.isArray(extras.tag_ids) ? extras.tag_ids.filter((v): v is string => typeof v === "string") : [],
    contacts: parseNewCustomerContacts(extras.contacts),
    branches: parseNewCustomerBranches(extras.branches),
  };
}

/** What a device save turned into on the server. */
export type DeviceSaveKind =
  | "task-status"
  | "task-delete"
  | "task-create"
  | "task-update"
  | "task-comment"
  | "task-comment-edit"
  | "task-comment-delete"
  | "task-snooze"
  | "customer-create"
  | "project-create"
  | "project-update"
  | "project-status"
  | "project-approve-quote"
  | "project-price"
  | "order-create"
  | "order-update"
  | "order-payment"
  | "project-payment"
  | "payment-collected"
  | "reminder-action";

/** One queued device save, as the API route it goes through. */
export type DeviceSaveRequest = { kind: DeviceSaveKind; url: string; body: Record<string, unknown> };

/** The row as it stands on the device now (what a change that didn't record a column needs). */
export type CurrentRow = (id: string, table: "tasks" | "projects") => Promise<Record<string, unknown> | null>;

function parseExtras(value: unknown): TaskExtras {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as TaskExtras & { n?: unknown };
    const out: TaskExtras = {};
    if (Array.isArray(parsed.member_ids)) out.member_ids = parsed.member_ids.filter((v): v is string => typeof v === "string");
    if (Array.isArray(parsed.tag_ids)) out.tag_ids = parsed.tag_ids.filter((v): v is string => typeof v === "string");
    if (Array.isArray(parsed.reminders)) out.reminders = parsed.reminders;
    return out;
  } catch {
    return {};
  }
}

/** A task's fields out of a queued change, in the routes' shape (only those it holds). */
function taskFieldsOf(data: Record<string, unknown>): Partial<Record<keyof TaskFields, unknown>> {
  const out: Partial<Record<keyof TaskFields, unknown>> = {};
  for (const column of TASK_FIELD_COLUMNS) {
    if (!(column in data)) continue;
    const value = data[column];
    out[column] = column === "is_private" ? value === 1 || value === true : value ?? null;
  }
  return out;
}

/** An order's change, as its `_extras` holds it: the route body, and the form to put back if it's refused. */
function orderExtras(value: unknown): { body: Record<string, unknown>; restore: OrderRestore | null } | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as { body?: unknown; restore?: unknown };
    if (!parsed.body || typeof parsed.body !== "object") return null;
    const restore = parsed.restore as OrderRestore | null | undefined;
    return {
      body: parsed.body as Record<string, unknown>,
      restore: restore && typeof restore.key === "string" ? restore : null,
    };
  } catch {
    return null;
  }
}

/** The order form as it stood when an order was saved on the phone (its draft, under its key). */
export type OrderRestore = { key: string; draft: unknown };

/** The order form to put back if the server refuses this change (a new order). */
export function restoreForChange(op: Pick<CrudEntry, "table" | "op" | "opData">): OrderRestore | null {
  return op.table === "orders" && op.op === "PUT" ? orderExtras(op.opData?._extras)?.restore ?? null : null;
}

/**
 * Changes that go up inside another one, so nothing sends them on their own:
 * an order's lines, payments and stock, written with the order on the phone
 * (lib/orders/device-order-writes.ts) — its request carries them, and the
 * server's own come back at the next sync. A payment made or marked collected
 * by itself carries its own request (`_extras`) and goes up on its own.
 */
export function isCarriedChange(op: Pick<CrudEntry, "table" | "opData">): boolean {
  if (op.table === "payments") return !op.opData?._extras;
  return op.table === "order_items" || op.table === "inventory";
}

/**
 * The API call for one queued change, or null for a change nothing sends
 * (it's dropped and reported). `current` reads the row as it stands on the
 * device — for what the route wants that the change didn't record (a task's
 * status, for a reorder; its whole link, when part of it changed; a project's
 * whole record, for an edit).
 */
export async function requestForChange(
  op: Pick<CrudEntry, "table" | "op" | "id" | "opData">,
  current: CurrentRow
): Promise<DeviceSaveRequest | null> {
  // UpdateType's values, compared as text so this file doesn't pull the SDK
  // into the page (the page only uses the writes above).
  const kind: string = op.op;
  const data = op.opData ?? {};

  if (op.table === "task_comments") {
    if (kind === "PUT") {
      return {
        kind: "task-comment",
        url: "/api/tasks/add-comment",
        body: { id: op.id, task_id: data.task_id, message: data.body },
      };
    }
    if (kind === "PATCH") {
      // Only its text is changed on the phone (editCommentOnDevice).
      if (typeof data.body !== "string") return null;
      return { kind: "task-comment-edit", url: "/api/tasks/edit-comment", body: { id: op.id, message: data.body } };
    }
    return { kind: "task-comment-delete", url: "/api/tasks/delete-comment", body: { id: op.id } };
  }
  if (op.table === "task_snoozes") {
    // A new snooze carries its task; a changed one only its new time; a
    // removed one nothing (the route then works by the row's id).
    if (kind === "PUT") return { kind: "task-snooze", url: "/api/tasks/snooze", body: { id: op.id, task_id: data.task_id, until: data.until } };
    if (kind === "PATCH") {
      if (typeof data.until !== "string") return null;
      return { kind: "task-snooze", url: "/api/tasks/snooze", body: { id: op.id, until: data.until } };
    }
    return { kind: "task-snooze", url: "/api/tasks/snooze", body: { id: op.id, until: null } };
  }
  if (op.table === "customers") {
    // Only creating one is saved on the phone so far (edits still go to the server).
    if (kind !== "PUT") return null;
    return { kind: "customer-create", url: "/api/customers/create", body: customerCreateBody(op.id, data) };
  }
  if (op.table === "orders") {
    // The request the order form used to send, as it stood (lib/orders/device-order-writes.ts).
    const sent = orderExtras(data._extras);
    if (!sent) return null;
    if (kind === "PUT") return { kind: "order-create", url: "/api/orders/create", body: { ...sent.body, id: op.id } };
    if (kind === "PATCH") return { kind: "order-update", url: "/api/orders/update", body: { ...sent.body, order_id: op.id } };
    return null;
  }
  if (op.table === "payments") {
    const sent = paymentExtras(data._extras);
    if (!sent) return null;
    const { kind: saveKind, url } = PAYMENT_ROUTES[sent.route];
    if (kind === "PUT" && sent.route !== "mark-collected") return { kind: saveKind, url, body: { ...sent.body, id: op.id } };
    if (kind === "PATCH" && sent.route === "mark-collected") return { kind: saveKind, url, body: sent.body };
    return null;
  }
  if (op.table === "reminders") {
    if (kind !== "PATCH") return null;
    const act = reminderActOf(data._extras);
    return act ? { kind: "reminder-action", url: "/api/reminders/action", body: { id: op.id, ...act } } : null;
  }
  if (op.table === "projects") {
    if (kind === "PUT") return { kind: "project-create", url: "/api/projects/create", body: deviceProjectBody(op.id, data) };
    if (kind !== "PATCH") return null;
    // Its status, a quote approved, its price: through that change's own route.
    const change = projectChangeOf(data._extras);
    if (change) return projectChangeRequest(op.id, change);
    // An edit in the project form. Only the columns that changed are in the
    // change: the route wants them all.
    const row = await current(op.id, "projects");
    return row ? { kind: "project-update", url: "/api/projects/update", body: deviceProjectBody(op.id, row) } : null;
  }
  if (op.table !== "tasks") return null;

  if (kind === "DELETE") return { kind: "task-delete", url: "/api/tasks/delete", body: { id: op.id } };

  const extras = parseExtras(data._extras);
  if (kind === "PUT") {
    return { kind: "task-create", url: "/api/tasks/create", body: { id: op.id, ...taskFieldsOf(data), ...extras } };
  }
  if (kind !== "PATCH") return null;

  const fields = taskFieldsOf(data);
  const fieldNames = Object.keys(fields);
  const hasExtras = Boolean(extras.member_ids || extras.tag_ids);

  // A move / reorder / done tick: the status route (it keeps a reorder out of the history).
  if (!hasExtras && fieldNames.every((name) => name === "status")) {
    const sortOrder = data.sort_order === null || data.sort_order === undefined ? null : Number(data.sort_order);
    if (fieldNames.length === 0 && sortOrder === null) return null; // nothing the server keeps
    const status = typeof data.status === "string" ? data.status : ((await current(op.id, "tasks"))?.status as string | null | undefined);
    return {
      kind: "task-status",
      url: "/api/tasks/update-status",
      body: {
        id: op.id,
        status: status ?? "todo",
        ...(sortOrder !== null && Number.isFinite(sortOrder) ? { sort_order: sortOrder } : {}),
      },
    };
  }

  // An edit in the task form. The domain and its project/property are checked
  // together by the server: a change to any of them goes up with all three.
  const body: Record<string, unknown> = { id: op.id, ...fields };
  if (LINK_COLUMNS.some((column) => column in fields)) {
    const row = await current(op.id, "tasks");
    for (const column of LINK_COLUMNS) if (!(column in body)) body[column] = row?.[column] ?? null;
  }
  if (extras.member_ids) body.member_ids = extras.member_ids;
  if (extras.tag_ids) body.tag_ids = extras.tag_ids;
  return { kind: "task-update", url: "/api/tasks/update", body };
}

/** The event pages listen for when the server refused a device save. */
export const DEVICE_SAVE_REFUSED_EVENT = "bizh:device-save-refused";
export type DeviceSaveRefused = {
  kind: DeviceSaveKind;
  message: string;
  /** A new order refused: the form as it stood, to put back as its draft. */
  restore?: OrderRestore | null;
};

/** The event fired when a device save has reached the server (pages drawn by the server can refresh). */
export const DEVICE_SAVE_SENT_EVENT = "bizh:device-save-sent";
export type DeviceSaveSent = { kind: DeviceSaveKind; id: string };
