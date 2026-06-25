"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function Row({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: number;
  bold?: boolean;
  tone?: "asset" | "debt";
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5", bold && "font-semibold")}>
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span
        dir="ltr"
        className={cn(
          "tabular-nums",
          tone === "asset" ? "text-success" : tone === "debt" ? "text-destructive" : ""
        )}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

/**
 * Reports → מאזן: a "what do I own vs owe" snapshot (balance-sheet style).
 * Assets  = recorded cash + open customer debts + loans we gave out.
 * Debts   = open bills/liabilities + loans we took.
 * Net worth = assets − debts. Forward-dated (scheduled) money is shown separately
 * and is NOT part of the net-worth total — it's the cash-flow view, not position.
 */
export default function PositionPanel({ data }: { data: FinancialPageData }) {
  const cash = data.actualSummary.net;
  const receivables = data.openReceivablesSummary.inflow;
  const lent = data.loansSummary.lentOutstanding;
  const openLiabilities = data.openLiabilitiesSummary.outflow;
  const borrowed = data.loansSummary.borrowedOutstanding;

  const totalAssets = cash + receivables + lent;
  const totalDebts = openLiabilities + borrowed;
  const netWorth = totalAssets - totalDebts;

  const plannedIn = data.plannedReceivablesSummary.inflow;
  const scheduledOut = data.scheduledLiabilitiesSummary.outflow;
  const hasForward = plannedIn > 0.5 || scheduledOut > 0.5;

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <Card>
        <CardContent className="flex flex-col items-center gap-1 py-6">
          <div className="text-sm text-muted-foreground">שווי נטו (רכוש פחות חוב)</div>
          <div
            dir="ltr"
            className={cn(
              "text-3xl font-bold tabular-nums",
              netWorth >= 0 ? "text-success" : "text-destructive"
            )}
          >
            {formatCurrency(netWorth)}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-right text-success">מה יש לי (רכוש)</CardTitle>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            <Row label="מזומן ויתרה בפועל" value={cash} tone="asset" />
            <Row label="חובות לקוחות פתוחים" value={receivables} tone="asset" />
            <Row label="הלוואות שנתתי" value={lent} tone="asset" />
            <Row label='סה"כ רכוש' value={totalAssets} bold tone="asset" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-right text-destructive">מה אני חייב (התחייבויות)</CardTitle>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            <Row label="התחייבויות פתוחות (חשבונות לתשלום)" value={openLiabilities} tone="debt" />
            <Row label="הלוואות שלקחתי" value={borrowed} tone="debt" />
            <Row label='סה"כ התחייבויות' value={totalDebts} bold tone="debt" />
          </CardContent>
        </Card>
      </div>

      {hasForward ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-right text-muted-foreground">
              צפוי קדימה (לא נכלל בשווי הנטו)
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            <Row label="תקבולים צפויים (צ׳קים/תשלומים עתידיים)" value={plannedIn} />
            <Row label="תשלומים מתוזמנים קדימה" value={scheduledOut} />
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground">
        ״מזומן ויתרה בפועל״ הוא סך התנועות שנרשמו בפועל — לא בהכרח יתרת הבנק המדויקת (יתרות לפי
        חשבון יגיעו עם שכבת החשבונות). חוב כרטיסי אשראי עדיין אינו מנוהל כהתחייבות נפרדת.
      </p>
    </div>
  );
}
