import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashFlowDomainBreakdownPoint } from "@/lib/cashflow";

function getDomainState(row: CashFlowDomainBreakdownPoint) {
  const hasInflow = row.inflow > 0;
  const hasOutflow = row.outflow > 0;

  if (hasInflow && hasOutflow) {
    return { label: "הכנסות והוצאות", variant: "secondary" as const };
  }
  if (hasInflow) {
    return { label: "הכנסות בלבד", variant: "success" as const };
  }
  if (hasOutflow) {
    return { label: "הוצאות בלבד", variant: "warning" as const };
  }
  return { label: "ללא פעילות", variant: "outline" as const };
}

export default function CashFlowOverviewCard({
  rows,
}: {
  rows: CashFlowDomainBreakdownPoint[];
}) {
  const visibleRows = rows.slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="space-y-1 text-right">
          <CardTitle className="text-lg">פעילות לפי תחום</CardTitle>
          <CardDescription>הצגה קצרה של התנועה בכל תחום, בלי כפילות של הסיכום מלמעלה.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            אין עדיין פעילות תחומית להצגה.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRows.map((row) => {
              const state = getDomainState(row);
              return (
                <div key={row.domain ?? row.domainName} className="flex items-center justify-between rounded-2xl border p-4">
                  <Badge variant={state.variant}>{state.label}</Badge>
                  <div className="text-right">
                    <div className="font-medium">{row.domainName}</div>
                    <div className="text-sm text-muted-foreground">{row.net >= 0 ? "מגמת כניסה" : "מגמת יציאה"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
