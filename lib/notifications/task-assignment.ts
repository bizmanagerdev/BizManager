import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverPush } from "@/lib/notifications/deliver";
import { usersToAuthIds } from "@/lib/notifications/identity";

// Push a "new task" alert to the people a task was assigned to. Best-effort — the
// caller should never fail because a notification didn't send. push_subscriptions
// are keyed by the AUTH uid, so we map users.id → auth_user_id first.
export async function notifyTaskAssignees(taskId: string, subject: string, userIds: string[]): Promise<void> {
  try {
    if (userIds.length === 0) return;
    const admin = createSupabaseAdminClient();
    if (!admin) return;
    const authIds = await usersToAuthIds(admin, userIds);
    if (authIds.length === 0) return;
    await deliverPush(
      admin,
      authIds,
      { title: "📋 משימה חדשה", body: subject, url: `/tasks/${taskId}`, tag: `task-${taskId}` },
      "tasks"
    );
  } catch {
    // ignore — notification is best-effort
  }
}
