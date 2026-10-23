"use client";

import { useMemo } from "react";
import CategoryDonut, { type DonutSlice } from "@/components/charts/CategoryDonut";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SECTION_ICON_CLASS } from "@/components/ui/section-card";
import { ChartIcon } from "@/components/ui/icons";
import { formatCurrency } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import type { PropertyExpense, PropertyPayment, PropertySession } from "@/lib/properties";
import { sessionLaborCost } from "@/app/(app)/projects/[id]/ProjectTabsClient.helpers";
import { CURRENCY_SYMBOL, isForeignCurrency, type CurrencyCode } from "@/lib/fx/currencies";
import {
  ALL_CURRENCIES,
  ZERO_IN_EACH,
  addInEachCurrency,
  inEachCurrency,
  type InEachCurrency,
  type RateTable,
} from "@/lib/fx/day-rates";
import { israelDateKey } from "@/lib/timezone";
import { dayKey, isExpectedExpense, isExpectedPayment } from "./propertyMovements";

// סיכום כספי — the property's money in one card, beside its table (as on the
// project page): what came in, what went out, what's still to come, and where
// the money went by category (owner's card: "a pie of the expenses by
// category/type"). Every figure ties to the rows of the table beside it, and a
// category clicked filters that table to it (owner, 2026-10-22).
//
// A property kept in US$ or C$ (the Canada buildings) has its figures in ₪, $
// and C$ side by side (owner, 2026-10-23: "I need to see all three … how much
// did I pay there, the totals"), each movement at its own day's rate — so a
// payment in dollars and one in C$ add up in all three (lib/fx/day-rates.ts).

/** An expense's category as the donut counts it — the table filters by the same word. */
export function expenseCategoryLabel(category: string | null | undefined): string {
  return category?.trim() || "ללא קטגוריה";
}

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

/** A shift's day, in Israel. */
function sessionDay(session: PropertySession): string | null {
  const at = new Date(session.clock_in);
  return Number.isNaN(at.getTime()) ? null : israelDateKey(at);
}

function minus(a: InEachCurrency, b: InEachCurrency): InEachCurrency {
  const negated = {} as InEachCurrency;
  for (const currency of ALL_CURRENCIES) {
    const value = b[currency];
    negated[currency] = value === null ? null : -value;
  }
  return addInEachCurrency(a, negated);
}

function wholeUnits(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString("he-IL");
}

