import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const SIZE = {
  default: "h-11 px-4",
  sm: "h-9 px-3",
} as const;

/**
 * A Button (components/ui/button.tsx) before the page arrives: its own box —
 * height, padding, border, rounding — with its own words in it, unseen, so it
 * is exactly as wide as the real one and a toolbar wraps where the page's
 * does. `icon` keeps the glyph's room.
 */
export function ButtonSkeleton({
  label,
  size = "default",
  icon = false,
  className,
}: {
  label: string;
  size?: keyof typeof SIZE;
  icon?: boolean;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent text-sm font-medium text-transparent",
        SIZE[size],
        className
      )}
    >
      {icon ? <span className="h-4 w-4 shrink-0" /> : null}
      {label}
    </Skeleton>
  );
}
