import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverPush } from "@/lib/notifications/deliver";
import { newOrderAlert, newProjectAlert } from "@/lib/notifications/alert-details";

// Push a "new order / new project" alert to all active admin + office users
// (except the creator). Best-effort — never fail the create because push failed.
export async function notifyNewEntity(opts: {
  kind: "order" | "project";
  entityId: string;
  creatorUserId: string | null; // users.id
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) return;

    // Recipients: active back-office users, minus whoever created it.
    const { data: users } = await admin
      .from("users")
      .select("id,auth_user_id,role,active")
      .in("role", ["admin", "office"])
      .eq("active", true);
    const authIds = ((users ?? []) as Array<{ id?: string; auth_user_id?: string | null }>)
      .filter((u) => u.id !== opts.creatorUserId)
      .map((u) => u.auth_user_id)
      .filter((v): v is string => Boolean(v));
    if (authIds.length === 0) return;

    // The few details that make it worth reading: for an order what was
    // ordered and the total, for a project the customer, kind and price
    // (lib/notifications/alert-details.ts).
    const isOrder = opts.kind === "order";
    const text = isOrder
      ? await newOrderAlert(admin, opts.entityId, opts.creatorUserId)
      : await newProjectAlert(admin, opts.entityId, opts.creatorUserId);
    await deliverPush(
      admin,
      authIds,
      {
        title: text.title,
        body: text.body,
        url: isOrder ? `/sales/orders/${opts.entityId}` : `/projects/${opts.entityId}`,
        tag: `${opts.kind}-new-${opts.entityId}`,
      },
      "updates"
    );
  } catch {
    // best-effort
  }
}
