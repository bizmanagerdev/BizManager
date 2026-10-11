import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deliverPush } from "@/lib/notifications/deliver";
import { usersToAuthIds } from "@/lib/notifications/identity";
import { newTaskAlert } from "@/lib/notifications/alert-details";

// Push a "new task" alert to the people a task was assigned to. Best-effort — the
// caller should never fail because a notification didn't send. push_subscriptions
// are keyed by the AUTH uid, so we map users.id → auth_user_id first.
// The alert says when it's due, whether it's urgent, whose it's about and who
// gave it (lib/notifications/alert-details.ts); `actorUserId` (users.id) is the
// person who created or assigned it.
export async function notifyTaskAssignees(
  taskId: string,
  subject: string,
  userIds: string[],
  actorUserId: string | null = null
): Promise<void> {
  try {
    if (userIds.length === 0) return;
    const admin = createSupabaseAdminClient();
    if (!admin) return;
    const authIds = await usersToAuthIds(admin, userIds);
    if (authIds.length === 0) return;
    const text = await newTaskAlert(admin, taskId, subject, actorUserId);
    await deliverPush(
      admin,
      authIds,
      { title: text.title, body: text.body, url: `/tasks/${taskId}`, tag: `task-${taskId}`, taskId },
      "tasks"
    );
  } catch {
    // ignore — notification is best-effort
  }
}
