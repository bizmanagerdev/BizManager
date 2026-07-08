"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ProfitLossDomainRow } from "@/lib/financial";
import type { EarnedRevenueReport } from "@/lib/financial/earnedRevenue";

// "cash"    = money that actually moved this period (came in / went out).
// "earned"  = money I MADE this period — booked to the month the work/sale
//             happened, even if the cash comes in later (from the earned report).
// "accrual" = cash + open debts owed to/by me.
// The basis + includePersonal are chosen globally (top control row) and passed in.
type Basis = "cash" | "earned" | "accrual";

const BASIS_HINT: Record<Basis, string> = {
  cash: "לפי כסף שבאמת נכנס/יצא מהחשבונות בתקופה",
  earned: "לפי מה שהרווחתי בתקופה — גם אם עדיין לא נגבה",
  accrual: "בפועל בתוספת חובות פתוחים (מגיע לי / אני חייב)",
};

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});
function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}
function signed(value: number) {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${formatCurrency(Math.abs(rounded))}`;
}
function netClass(value: number) {
  if (value > 0.5) return "text-success";
  if (value < -0.5) return "text-destructive";
  return "text-foreground";
}

type Row = { name: string; net: number };

/**
 * Reports → שורה תחתונה: a waterfall "x + y − z = ?" of the whole business.
 *   רווח מכל העסקים (מכירות + פרויקטים + הכנסות אחרות)
 *     − שוטף (תקורה כללית)
 *     − בית / צדקה (אישי)
 *     = מה שנשאר בסוף
 * Each stage shows its contribution and the running "כמה נשאר" after it.
 * The basis toggle switches between cash (money that CAME IN) and earned (money I
 * MADE this month, from the earned-revenue report). Personal spending (home/
 * charity) is always the actual money out — you don't "earn" home.
 */
export default function BottomLinePanel({
  rows,
  earned,
  basis,
  includePersonal,
}: {
  rows: ProfitLossDomainRow[];
  earned: EarnedRevenueReport | null;
  basis: Basis;
  includePersonal: boolean;
}) {
  const groups = useMemo(() => {
    // Personal (home/charity) is money spent — always actual, from the P&L rows.
    // Only counted when the global "כולל בית וצדקה" toggle is on.
    const personal: Row[] = includePersonal
      ? rows
          .filter((r) => r.isPersonal)
          .map((r) => ({ name: r.domainName, net: r.cashRevenue - r.cashExpense }))
          .filter((r) => Math.round(r.net) !== 0)
      : [];

    if (basis === "earned" && earned) {
      const cell = (key: string) => earned.totals.byDomain[key];
      const business: Row[] = earned.domains
        .filter((d) => d.key !== "general_business")
        .map((d) => ({ name: d.label, net: cell(d.key)?.net ?? 0 }))
        .filter((r) => Math.round(r.net) !== 0);
      const overhead: Row[] = earned.domains
        .filter((d) => d.key === "general_business")
        .map((d) => ({ name: d.label, net: cell(d.key)?.net ?? 0 }));
      return { business, overhead, personal };
    }

    const net = (r: ProfitLossDomainRow) =>
      basis === "accrual" ? r.accrualRevenue - r.accrualExpense : r.cashRevenue - r.cashExpense;
    const business: Row[] = rows
      .filter((r) => !r.isPersonal && r.domain !== "general_business")
      .map((r) => ({ name: r.domainName, net: net(r) }))
      .filter((r) => Math.round(r.net) !== 0);
    const overhead: Row[] = rows
      .filter((r) => r.domain === "general_business")
      .map((r) => ({ name: r.domainName, net: net(r) }));
    return { business, overhead, personal };
  }, [basis, rows, earned, includePersonal]);

  const businessTotal = groups.business.reduce((sum, r) => sum + r.net, 0);
  const overheadTotal = groups.overhead.reduce((sum, r) => sum + r.net, 0);
  const afterOverhead = businessTotal + overheadTotal;
  const personalTotal = groups.personal.reduce((sum, r) => sum + r.net, 0);
  const finalLeft = afterOverhead + personalTotal;

  const hasData = groups.business.length || groups.overhead.length || groups.personal.length;

  const line = (label: string, value: number, key: string) => (
    <div key={key} className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm">{label}</span>
      <span dir="ltr" className={cn("tabular-nums text-sm font-medium", netClass(value))}>{signed(value)}</span>
    </div>
  );

  const runningRow = (label: string, value: number, key: string) => (
    <div key={key} className="flex items-center justify-between gap-3 border-t border-dashed py-2 mt-1">
      <span className="text-sm font-semibold">{label}</span>
      <span dir="ltr" className={cn("tabular-nums text-base font-bold", netClass(value))}>{formatCurrency(value)}</span>
    </div>
  );

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <p className="text-xs text-muted-foreground print:hidden">{BASIS_HINT[basis]}</p>

      {!hasData ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          אין נתונים להצגה עבור התקופה שנבחרה.
        </div>
      ) : (
        <>
          {/* Headline result */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="text-right">
                מה שנשאר בסוף {basis === "earned" ? "(לפי מה שהרווחתי)" : basis === "cash" ? "(לפי מה שנכנס)" : "(כולל פתוחים)"}
              </CardDescription>
              <CardTitle className={cn("text-right text-3xl font-bold tabular-nums", netClass(finalLeft))}>
                <span dir="ltr">{formatCurrency(finalLeft)}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                רווח מהעסקים {formatCurrency(businessTotal)} − שוטף {formatCurrency(-overheadTotal)} − בית/אישי{" "}
                {formatCurrency(-personalTotal)} = {formatCurrency(finalLeft)}
              </p>
            </CardContent>
          </Card>

          {/* Waterfall */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-right">שלב אחר שלב — כמה נשאר בכל שלב</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <div className="pb-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {basis === "earned" ? "מה שהרווחתי מכל העסקים" : "רווח מכל העסקים"}
                </div>
                {groups.business.length === 0 ? (
                  <div className="py-1.5 text-sm text-muted-foreground">אין פעילות עסקית בתקופה.</div>
                ) : (
                  groups.business
                    .slice()
                    .sort((a, b) => b.net - a.net)
                    .map((r, i) => line(r.name, r.net, `biz-${i}`))
                )}
                {runningRow(basis === "earned" ? "סה״כ שהרווחתי" : "רווח מכל העסקים", businessTotal, "__biz_total__")}
              </div>

              {groups.overhead.length > 0 ? (
                <div className="py-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">פחות תקורה כללית (שוטף)</div>
                  {groups.overhead.map((r, i) => line(r.name, r.net, `ovh-${i}`))}
                  {runningRow("נשאר אחרי שוטף", afterOverhead, "__after_overhead__")}
                </div>
              ) : null}

              {groups.personal.length > 0 ? (
                <div className="pt-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">פחות בית ואישי (מה שהמשפחה הוציאה)</div>
                  {groups.personal
                    .slice()
                    .sort((a, b) => a.net - b.net)
                    .map((r, i) => line(r.name, r.net, `per-${i}`))}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 border-t-2 pt-3 mt-1">
                <span className="text-base font-bold">מה שנשאר בסוף</span>
                <span dir="ltr" className={cn("tabular-nums text-xl font-bold", netClass(finalLeft))}>
                  {formatCurrency(finalLeft)}
                </span>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
