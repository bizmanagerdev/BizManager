import { redirect } from "next/navigation";

// The standalone task detail page was removed — everything lives on the task card
// now. Keep this route as a redirect so existing deep links (dashboard, reminders,
// collections, search, push notifications, …) still open the right task: the board
// reads ?task=<id> and opens its card.
export default async function TaskRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/tasks?task=${encodeURIComponent(id)}`);
}
