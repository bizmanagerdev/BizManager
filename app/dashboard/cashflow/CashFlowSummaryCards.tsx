import { ArrowDownCircle, ArrowUpCircle, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { CashFlowSummary } from "@/lib/cashflow";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 2,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

type Props = {
  summary: CashFlowSummary;
};

export default function CashFlowSummaryCards({ summary }: Props) {
  const items = [
    {
      title: "סך הכנסות",
      value: formatCurrency(summary.totalInflow),
      icon: ArrowUpCircle,
      accent: "text-emerald-600",
    },
    {
      title: "סך הוצאות",
      value: formatCurrency(summary.totalOutflow),
      icon: ArrowDownCircle,
      accent: "text-rose-600",
    },
    {
      title: "נטו תזרים",
      value: formatCurrency(summary.netCashFlow),
      icon: Wallet,
      accent: summary.netCashFlow >= 0 ? "text-primary" : "text-amber-700",
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.title}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">{item.title}</p>
                  <p className={`mt-3 text-2xl font-semibold ${item.accent}`}>{item.value}</p>
                </div>
                <Icon className={`mt-1 h-5 w-5 ${item.accent}`} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
