import { ArrowDownCircle, ArrowUpCircle, Wallet, type LucideIcon } from "lucide-react";
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

type Tone = "success" | "destructive" | "primary" | "warning";

const TILE_CLASSES: Record<Tone, string> = {
  success: "border-success/25 bg-success/10 text-success-strong",
  destructive: "border-destructive/25 bg-destructive/10 text-destructive",
  primary: "border-primary/15 bg-primary/10 text-primary",
  warning: "border-warning/30 bg-warning/15 text-warning-strong",
};

const VALUE_CLASSES: Record<Tone, string> = {
  success: "text-success-strong",
  destructive: "text-destructive",
  primary: "text-primary",
  warning: "text-warning-strong",
};

type Props = {
  summary: CashFlowSummary;
};

export default function CashFlowSummaryCards({ summary }: Props) {
  const netTone: Tone = summary.netCashFlow >= 0 ? "primary" : "warning";

  const items: Array<{ title: string; value: string; icon: LucideIcon; tone: Tone }> = [
    { title: "סך הכנסות", value: formatCurrency(summary.totalInflow), icon: ArrowUpCircle, tone: "success" },
    { title: "סך הוצאות", value: formatCurrency(summary.totalOutflow), icon: ArrowDownCircle, tone: "destructive" },
    { title: "נטו תזרים", value: formatCurrency(summary.netCashFlow), icon: Wallet, tone: netTone },
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
                  <p className={`mt-3 text-2xl font-semibold ${VALUE_CLASSES[item.tone]}`}>{item.value}</p>
                </div>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm ${TILE_CLASSES[item.tone]}`}>
                  <Icon className="h-4 w-4" strokeWidth={2.2} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