/** The figures as a little table: ₪, $ and C$ across, whole units. */
function InEachCurrencyTable({
  rows,
}: {
  rows: { label: string; value: InEachCurrency; tone?: "in" | "out"; strong?: boolean }[];
}) {
  return (
    <div className="space-y-1">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="pb-1 text-start font-normal" />
            {ALL_CURRENCIES.map((currency) => (
              <th key={currency} className="pb-1 text-end font-medium" dir="ltr">
                {CURRENCY_SYMBOL[currency]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={cn(row.strong && "border-t font-semibold")}>
              <td className={cn("py-1.5 pe-2", !row.strong && "text-muted-foreground")}>{row.label}</td>
              {ALL_CURRENCIES.map((currency) => (
                <td
                  key={currency}
                  dir="ltr"
                  className={cn(
                    "py-1.5 ps-2 text-end",
                    row.tone === "in" && "text-success",
                    row.tone === "out" && "text-destructive"
                  )}
                >
                  {wholeUnits(row.value[currency])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">כל תנועה בשער היציג של יומה.</p>
    </div>
  );
}

export default function PropertyMoneyCard({
  payments,
  expenses,
  sessions,
  currency = "ILS",
  rates = null,
  selectedCategory = null,
  onSelectCategory,
}: {
  payments: PropertyPayment[];
  expenses: PropertyExpense[];
  sessions: PropertySession[];
  /** The property's currency: in US$ or C$ its figures show in ₪, $ and C$. */
  currency?: CurrencyCode;
  /** The Bank of Israel's rates over its movements' days (components/fx/useRateTable). */
  rates?: RateTable | null;
  /** The category the table is filtered to (its donut slice's label), or null. */
  selectedCategory?: string | null;
  onSelectCategory?: (slice: DonutSlice | null) => void;
}) {
  const inEach = isForeignCurrency(currency);
  const figures = useMemo(() => {
    // Each movement in ₪ — and, with the rates, in $ and C$ at its day's rate.
    const each = (shekels: number, day: string | null, foreign?: PropertyPayment["foreign"]) =>
      inEachCurrency(shekels, day, foreign, rates);
    let incomeIn = ZERO_IN_EACH;
    let incomeExpected = ZERO_IN_EACH;
    for (const p of payments) {
      if (p.paymentStatus === "rejected") continue;
      const value = each(p.amount, dayKey(p.date), p.foreign);
      if (isExpectedPayment(p)) incomeExpected = addInEachCurrency(incomeExpected, value);
      else incomeIn = addInEachCurrency(incomeIn, value);
    }
    let paidOut = ZERO_IN_EACH;
    let expectedOut = ZERO_IN_EACH;
    const byCategory = new Map<string, number>();
    for (const e of expenses) {
      const paid = e.paymentStatus === "paid" ? e.amount : Math.max(0, e.paidAmount ?? 0);
      const day = dayKey(e.date);
      paidOut = addInEachCurrency(paidOut, each(paid, day, e.foreign));
      if (isExpectedExpense(e)) {
        expectedOut = addInEachCurrency(expectedOut, each(Math.max(0, e.amount - paid), day, e.foreign));
      }
      const label = expenseCategoryLabel(e.category);
      byCategory.set(label, (byCategory.get(label) ?? 0) + e.amount);
    }
    // A worker's shift on the property is a cost the moment it happens.
    let labor = 0;
    for (const s of sessions) {
      const cost = Math.max(0, sessionLaborCost(s) ?? 0);
      if (cost <= 0) continue;
      labor += cost;
      paidOut = addInEachCurrency(paidOut, each(cost, sessionDay(s)));
    }
    if (labor > 0) byCategory.set("שכר עובד", (byCategory.get("שכר עובד") ?? 0) + labor);
    return {
      incomeIn,
      incomeExpected,
      paidOut,
      expectedOut,
      net: minus(incomeIn, paidOut),
      categories: [...byCategory].map(([label, value]) => ({ label, value })),
    };
  }, [payments, expenses, sessions, rates]);
  const net = figures.net.ILS ?? 0;
  const incomeExpected = figures.incomeExpected.ILS ?? 0;
  const expectedOut = figures.expectedOut.ILS ?? 0;

  return (
    <CollapsibleSection
      collapsible={false}
      title="סיכום כספי"
      icon={<ChartIcon className={SECTION_ICON_CLASS} />}
      contentClassName="@container space-y-3 text-sm"
    >
      {inEach ? (
        <InEachCurrencyTable
          rows={[
            { label: "הכנסות שנכנסו", value: figures.incomeIn, tone: "in" },
            { label: "הוצאות ששולמו", value: figures.paidOut, tone: "out" },
            { label: "נטו", value: figures.net, tone: net >= 0 ? "in" : "out", strong: true },
            ...(incomeExpected > 0 ? [{ label: "צפוי להיכנס", value: figures.incomeExpected }] : []),
            ...(expectedOut > 0 ? [{ label: "צפוי לצאת", value: figures.expectedOut }] : []),
          ]}
        />
      ) : (
        <div>
          <Row label="הכנסות שנכנסו" value={figures.incomeIn.ILS ?? 0} tone="in" />
          <Row label="הוצאות ששולמו" value={figures.paidOut.ILS ?? 0} tone="out" />
          <Row label="נטו" value={net} tone={net >= 0 ? "in" : "out"} strong />
          {incomeExpected > 0 || expectedOut > 0 ? (
            <div className="mt-1 border-t pt-1">
              {incomeExpected > 0 ? <Row label="צפוי להיכנס" value={incomeExpected} /> : null}
              {expectedOut > 0 ? <Row label="צפוי לצאת" value={expectedOut} /> : null}
            </div>
          ) : null}
        </div>
      )}
      <div className="border-t pt-3">
        <div className="mb-2 font-medium">הוצאות לפי קטגוריה{inEach ? " (₪)" : ""}</div>
        <CategoryDonut
          data={figures.categories}
          emptyText="אין הוצאות לנכס הזה."
          selected={selectedCategory}
          onSelect={onSelectCategory}
        />
      </div>
    </CollapsibleSection>
  );
}
