"use client";

import { useMemo } from "react";
import CategoryDonut from "@/components/charts/CategoryDonut";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SECTION_ICON_CLASS } from "@/components/ui/section-card";
import { ChartIcon } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import type { PropertyExpense, PropertyPayment, PropertySession } from "@/lib/properties";
import { sessionLaborCost } from "@/app/(app)/projects/[id]/ProjectTabsClient.helpers";
import { isExpectedExpense, isExpectedPayment } from "./propertyMovements";

// סיכום כספי — the property's money in one card, beside its table (as on the
// project page): what came in, what went out, what's still to come, and where
// the money went by category (owner's card: "a pie of the expenses by
// category/type"). Every figure ties to the rows of the table beside it.

function Row({ label, value, tone, strong }: { label: string; value: number; tone?: "in" | "out"; strong?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1.5", strong && "border-t pt-2 font-semibold")}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <span
        className={cn("tabular-nums", tone === "in" && "text-success", tone === "out" && "text-destructive")}
        dir="ltr"
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

export default function PropertyMoneyCard({
  payments,
  expenses,
  sessions,
}: {
  payments: PropertyPayment[];
  expenses: PropertyExpense[];
  sessions: PropertySession[];
}) {
  const figures = useMemo(() => {
    let incomeIn = 0;
    let incomeExpected = 0;
    for (const p of payments) {
      if (p.paymentStatus === "rejected") continue;
      if (isExpectedPayment(p)) incomeExpected += p.amount;
      else incomeIn += p.amount;
    }
    let paidOut = 0;
    let expectedOut = 0;
    const byCategory = new Map<string, number>();
    for (const e of expenses) {
      const paid = e.paymentStatus === "paid" ? e.amount : Math.max(0, e.paidAmount ?? 0);
      paidOut += paid;
      if (isExpectedExpense(e)) expectedOut += Math.max(0, e.amount - paid);
      const label = e.category?.trim() || "ללא קטגוריה";
      byCategory.set(label, (byCategory.get(label) ?? 0) + e.amount);
    }
    // A worker's shift on the property is a cost the moment it happens.
    const labor = sessions.reduce((sum, s) => sum + Math.max(0, sessionLaborCost(s) ?? 0), 0);
    paidOut += labor;
    if (labor > 0) byCategory.set("שכר עובד", (byCategory.get("שכר עובד") ?? 0) + labor);
    return {
      incomeIn,
      incomeExpected,
      paidOut,
      expectedOut,
      net: incomeIn - paidOut,
      categories: [...byCategory].map(([label, value]) => ({ label, value })),
    };
  }, [payments, expenses, sessions]);

  return (
    <CollapsibleSection
      collapsible={false}
      title="סיכום כספי"
      icon={<ChartIcon className={SECTION_ICON_CLASS} />}
      contentClassName="@container space-y-3 text-sm"
    >
      <div>
        <Row label="הכנסות שנכנסו" value={figures.incomeIn} tone="in" />
        <Row label="הוצאות ששולמו" value={figures.paidOut} tone="out" />
        <Row label="נטו" value={figures.net} tone={figures.net >= 0 ? "in" : "out"} strong />
        {figures.incomeExpected > 0 || figures.expectedOut > 0 ? (
          <div className="mt-1 border-t pt-1">
            {figures.incomeExpected > 0 ? <Row label="צפוי להיכנס" value={figures.incomeExpected} /> : null}
            {figures.expectedOut > 0 ? <Row label="צפוי לצאת" value={figures.expectedOut} /> : null}
          </div>
        ) : null}
      </div>
      <div className="border-t pt-3">
        <div className="mb-2 font-medium">הוצאות לפי קטגוריה</div>
        <CategoryDonut data={figures.categories} emptyText="אין הוצאות לנכס הזה." />
      </div>
    </CollapsibleSection>
  );
}
