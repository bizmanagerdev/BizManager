import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// The notification history before its data, from NotificationsClient's own
// pieces: the unread line and its button, then the category groups — a name
// over a bordered list of rows (the dot, the title, the text, the time). For
// the route's loading screen, under the page's heading.

const GROUPS = [4, 3];

export default function NotificationsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="flex items-center justify-between gap-2">
        <TextLineSkeleton className="text-sm" barClassName="w-24" />
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>

      <div className="space-y-3">
        {GROUPS.map((rows, group) => (
          <div key={group}>
            <TextLineSkeleton className="mb-1 text-xs font-semibold" barClassName="w-16" />
            <ul className="divide-y rounded-xl border">
              {Array.from({ length: rows }).map((_, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted" />
                  <div className="min-w-0 flex-1">
                    <TextLineSkeleton className="text-sm" barClassName="w-2/3" />
                    <TextLineSkeleton className="text-xs" barClassName="w-1/2" />
                    <TextLineSkeleton className="mt-0.5 text-[11px]" barClassName="w-20" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
