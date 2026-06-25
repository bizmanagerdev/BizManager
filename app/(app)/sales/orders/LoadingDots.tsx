"use client";

const DOTS = [
  { delayMs: 0, className: "bg-primary shadow-primary/35" },
  { delayMs: 150, className: "bg-secondary shadow-secondary/35" },
  { delayMs: 300, className: "bg-primary shadow-primary/35" },
  { delayMs: 450, className: "bg-secondary shadow-secondary/35" },
] as const;

export default function LoadingDots({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex items-center gap-2.5" aria-hidden="true">
        {DOTS.map(({ delayMs, className }) => (
          <span
            key={delayMs}
            className={`h-4 w-4 animate-pulse rounded-full shadow-sm ${className}`}
            style={{ animationDelay: `${delayMs}ms`, animationDuration: "1s" }}
          />
        ))}
      </div>
    </div>
  );
}
