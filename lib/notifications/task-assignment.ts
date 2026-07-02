import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToRecipients } from "@/lib/push";

// Push a "new task" alert to the people a task was assigned to. Best-effort — the
// caller should never fail because a notification didn't send. push_subscriptions
// are keyed by the AUTH uid, so we map users.id → auth_user_id first.
export async function notifyTaskAssignees(taskId: string, subject: string, userIds: string[]): Promise<void> {
  try {
    const recipients = [...new Set(userIds)].filter(Boolean);
    if (recipients.length === 0) return;
    const admin = createSupabaseAdminClient();
    if (!admin) return;
    const { data: users } = await admin.from("users").select("id,auth_user_id").in("id", recipients);
    const authIds = ((users ?? []) as Array<{ auth_user_id?: string | null }>)
      .map((u) => u.auth_user_id)
      .filter((v): v is string => Boolean(v));
    if (authIds.length === 0) return;
    await sendPushToRecipients(admin, authIds, {
      title: "📋 משימה חדשה",
      body: subject,
      url: `/tasks/${taskId}`,
      tag: `task-${taskId}`,
    });
  } catch {
    // ignore — notification is best-effort
  }
}
