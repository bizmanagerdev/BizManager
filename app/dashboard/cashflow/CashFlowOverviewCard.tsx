import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
  transactionCount,
}: {
  rows: CashFlowDomainBreakdownPoint[];
  transactionCount: number;
}) {
  const visibleRows = rows.slice(0, 5);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 text-right">
            <CardTitle className="text-lg">פעילות לפי תחום</CardTitle>
            <CardDescription>
              אותה חשיבה כמו בעמוד הפיננסי, אבל בלי לחשוף סכומים בדשבורד.
            </CardDescription>
          </div>
          <Link
            href="/financial"
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60"
          >
            לעמוד הכספים
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-muted/40 p-4 text-right">
            <div className="text-xs text-muted-foreground">תחומים פעילים</div>
            <div className="mt-1 text-xl font-semibold">{rows.length}</div>
          </div>
          <div className="rounded-2xl bg-muted/40 p-4 text-right">
            <div className="text-xs text-muted-foreground">תנועות בתקופה האחרונה</div>
            <div className="mt-1 text-xl font-semibold">{transactionCount}</div>
          </div>
        </div>

        {visibleRows.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            אין עדיין פעילות תחומית להצגה.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRows.map((row) => {
              const state = getDomainState(row);
              return (
                <div
                  key={row.domain ?? row.domainName}
                  className="flex items-center justify-between rounded-2xl border p-4"
                >
                  <Badge variant={state.variant}>{state.label}</Badge>
                  <div className="text-right">
                    <div className="font-medium">{row.domainName}</div>
                    <div className="text-sm text-muted-foreground">
                      {row.net >= 0 ? "מגמת כניסה" : "מגמת יציאה"}
                    </div>
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
