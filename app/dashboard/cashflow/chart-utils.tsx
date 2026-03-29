import { cn } from "@/lib/utils";

export const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

export const compactCurrencyFormatter = new Intl.NumberFormat("he-IL", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

export function formatCompactCurrency(value: number) {
  return compactCurrencyFormatter.format(value);
}

export function formatPeriodLabel(period: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const date = new Date(period);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" }).format(date);
    }
  }

  if (/^\d{4}-\d{2}$/.test(period)) {
    const date = new Date(`${period}-01`);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("he-IL", { month: "short", year: "2-digit" }).format(date);
    }
  }

  return period;
}

export function chartPolyline(points: string[]) {
  return points.join(" ");
}

export function scaleY(value: number, min: number, max: number, height: number) {
  if (max <= min) return height / 2;
  const ratio = (value - min) / (max - min);
  return height - ratio * height;
}

export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; colorClassName: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-3 text-xs text-muted-foreground", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", item.colorClassName)} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
