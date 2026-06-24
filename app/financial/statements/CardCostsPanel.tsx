"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CardCostsReport } from "@/lib/financial/cardCosts";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(-2)}`;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" }).format(date);
}

/** Per-card cost per month, with each month expandable to its individual charges. */
export default function CardCostsPanel({ report }: { report: CardCostsReport }) {
  const { cards, months, totals, items } = report;
  const [openMonth, setOpenMonth] = useState<string | null>(null);

  // month -> card label -> charges, for the drill-down.
  const itemsByMonth = useMemo(() => {
    const map = new Map<string, Map<string, typeof items>>();
    for (const item of items) {
      let byCard = map.get(item.month);
      if (!byCard) {
        byCard = new Map();
        map.set(item.month, byCard);
      }
      const list = byCard.get(item.card) ?? [];
      list.push(item);
      byCard.set(item.card, list);
    }
    return map;
  }, [items]);

  if (cards.length === 0 || months.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
        אין חיובי אשראי להצגה. נתונים יופיעו אחרי שמירת פירוט עם הוצאות.
      </div>
    );
  }

  const orderedMonths = [...months].reverse(); // newest first
  const colSpan = cards.length + 2;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-right">עלות כרטיסי אשראי לפי חודש</CardTitle>
        <CardDescription className="text-right">
          כמה כל כרטיס עלה בכל חודש, לפי תאריך העסקה (הקנייה) — לא לפי מועד החיוב. לחיצה על חודש פותחת
          את כל החיובים שלו. 12 החודשים האחרונים.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">חודש</th>
                {cards.map((card) => (
                  <th key={card.label} className="px-3 py-2 font-medium">
                    {card.label}
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">סה״כ</th>
              </tr>
            </thead>
            <tbody>
              {orderedMonths.map((row) => {
                const isOpen = openMonth === row.month;
                const byCard = itemsByMonth.get(row.month);
                return (
                  <Fragment key={row.month}>
                    <tr
                      className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                      onClick={() => setOpenMonth(isOpen ? null : row.month)}
                    >
                      <td dir="ltr" className="px-3 py-2.5 text-right font-medium tabular-nums">
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                          )}
                          {formatMonthLabel(row.month)}
                        </span>
                      </td>
                      {cards.map((card) => (
                        <td key={card.label} dir="ltr" className="px-3 py-2.5 text-right tabular-nums">
                          {formatCurrency(row.byCard[card.label] ?? 0)}
                        </td>
                      ))}
                      <td dir="ltr" className="px-3 py-2.5 text-right font-semibold tabular-nums">
                        {formatCurrency(row.total)}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b bg-muted/20">
                        <td colSpan={colSpan} className="px-3 py-3">
                          <div className="space-y-3">
                            {cards
                              .filter((card) => (byCard?.get(card.label)?.length ?? 0) > 0)
                              .map((card) => {
                                const charges = byCard?.get(card.label) ?? [];
                                const cardTotal = charges.reduce((s, c) => s + c.amount, 0);
                                return (
                                  <div key={card.label} className="space-y-1">
                                    <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                                      <span>{card.label}</span>
                                      <span dir="ltr" className="tabular-nums">
                                        {formatCurrency(cardTotal)}
                                      </span>
                                    </div>
                                    <div className="divide-y divide-border/60 rounded-md border bg-background">
                                      {charges.map((charge, idx) => (
                                        <div
                                          key={`${charge.date}-${idx}`}
                                          className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                                        >
                                          <div className="min-w-0">
                                            <span className="truncate">{charge.description}</span>
                                            <span dir="ltr" className="text-xs text-muted-foreground">
                                              {" · "}
                                              {formatDate(charge.date)}
                                            </span>
                                          </div>
                                          <span dir="ltr" className="shrink-0 tabular-nums">
                                            {formatCurrency(charge.amount)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 font-semibold">
                <td className="px-3 py-3">סה״כ</td>
                {cards.map((card) => (
                  <td key={card.label} dir="ltr" className="px-3 py-3 text-right tabular-nums">
                    {formatCurrency(totals.byCard[card.label] ?? 0)}
                  </td>
                ))}
                <td dir="ltr" className="px-3 py-3 text-right tabular-nums">
                  {formatCurrency(totals.grand)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
