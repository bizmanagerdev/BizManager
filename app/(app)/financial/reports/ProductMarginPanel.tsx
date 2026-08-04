"use client";

import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import type { ProductMarginOrder, ProductMarginReport } from "@/lib/financial/productMargin";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(-2)}`;
}

function profitClass(value: number) {
  if (value > 0.5) return "text-success";
  if (value < -0.5) return "text-destructive";
  return "text-foreground";
}

function marginPct(revenue: number, profit: number) {
  if (Math.abs(revenue) < 0.5) return "—";
  return `${Math.round((profit / revenue) * 100)}%`;
}

function formatDayMonth(date: string | null) {
  if (!date || date.length < 10) return "—";
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open ? "" : "-rotate-90")} />;
}

/**
 * Reports → מכירות. Two inner views, each grouped into collapsible months:
 *   • לפי מוצר   — per month, each product with units sold, revenue, COGS, profit.
 *   • לפי הזמנה  — per month, every order with a products column (each product's
 *                 unit sale & cost price) and its revenue/cost/profit.
 */
export default function ProductMarginPanel({ report }: { report: ProductMarginReport }) {
  const { totals, productsMissingCost } = report;
  const [view, setView] = useState<"products" | "orders">("products");

  const orderedMonths = useMemo(() => [...report.months].reverse(), [report.months]); // newest first

  // Orders grouped by their order_date month (every order is dated → has a month).
  const ordersByMonth = useMemo(() => {
    const map = new Map<string, ProductMarginOrder[]>();
    for (const o of report.orders) {
      const key = (o.date ?? "").slice(0, 7);
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [report.orders]);

  // Collapse state shared by both views. Default: only the newest month open.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(report.months.slice(0, -1).map((m) => m.month))
  );
  const toggleMonth = (month: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });

  if (report.months.length === 0) {
    return (
      <EmptyState>
        אין נתוני מכירות להצגה עבור התקופה שנבחרה.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {productsMissingCost.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/15 px-3 py-2 text-sm text-warning-strong">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div>
            <span className="font-medium">
              {productsMissingCost.length} מוצרים ללא מחיר קנייה — הרווח שלהם מוצג מנופח.
            </span>{" "}
            השלמת מחיר קנייה בכרטיס המוצר תדייק את החישוב: {productsMissingCost.map((p) => p.name).join("، ")}.
          </div>
        </div>
      ) : null}

      {/* Inner view toggle. */}
      <div className="flex w-fit overflow-hidden rounded-lg border text-sm">
        <button
          type="button"
          onClick={() => setView("products")}
          className={cn(
            "px-3 py-1.5 transition-colors",
            view === "products" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
          )}
        >
          לפי מוצר
        </button>
        <button
          type="button"
          onClick={() => setView("orders")}
          className={cn(
            "px-3 py-1.5 transition-colors",
            view === "orders" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
          )}
        >
          לפי הזמנה
        </button>
      </div>

      {view === "products" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-right">מכירות מוצרים חודשי — כמה נמכר מכל מוצר וכמה הרווחנו</CardTitle>
            <CardDescription className="text-right">
              לכל חודש (לפי תאריך ההזמנה): כל מוצר עם הכמות שנמכרה, סכום המכירה, עלות הקנייה (מחיר קנייה × כמות)
              והרווח הגולמי. לחצו על חודש לפתיחה/סגירה. הזמנות שבוטלו אינן נכללות.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">מוצר</th>
                    <th className="px-3 py-2 font-medium">כמות</th>
                    <th className="px-3 py-2 font-medium">מכירות</th>
                    <th className="px-3 py-2 font-medium">עלות קנייה</th>
                    <th className="px-3 py-2 font-medium">רווח</th>
                    <th className="px-3 py-2 font-medium">אחוז</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedMonths.map((m) => {
                    const open = !collapsed.has(m.month);
                    return (
                      <Fragment key={m.month}>
                        <tr
                          className="cursor-pointer border-b-2 bg-muted/40 font-semibold hover:bg-muted/60"
                          onClick={() => toggleMonth(m.month)}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <Chevron open={open} />
                              <span dir="ltr" className="tabular-nums">{formatMonthLabel(m.month)}</span>
                              <span className="text-xs font-normal text-muted-foreground">· {m.orderCount} הזמנות</span>
                            </div>
                          </td>
                          <td dir="ltr" className="px-3 py-2 text-right tabular-nums">{formatQty(m.unitsSold)}</td>
                          <td dir="ltr" className="px-3 py-2 text-right tabular-nums">{formatCurrency(m.revenue)}</td>
                          <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-destructive">{formatCurrency(m.cost)}</td>
                          <td dir="ltr" className={cn("px-3 py-2 text-right tabular-nums", profitClass(m.profit))}>{formatCurrency(m.profit)}</td>
                          <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-muted-foreground">{marginPct(m.revenue, m.profit)}</td>
                        </tr>
                        {open
                          ? m.products.map((p) => (
                              <tr key={p.productId} className="border-b last:border-b-0">
                                <td className="px-3 py-2 pr-9">
                                  {p.name}
                                  {p.missingCost ? (
                                    <span className="mr-1 text-xs text-warning-strong" title="אין מחיר קנייה למוצר זה">⚠</span>
                                  ) : null}
                                </td>
                                <td dir="ltr" className="px-3 py-2 text-right tabular-nums">{formatQty(p.quantity)}</td>
                                <td dir="ltr" className="px-3 py-2 text-right tabular-nums">{formatCurrency(p.revenue)}</td>
                                <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-destructive">{formatCurrency(p.cost)}</td>
                                <td dir="ltr" className={cn("px-3 py-2 text-right font-medium tabular-nums", profitClass(p.profit))}>{formatCurrency(p.profit)}</td>
                                <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-muted-foreground">{marginPct(p.revenue, p.profit)}</td>
                              </tr>
                            ))
                          : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 text-base font-bold">
                    <td className="px-3 py-3">סה״כ הכל</td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums">{formatQty(totals.unitsSold)}</td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums">{formatCurrency(totals.revenue)}</td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-destructive">{formatCurrency(totals.cost)}</td>
                    <td dir="ltr" className={cn("px-3 py-3 text-right tabular-nums", profitClass(totals.profit))}>{formatCurrency(totals.profit)}</td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-muted-foreground">{marginPct(totals.revenue, totals.profit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-right">פירוט לפי הזמנה — מכירה פחות עלות</CardTitle>
            <CardDescription className="text-right">
              כל הזמנה: המוצרים שנקנו בה (מחיר מכירה / מחיר קנייה ליחידה) והרווח בפועל = מכירה פחות עלות.
              לחצו על חודש לפתיחה/סגירה.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">תאריך</th>
                    <th className="px-3 py-2 font-medium">לקוח</th>
                    <th className="px-3 py-2 font-medium">מוצרים</th>
                    <th className="px-3 py-2 font-medium">מכירה</th>
                    <th className="px-3 py-2 font-medium">עלות</th>
                    <th className="px-3 py-2 font-medium">רווח</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedMonths.map((m) => {
                    const open = !collapsed.has(m.month);
                    const monthOrders = ordersByMonth.get(m.month) ?? [];
                    return (
                      <Fragment key={m.month}>
                        <tr
                          className="cursor-pointer border-b-2 bg-muted/40 font-semibold hover:bg-muted/60"
                          onClick={() => toggleMonth(m.month)}
                        >
                          <td className="px-3 py-2" colSpan={3}>
                            <div className="flex items-center gap-1.5">
                              <Chevron open={open} />
                              <span dir="ltr" className="tabular-nums">{formatMonthLabel(m.month)}</span>
                              <span className="text-xs font-normal text-muted-foreground">· {m.orderCount} הזמנות</span>
                            </div>
                          </td>
                          <td dir="ltr" className="px-3 py-2 text-right tabular-nums">{formatCurrency(m.revenue)}</td>
                          <td dir="ltr" className="px-3 py-2 text-right tabular-nums text-destructive">{formatCurrency(m.cost)}</td>
                          <td dir="ltr" className={cn("px-3 py-2 text-right tabular-nums", profitClass(m.profit))}>{formatCurrency(m.profit)}</td>
                        </tr>
                        {open
                          ? monthOrders.map((o) => (
                              <tr key={o.orderId} className="border-b align-top last:border-b-0">
                                <td dir="ltr" className="whitespace-nowrap px-3 py-2 pr-9 text-right text-xs tabular-nums text-muted-foreground">
                                  {formatDayMonth(o.date)}
                                </td>
                                <td className="px-3 py-2">
                                  <span className="min-w-0">{o.customer}</span>
                                  {o.missingCost ? (
                                    <span className="mr-1 text-xs text-warning-strong" title="חסר מחיר קנייה למוצר בהזמנה זו">⚠</span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2">
                                  {o.items.length > 0 ? (
                                    <div className="space-y-0.5">
                                      {o.items.map((it) => (
                                        <div key={it.productId} className="font-medium">
                                          {it.name} <span className="text-muted-foreground">× {formatQty(it.quantity)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                                <td dir="ltr" className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCurrency(o.revenue)}</td>
                                <td dir="ltr" className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-destructive">{formatCurrency(o.cost)}</td>
                                <td dir="ltr" className={cn("whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums", profitClass(o.profit))}>{formatCurrency(o.profit)}</td>
                              </tr>
                            ))
                          : null}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 text-base font-bold">
                    <td className="px-3 py-3" colSpan={3}>סה״כ ({totals.orderCount} הזמנות)</td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums">{formatCurrency(totals.revenue)}</td>
                    <td dir="ltr" className="px-3 py-3 text-right tabular-nums text-destructive">{formatCurrency(totals.cost)}</td>
                    <td dir="ltr" className={cn("px-3 py-3 text-right tabular-nums", profitClass(totals.profit))}>{formatCurrency(totals.profit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
