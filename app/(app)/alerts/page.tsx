import { redirect } from "next/navigation";

// The old "מה דורש טיפול" worklist. It merged into the single inbox (/inbox)
// together with the notification history — one list, filtered by origin.
// Kept as a redirect so old links, bookmarks and push payloads still land.
export default function AlertsPage() {
  redirect("/inbox");
}
