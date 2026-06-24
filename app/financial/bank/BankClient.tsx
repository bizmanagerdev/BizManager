"use client";

import { Fragment } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { cn } from "@/lib/utils";
import type { BankTransfersReport } from "@/lib/financial/bankTransfers";

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year.slice(-2)}`;
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: "in" | "out" }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        dir="ltr"
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "in" ? "text-success" : tone === "out" ? "text-destructive" : ""
        )}
      >
        {value}
      </div>
    </div>
  );
}

export default function BankClient({ report }: { report: BankTransfersReport }) {
  const { transactions, totalIn, totalOut, net } = report;

  // Group (already newest-first) by month, preserving order.
  const groups: Array<{ month: string; items: typeof transactions }> = [];
  for (const txn of transactions) {
    const month = txn.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(txn);
    else groups.push({ month, items: [txn] });
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <AdaptiveGrid variant="customerStats">
        <StatBox label="נכנס בהעברות" value={formatIls(totalIn)} tone="in" />
        <StatBox label="יצא בהעברות" value={formatIls(totalOut)} tone="out" />
        <StatBox label="נטו העברות" value={formatIls(net)} />
      </AdaptiveGrid>

      <p className="text-xs text-muted-foreground">
        שים/י לב: זו תמונת ההעברות הבנקאיות שנרשמו בלבד — לא יתרת הבנק בפועל. מזומן, צ׳קים וחיובי
        אשראי אינם נכללים כאן, ואין יתרת פתיחה.
      </p>

      {transactions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            אין העברות בנקאיות שנרשמו בתקופה הזו.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {groups.map((group) => (
                <Fragment key={group.month}>
                  <div
                    dir="ltr"
                    className="bg-muted/40 px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-muted-foreground"
                  >
                    {monthLabel(group.month)}
                  </div>
                  {group.items.map((txn) => (
                    <div key={txn.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{txn.label}</div>
                        <div className="text-xs text-muted-foreground">
                          <span dir="ltr">{formatDate(txn.date)}</span>
                          {txn.domainLabel ? <span> · {txn.domainLabel}</span> : null}
                        </div>
                      </div>
                      <div
                        dir="ltr"
                        className={cn(
                          "shrink-0 font-semibold tabular-nums",
                          txn.type === "in" ? "text-success" : "text-destructive"
                        )}
                      >
                        {txn.type === "in" ? "+" : "−"}
                        {formatIls(txn.amount)}
                      </div>
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
