"use client";

function Dot({ delayMs }: { delayMs: number }) {
  return (
    <span
      className="h-4 w-4 animate-pulse rounded-full bg-sky-500 shadow-sm shadow-sky-200"
      style={{ animationDelay: `${delayMs}ms`, animationDuration: "1s" }}
    />
  );
}

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
        <Dot delayMs={0} />
        <Dot delayMs={150} />
        <Dot delayMs={300} />
        <Dot delayMs={450} />
      </div>
    </div>
  );
}
