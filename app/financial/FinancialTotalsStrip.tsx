import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { FinancialPageData } from "@/lib/financial";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(Math.round(value));
}

function valueClass(accent: "success" | "destructive" | "auto", value: number) {
  if (accent === "success") return "text-success";
  if (accent === "destructive") return "text-destructive";
  return value >= 0 ? "text-success" : "text-destructive";
}

/**
 * Compact, single-row KPI strip with the headline cash-flow figures. Shown on
 * both the Flow and Reports tabs (the full breakdown lives in Reports → סיכום).
 */
export default function FinancialTotalsStrip({ data }: { data: FinancialPageData }) {
  // Outstanding loans adjust net worth: money we lent out is an asset, money we
  // borrowed is a debt. (Loan principal cash already sits in actualSummary.)
  const loans = data.loansSummary;
  const hasLoans = loans.borrowedOutstanding > 0.5 || loans.lentOutstanding > 0.5;
  const currentWorthNow =
    data.actualSummary.net +
    data.openReceivablesSummary.inflow -
    data.openLiabilitiesSummary.outflow +
    loans.lentOutstanding -
    loans.borrowedOutstanding;

  const items: Array<{ label: string; value: number; accent: "success" | "destructive" | "auto" }> = [
    { label: "כניסות בפועל", value: data.actualSummary.inflow, accent: "success" },
    { label: "יציאות בפועל", value: data.actualSummary.outflow, accent: "destructive" },
    { label: "יתרה בפועל", value: data.actualSummary.net, accent: "auto" },
    ...(hasLoans
      ? [{ label: "הלוואות (נטו)", value: loans.netPosition, accent: "auto" as const }]
      : []),
    { label: "שווי נוכחי", value: currentWorthNow, accent: "auto" },
    { label: "תחזית", value: data.forecastSummary.net, accent: "auto" },
  ];

  return (
    <Card
      dir="rtl"
      className={cn(
        "grid grid-cols-2 divide-x divide-x-reverse divide-border/60 p-0 sm:grid-cols-3",
        items.length >= 6 ? "lg:grid-cols-6" : "lg:grid-cols-5"
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="px-4 py-3 text-right">
          <div className="text-xs text-muted-foreground">{item.label}</div>
          <div dir="ltr" className={cn("mt-0.5 text-right text-lg font-semibold tabular-nums", valueClass(item.accent, item.value))}>
            {formatCurrency(item.value)}
          </div>
        </div>
      ))}
    </Card>
  );
}
