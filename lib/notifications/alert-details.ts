import type { SupabaseClient } from "@supabase/supabase-js";
import { israelDateKey } from "@/lib/timezone";

// The few details that make an alert worth reading on its own — and no more
// (owner, 2026-10-11: first "just say what items they ordered … just a little
// more", then "a little too much details": an order is its items and who
// entered it, no price; a project its name, start date and who opened it; a
// task its name, due date, whether it's urgent and who gave it). A title plus
// a short line or two. Read with the admin client after the save (the caller
// runs it after the response); anything that can't be read is left out, never
// the alert.

type Row = Record<string, unknown>;
export type AlertText = { title: string; body: string };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** "2", "1.5": a quantity without its trailing zeros. */
export function formatQuantity(value: unknown): string {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

/**
 * "1 פח, 2 מזרן, 4 כרית ועוד 2": every item with its number, a single one too
 * (owner: "if there's one garbage … just say the number one").
 */
export function itemsSummary(items: Array<{ name: string; quantity: string }>, max = 3): string | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, max).map((item) => (item.quantity ? `${item.quantity} ${item.name}` : item.name));
  const rest = items.length - max;
  return rest > 0 ? `${shown.join(", ")} ועוד ${rest}` : shown.join(", ");
}

/** "היום", "מחר", or "14.10" (Israel's calendar) for a YYYY-MM-DD date. */
export function shortDay(date: string | null, now: Date = new Date()): string | null {
  const key = date?.slice(0, 10);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const today = israelDateKey(now);
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  if (key === today) return "היום";
  if (key === tomorrow) return "מחר";
  return `${Number(key.slice(8, 10))}.${Number(key.slice(5, 7))}`;
}

/** First name only ("הוזנה ע״י דוד"). */
export function firstName(fullName: string | null): string | null {
  return text(fullName)?.split(/\s+/)[0] ?? null;
}

/** The parts that are there, "a · b · c". */
export function joinParts(parts: Array<string | null | undefined | false>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function lines(...rows: string[]): string {
  return rows.filter(Boolean).join("\n");
}

async function nameOf(admin: SupabaseClient, table: "customers" | "users", id: unknown): Promise<string | null> {
  const key = text(id);
  if (!key) return null;
  const column = table === "users" ? "full_name" : "name";
  const { data } = await admin.from(table).select(column).eq("id", key).maybeSingle();
  return text((data as Row | null)?.[column]);
}

/**
 * A new order: the customer in the title; what was ordered; who entered it.
 *   🧾 הזמנה חדשה: כהן משה
 *   2 מזרן, 1 פח, 4 כרית ועוד 2
 *   הוזנה ע״י דוד
 */
export async function newOrderAlert(admin: SupabaseClient, orderId: string, creatorUserId: string | null): Promise<AlertText> {
  const [{ data: order }, { data: itemRows }, creator] = await Promise.all([
    admin.from("orders").select("customer_id").eq("id", orderId).maybeSingle(),
    admin.from("order_items").select("product_id,description,quantity_ordered").eq("order_id", orderId).range(0, 199),
    nameOf(admin, "users", creatorUserId),
  ]);
  const items = (itemRows ?? []) as Row[];
  const productIds = [...new Set(items.map((item) => text(item.product_id)).filter((id): id is string => Boolean(id)))];
  const [customer, { data: products }] = await Promise.all([
    nameOf(admin, "customers", ((order ?? {}) as Row).customer_id),
    productIds.length
      ? admin.from("products").select("id,name").in("id", productIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const productName = new Map(((products ?? []) as Row[]).map((p) => [text(p.id), text(p.name)] as const));
  const summary = itemsSummary(
    items.map((item) => ({
      name: productName.get(text(item.product_id)) ?? text(item.description) ?? "פריט",
      quantity: formatQuantity(item.quantity_ordered),
    }))
  );
  const by = firstName(creator);
  return {
    title: customer ? `🧾 הזמנה חדשה: ${customer}` : "🧾 הזמנה חדשה",
    body: lines(summary ?? "", by ? `הוזנה ע״י ${by}` : "") || "נוספה הזמנה חדשה למערכת.",
  };
}

/**
 * A new project: its name in the title; when it starts and who opened it.
 *   📁 פרויקט חדש: דירת כהן
 *   מתחיל 14.10 · נפתח ע״י דוד
 */
export async function newProjectAlert(admin: SupabaseClient, projectId: string, creatorUserId: string | null): Promise<AlertText> {
  const [{ data: project }, creator] = await Promise.all([
    admin.from("projects").select("name,start_date").eq("id", projectId).maybeSingle(),
    nameOf(admin, "users", creatorUserId),
  ]);
  const row = (project ?? {}) as Row;
  const name = text(row.name);
  const start = shortDay(text(row.start_date));
  const by = firstName(creator);
  return {
    title: name ? `📁 פרויקט חדש: ${name}` : "📁 פרויקט חדש",
    body: joinParts([start && `מתחיל ${start}`, by && `נפתח ע״י ${by}`]) || "נוסף פרויקט חדש למערכת.",
  };
}

const URGENT = new Set(["high", "urgent"]);

/**
 * A task given to someone: the task; when it's due, whether it's urgent, and
 * who gave it.
 *   📋 משימה חדשה
 *   להתקשר לספק על המזרנים
 *   עד מחר 10:00 · דחוף · מדוד
 */
export async function newTaskAlert(
  admin: SupabaseClient,
  taskId: string,
  subject: string,
  actorUserId: string | null
): Promise<AlertText> {
  const [{ data: task }, actor] = await Promise.all([
    admin.from("tasks").select("due_date,due_time,priority").eq("id", taskId).maybeSingle(),
    nameOf(admin, "users", actorUserId),
  ]);
  const row = (task ?? {}) as Row;
  const due = shortDay(text(row.due_date));
  const time = text(row.due_time)?.slice(0, 5) ?? null;
  const by = firstName(actor);
  return {
    title: "📋 משימה חדשה",
    body: lines(
      subject,
      joinParts([due && `עד ${due}${time ? ` ${time}` : ""}`, URGENT.has(text(row.priority) ?? "") && "דחוף", by && `מ${by}`])
    ),
  };
}
