import type { SupabaseClient } from "@supabase/supabase-js";
import { channelLabel, reminderStatusLabel } from "@/lib/communications";

// A per-entity activity timeline: communications + reminders attached to any
// entity, merged chronologically. This is what lets Collections (and every other
// module) show "everything that happened with this customer/order/…" without
// owning its own calls/reminders tabs.

export type ActivityEntityType = "customer" | "order" | "project" | "property" | "payment" | "vehicle" | "invoice" | "task";

export type ActivityEntry = {
  id: string;
  kind: "comm" | "reminder";
  at: string; // ISO — sort key (comm.created_at | reminder.remind_at)
  title: string;
  /** For comms: outgoing | incoming | missed (drives the colour). Null for reminders. */
  direction: string | null;
  topic: string | null;
  content: string | null;
  status: string | null;
  actorName: string | null;
};

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}

// communication_logs only carries these entity FKs; the rest (vehicle/invoice/
// task) exist on reminders only.
const COMM_COL: Partial<Record<ActivityEntityType, string>> = {
  customer: "customer_id",
  order: "order_id",
  project: "project_id",
  property: "property_id",
  payment: "payment_id",
};
const REM_COL: Record<ActivityEntityType, string> = {
  customer: "customer_id",
  order: "order_id",
  project: "project_id",
  property: "property_id",
  payment: "payment_id",
  vehicle: "vehicle_id",
  invoice: "invoice_id",
  task: "task_id",
};

export async function getEntityActivity(
  supabase: SupabaseClient,
  entityType: ActivityEntityType,
  entityId: string,
  limit = 100
): Promise<ActivityEntry[]> {
  const commCol = COMM_COL[entityType];
  const remCol = REM_COL[entityType];

  const [commsRes, remindersRes] = await Promise.all([
    commCol
      ? supabase
          .from("communication_logs")
          .select("id,channel,direction,content,category,created_at,created_by,user_id")
          .eq(commCol, entityId)
          .order("created_at", { ascending: false })
          .range(0, limit - 1)
      : Promise.resolve({ data: [] as Row[] }),
    supabase
      .from("reminders")
      .select("id,content,action_type,category,status,remind_at,assigned_to,created_by")
      .eq(remCol, entityId)
      .order("remind_at", { ascending: false })
      .range(0, limit - 1),
  ]);

  const comms = (commsRes.data ?? []) as unknown as Row[];
  const reminders = (remindersRes.data ?? []) as unknown as Row[];

  // Resolve actor names in one query.
  const userIds = [
    ...new Set(
      [
        ...comms.map((r) => str(r, "created_by") ?? str(r, "user_id")),
        ...reminders.map((r) => str(r, "assigned_to") ?? str(r, "created_by")),
      ].filter((v): v is string => Boolean(v))
    ),
  ];
  const nameById = new Map<string, string>();
  if (userIds.length) {
    const { data } = await supabase.from("users").select("id,full_name,email").in("id", userIds);
    for (const u of (data ?? []) as unknown as Row[]) {
      const id = str(u, "id");
      if (id) nameById.set(id, str(u, "full_name") ?? str(u, "email") ?? id.slice(0, 8));
    }
  }

  const entries: ActivityEntry[] = [];
  for (const c of comms) {
    entries.push({
      id: str(c, "id") ?? "",
      kind: "comm",
      at: str(c, "created_at") ?? "",
      title: channelLabel(str(c, "channel")),
      direction: str(c, "direction"),
      topic: str(c, "category"),
      content: str(c, "content"),
      status: null,
      actorName: nameById.get(str(c, "created_by") ?? str(c, "user_id") ?? "") ?? null,
    });
  }
  for (const r of reminders) {
    entries.push({
      id: str(r, "id") ?? "",
      kind: "reminder",
      at: str(r, "remind_at") ?? "",
      title: "תזכורת",
      direction: null,
      topic: str(r, "category"),
      content: str(r, "content"),
      status: reminderStatusLabel(str(r, "status")),
      actorName: nameById.get(str(r, "assigned_to") ?? str(r, "created_by") ?? "") ?? null,
    });
  }

  return entries
    .filter((e) => e.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
