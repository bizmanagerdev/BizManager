import type { SupabaseClient } from "@supabase/supabase-js";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { STORAGE_BUCKET } from "@/lib/storage";

// Central "check register": every payment recorded as a צ׳ק, surfaced in one
// searchable place so the office can answer "which check is this / whose is it /
// when do we deposit it" without drilling into each order or project.

const BUCKET = STORAGE_BUCKET;

export type CheckStatus = "pending" | "cleared" | "bounced";

export type CheckRow = {
  payment_id: string;
  check_number: string | null;
  amount: number;
  /** When the check can be cashed (post-dated date). */
  due_date: string | null;
  /** When the check was recorded. */
  payment_date: string | null;
  status: CheckStatus;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  source_type: "order" | "project" | null;
  source_id: string | null;
  source_label: string | null;
  notes: string | null;
  photo_url: string | null;
  photo_count: number;
};

export type ChecksData = {
  checks: CheckRow[];
  loadError: string | null;
};

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toNum(value: unknown): number {
  if (typeof value === "number") return value;
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Map the raw payments.payment_status onto the register's three lifecycle states. */
export function normalizeCheckStatus(raw: string | null): CheckStatus {
  const v = (raw ?? "").toLowerCase();
  if (v === "cleared" || v === "paid" || v === "collected" || v === "completed") return "cleared";
  if (v === "bounced" || v === "rejected" || v === "returned" || v === "failed") return "bounced";
  return "pending";
}

export function checkStatusLabel(status: CheckStatus): string {
  switch (status) {
    case "cleared":
      return "נפרע";
    case "bounced":
      return "חזר";
    default:
      return "לפירעון";
  }
}

export function checkStatusClasses(status: CheckStatus): string {
  switch (status) {
    case "cleared":
      return getStatusColorClasses("success");
    case "bounced":
      return getStatusColorClasses("danger");
    default:
      return getStatusColorClasses("warning");
  }
}

export async function getChecks(supabase: SupabaseClient): Promise<ChecksData> {
  const { data, error } = await supabase
    .from("payments")
    .select("id,amount_total,due_date,payment_date,payment_status,check_number,order_id,project_id,notes")
    .eq("payment_method", "check")
    .range(0, 999);

  if (error) return { checks: [], loadError: error.message };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return { checks: [], loadError: null };

  const checkIds = rows.map((r) => str(r, "id")).filter((v): v is string => Boolean(v));
  const orderIds = Array.from(
    new Set(rows.map((r) => str(r, "order_id")).filter((v): v is string => Boolean(v)))
  );
  const projectIds = Array.from(
    new Set(rows.map((r) => str(r, "project_id")).filter((v): v is string => Boolean(v)))
  );

  const customerByOrder = new Map<string, string>();
  const customerByProject = new Map<string, string>();
  const projectName = new Map<string, string>();
  const photosByPayment = new Map<string, string[]>(); // payment id -> storage keys

  await Promise.all([
    orderIds.length > 0
      ? supabase
          .from("orders")
          .select("id,customer_id")
          .in("id", orderIds)
          .then(({ data: o }) => {
            for (const row of (o ?? []) as Row[]) {
              const id = str(row, "id");
              const cid = str(row, "customer_id");
              if (id && cid) customerByOrder.set(id, cid);
            }
          })
      : Promise.resolve(),
    projectIds.length > 0
      ? supabase
          .from("projects")
          .select("id,customer_id,name")
          .in("id", projectIds)
          .then(({ data: p }) => {
            for (const row of (p ?? []) as Row[]) {
              const id = str(row, "id");
              const cid = str(row, "customer_id");
              if (id && cid) customerByProject.set(id, cid);
              if (id) projectName.set(id, str(row, "name") ?? "");
            }
          })
      : Promise.resolve(),
    // Check photos: documents linked to the payment via document_links.
    checkIds.length > 0
      ? supabase
          .from("document_links")
          .select("document_id,entity_id")
          .eq("entity_type", "payment")
          .in("entity_id", checkIds)
          .then(async ({ data: links }) => {
            const linkRows = (links ?? []) as Row[];
            const docIds = Array.from(
              new Set(linkRows.map((l) => str(l, "document_id")).filter((v): v is string => Boolean(v)))
            );
            if (docIds.length === 0) return;
            const { data: docs } = await supabase
              .from("documents")
              .select("id,storage_key")
              .in("id", docIds);
            const keyByDoc = new Map<string, string>();
            for (const d of (docs ?? []) as Row[]) {
              const id = str(d, "id");
              const key = str(d, "storage_key");
              if (id && key) keyByDoc.set(id, key);
            }
            for (const l of linkRows) {
              const pid = str(l, "entity_id");
              const did = str(l, "document_id");
              if (!pid || !did) continue;
              const key = keyByDoc.get(did);
              if (!key) continue;
              const list = photosByPayment.get(pid) ?? [];
              list.push(key);
              photosByPayment.set(pid, list);
            }
          })
      : Promise.resolve(),
  ]);

  // Customers
  const customerIds = Array.from(
    new Set([...customerByOrder.values(), ...customerByProject.values()])
  );
  const customerById = new Map<string, { name: string; phone: string | null }>();
  if (customerIds.length > 0) {
    const { data: c } = await supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone")
      .in("id", customerIds);
    for (const row of (c ?? []) as Row[]) {
      const id = str(row, "id");
      if (!id) continue;
      customerById.set(id, {
        name: str(row, "name") ?? str(row, "name_for_invoice") ?? "לקוח",
        phone: str(row, "phone"),
      });
    }
  }

  // Sign all photo URLs in a single batch.
  const allKeys = Array.from(new Set(Array.from(photosByPayment.values()).flat()));
  const signedByKey = new Map<string, string>();
  if (allKeys.length > 0) {
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(allKeys, 60 * 60);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedByKey.set(s.path, s.signedUrl);
    }
  }

  const checks: CheckRow[] = rows.map((row) => {
    const orderId = str(row, "order_id");
    const projectId = str(row, "project_id");
    const customerId = orderId
      ? customerByOrder.get(orderId) ?? null
      : projectId
        ? customerByProject.get(projectId) ?? null
        : null;
    const cust = customerId ? customerById.get(customerId) : null;
    const paymentId = str(row, "id") ?? "";
    const keys = photosByPayment.get(paymentId) ?? [];
    const firstUrl = keys.map((k) => signedByKey.get(k)).find((u): u is string => Boolean(u)) ?? null;

    const sourceLabel = orderId
      ? `הזמנה #${orderId.slice(0, 8)}`
      : projectId
        ? projectName.get(projectId) || `פרויקט #${projectId.slice(0, 8)}`
        : null;

    return {
      payment_id: paymentId,
      check_number: str(row, "check_number"),
      amount: toNum(row.amount_total),
      due_date: str(row, "due_date"),
      payment_date: str(row, "payment_date"),
      status: normalizeCheckStatus(str(row, "payment_status")),
      customer_id: customerId,
      customer_name: cust?.name ?? "לקוח",
      customer_phone: cust?.phone ?? null,
      source_type: orderId ? "order" : projectId ? "project" : null,
      source_id: orderId ?? projectId ?? null,
      source_label: sourceLabel,
      notes: str(row, "notes"),
      photo_url: firstUrl,
      photo_count: keys.length,
    };
  });

  // Default order: soonest deposit date first; undated checks last.
  checks.sort((a, b) => (a.due_date ?? "9999-99-99").localeCompare(b.due_date ?? "9999-99-99"));

  return { checks, loadError: null };
}
