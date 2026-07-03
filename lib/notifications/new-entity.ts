import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverPush } from "@/lib/notifications/deliver";

// Push a "new order / new project" alert to all active admin + office users
// (except the creator). Best-effort — never fail the create because push failed.
export async function notifyNewEntity(opts: {
  kind: "order" | "project";
  entityId: string;
  creatorUserId: string | null; // users.id
  customerId?: string | null; // orders → resolve the customer name for the body
  name?: string | null; // projects → the project name for the body
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

    let label = opts.name ?? "";
    if (!label && opts.customerId) {
      const { data: c } = await admin.from("customers").select("name").eq("id", opts.customerId).maybeSingle();
      label = (c as { name?: string | null } | null)?.name ?? "";
    }

    const isOrder = opts.kind === "order";
    await deliverPush(
      admin,
      authIds,
      {
        title: isOrder ? "🧾 הזמנה חדשה" : "📁 פרויקט חדש",
        body: label || (isOrder ? "נוספה הזמנה חדשה למערכת." : "נוסף פרויקט חדש למערכת."),
        url: isOrder ? `/sales/orders/${opts.entityId}` : `/projects/${opts.entityId}`,
        tag: `${opts.kind}-new-${opts.entityId}`,
      },
      "updates"
    );
  } catch {
    // best-effort
  }
}
