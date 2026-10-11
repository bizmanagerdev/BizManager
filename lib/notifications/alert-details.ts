import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMoney } from "@/lib/money";
import { israelDateKey } from "@/lib/timezone";
import { PROJECT_TYPE_LABELS } from "@/lib/search/projectTypeLabels";

// The few details that make an alert worth reading on its own (owner,
// 2026-10-11: "when you put in an order, just say what items they ordered and
// what the price of the order was … not all, just a little more"). Each alert
// is a title plus up to two short lines: the first is what matters most, as
// it's the one a collapsed notification shows; the second says when and who.
// Read with the admin client after the save (the caller runs it after the
// response); anything that can't be read is left out, never the alert.

type Row = Record<string, unknown>;
export type AlertText = { title: string; body: string };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** "2", "1.5": a quantity without its trailing zeros. */
export function formatQuantity(value: unknown): string {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

/** "מזרן ×2, מיטה ×1, כרית ×4 ועוד 2". */
export function itemsSummary(items: Array<{ name: string; quantity: string }>, max = 3): string | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, max).map((item) => (item.quantity && item.quantity !== "1" ? `${item.name} ×${item.quantity}` : item.name));
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

async function nameOf(admin: SupabaseClient, table: "customers" | "users" | "projects", id: unknown): Promise<string | null> {
  const key = text(id);
  if (!key) return null;
  const column = table === "users" ? "full_name" : "name";
  const { data } = await admin.from(table).select(column).eq("id", key).maybeSingle();
  return text((data as Row | null)?.[column]);
}

/**
 * A new order: the customer in the title; the total and what was ordered;
 * the delivery day asked for and who put it in.
 *   🧾 הזמנה חדשה: כהן משה
 *   ₪3,250 · מזרן ×2, מיטה זוגית, כרית ×4 ועוד 2
 *   אספקה מחר · הוזנה ע״י דוד
 */
export async function newOrderAlert(admin: SupabaseClient, orderId: string, creatorUserId: string | null): Promise<AlertText> {
  const [{ data: order }, { data: itemRows }, creator] = await Promise.all([
    admin.from("orders").select("customer_id,total_amount,requested_delivery_date").eq("id", orderId).maybeSingle(),
    admin.from("order_items").select("product_id,description,quantity_ordered").eq("order_id", orderId).range(0, 199),
    nameOf(admin, "users", creatorUserId),
  ]);
  const row = (order ?? {}) as Row;
  const items = (itemRows ?? []) as Row[];
  const productIds = [...new Set(items.map((item) => text(item.product_id)).filter((id): id is string => Boolean(id)))];
  const [customer, { data: products }] = await Promise.all([
    nameOf(admin, "customers", row.customer_id),
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
  const total = row.total_amount != null && row.total_amount !== "" ? formatMoney(row.total_amount as string | number) : null;
  const delivery = shortDay(text(row.requested_delivery_date));
  const by = firstName(creator);
  return {
    title: customer ? `🧾 הזמנה חדשה: ${customer}` : "🧾 הזמנה חדשה",
    body:
      lines(joinParts([total, summary]), joinParts([delivery && `אספקה ${delivery}`, by && `הוזנה ע״י ${by}`])) ||
      "נוספה הזמנה חדשה למערכת.",
  };
}

/**
 * A new project: its name in the title; the customer, the kind and the agreed
 * price; when it starts and who opened it.
 *   📁 פרויקט חדש: דירת כהן
 *   כהן משה · הובלה · ₪8,000
 *   מתחיל 14.10 · נפתח ע״י דוד
 */
export async function newProjectAlert(admin: SupabaseClient, projectId: string, creatorUserId: string | null): Promise<AlertText> {
  const [{ data: project }, creator] = await Promise.all([
    admin.from("projects").select("name,customer_id,project_type,agreed_base_price,start_date").eq("id", projectId).maybeSingle(),
    nameOf(admin, "users", creatorUserId),
  ]);
  const row = (project ?? {}) as Row;
  const customer = await nameOf(admin, "customers", row.customer_id);
  const name = text(row.name);
  const type = PROJECT_TYPE_LABELS[text(row.project_type) ?? ""] ?? null;
  const price = Number(row.agreed_base_price) > 0 ? formatMoney(row.agreed_base_price as string | number) : null;
  const start = shortDay(text(row.start_date));
  const by = firstName(creator);
  return {
    title: name ? `📁 פרויקט חדש: ${name}` : "📁 פרויקט חדש",
    body:
      lines(joinParts([customer, type, price]), joinParts([start && `מתחיל ${start}`, by && `נפתח ע״י ${by}`])) ||
      "נוסף פרויקט חדש למערכת.",
  };
}

const URGENT = new Set(["high", "urgent"]);

/**
 * A task given to someone: the task itself; when it's due, whether it's urgent,
 * whose it's about and who gave it.
 *   📋 משימה חדשה
 *   להתקשר לספק על המזרנים
 *   עד מחר 10:00 · דחוף · כהן משה · מדוד
 */
export async function newTaskAlert(
  admin: SupabaseClient,
  taskId: string,
  subject: string,
  actorUserId: string | null
): Promise<AlertText> {
  const [{ data: task }, actor] = await Promise.all([
    admin.from("tasks").select("due_date,due_time,priority,customer_id,project_id").eq("id", taskId).maybeSingle(),
    nameOf(admin, "users", actorUserId),
  ]);
  const row = (task ?? {}) as Row;
  const [customer, project] = await Promise.all([
    nameOf(admin, "customers", row.customer_id),
    text(row.customer_id) ? Promise.resolve(null) : nameOf(admin, "projects", row.project_id),
  ]);
  const due = shortDay(text(row.due_date));
  const time = text(row.due_time)?.slice(0, 5) ?? null;
  const by = firstName(actor);
  return {
    title: "📋 משימה חדשה",
    body: lines(
      subject,
      joinParts([
        due && `עד ${due}${time ? ` ${time}` : ""}`,
        URGENT.has(text(row.priority) ?? "") && "דחוף",
        customer ?? project,
        by && `מ${by}`,
      ])
    ),
  };
}
