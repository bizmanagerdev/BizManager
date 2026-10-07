import { cn } from "@/lib/utils";

/**
 * Lightweight loading placeholder. Use inside route `loading.tsx` files (mark the
 * outermost wrapper with `data-route-loading="true"` so TopNavigationProgress can
 * track the skeleton's lifecycle) and around any Suspense fallback.
 *
 * Uses the muted token (never white — invisible on the app's light surfaces).
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      // Marks "still loading" for whoever needs to know the page is complete
      // (the dashboard's picture hand-over, components/dashboard/DashboardPicture).
      data-skeleton=""
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
