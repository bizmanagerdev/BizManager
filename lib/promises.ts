import type { SupabaseClient } from "@supabase/supabase-js";

// Payment promises (הבטחת תשלום) — an AR record of "customer promised ₪X by Y".

export type PaymentPromise = {
  id: string;
  customer_id: string | null;
  order_id: string | null;
  project_id: string | null;
  amount: number;
  promised_date: string;
  status: "pending" | "kept" | "broken" | "cancelled";
  notes: string | null;
  created_at: string;
};

type Row = Record<string, unknown>;

function str(row: Row, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v : null;
}
function num(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function getCustomerPromises(supabase: SupabaseClient, customerId: string): Promise<PaymentPromise[]> {
  const { data, error } = await supabase
    .from("payment_promises")
    .select("id,customer_id,order_id,project_id,amount,promised_date,status,notes,created_at")
    .eq("customer_id", customerId)
    .order("promised_date", { ascending: false })
    .range(0, 99);
  if (error || !data) return []; // table may not be migrated yet → no promises
  return (data as unknown as Row[]).map((r) => ({
    id: str(r, "id") ?? "",
    customer_id: str(r, "customer_id"),
    order_id: str(r, "order_id"),
    project_id: str(r, "project_id"),
    amount: num(r, "amount"),
    promised_date: str(r, "promised_date") ?? "",
    status: (str(r, "status") ?? "pending") as PaymentPromise["status"],
    notes: str(r, "notes"),
    created_at: str(r, "created_at") ?? "",
  }));
}

export function promiseStatusLabel(status: string): string {
  switch (status) {
    case "kept":
      return "קוימה";
    case "broken":
      return "הופרה";
    case "cancelled":
      return "בוטלה";
    default:
      return "ממתינה";
  }
}
