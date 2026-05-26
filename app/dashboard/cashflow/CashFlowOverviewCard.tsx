import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowDomainBreakdownPoint } from "@/lib/cashflow";
import DomainBarChart from "@/components/charts/DomainBarChart";

export default function CashFlowOverviewCard({
  rows,
}: {
  rows: CashFlowDomainBreakdownPoint[];
}) {
  const chartData = rows.slice(0, 7).map((row) => ({
    name: row.domainName,
    inflow: row.inflow,
    outflow: row.outflow,
  }));

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="space-y-1 text-right">
          <CardTitle className="text-lg">פעילות לפי תחום</CardTitle>
          <CardDescription>הכנסות והוצאות לפי תחום עסקי, 5 חודשים אחרונים.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            אין עדיין פעילות תחומית להצגה.
          </div>
        ) : (
          <DomainBarChart data={chartData} height={240} />
        )}
      </CardContent>
    </Card>
  );
}
