import { cn } from "@/lib/utils";

/**
 * Inline four-dot loading indicator. Use as a lightweight placeholder for a single
 * value that is still being fetched (e.g. a stat number), instead of showing a
 * misleading "0" until the data arrives.
 *
 * Uses the muted-foreground token (never white — invisible on the app's light surfaces).
 */
export function LoadingDots({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="טוען"
      className={cn("inline-flex items-center justify-center gap-1", className)}
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={cn(
            "h-1.5 w-1.5 animate-bounce rounded-full",
            index % 2 === 0 ? "bg-primary" : "bg-secondary"
          )}
          style={{ animationDelay: `${index * 0.15}s` }}
        />
      ))}
    </span>
  );
}
