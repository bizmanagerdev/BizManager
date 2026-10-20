"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { donutSlices, type CategoryDonutDatum } from "./category-donut-data";

export { donutSlices, type CategoryDonutDatum } from "./category-donut-data";

// Where the money went, by category (the property page's "a pie of the
// expenses by category", owner's card). A donut of the five biggest and
// "אחר" for the rest — never more slices than a reader can tell apart — and
// beside it the same rows as a list with each one's amount and share, which
// is also its table view: three of the colours are light on white, so the
// list's labels carry the names, never the colour alone. The list draws at
// once; only the circle's code comes later, into a box of its own size.

const CategoryDonutChart = dynamic(() => import("./CategoryDonutChart"), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-full border-[14px] border-muted" />,
});

const ILS = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });

export default function CategoryDonut({
  data,
  emptyText = "אין נתונים להצגה.",
}: {
  data: CategoryDonutDatum[];
  emptyText?: string;
}) {
  const slices = useMemo(() => donutSlices(data), [data]);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (slices.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;

  return (
    <div className="flex flex-col items-center gap-3 @[22em]:flex-row @[22em]:items-start">
      <div className="relative h-36 w-36 shrink-0" aria-hidden>
        <CategoryDonutChart slices={slices} />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[0.7rem] text-muted-foreground">סה״כ</span>
          <span className="text-sm font-bold tabular-nums" dir="ltr">
            {ILS.format(total)}
          </span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-sm" aria-label="הוצאות לפי קטגוריה">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="shrink-0 tabular-nums" dir="ltr">
              {ILS.format(slice.value)}
            </span>
            <span className="w-9 shrink-0 text-end text-xs tabular-nums text-muted-foreground">
              {Math.round(slice.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
