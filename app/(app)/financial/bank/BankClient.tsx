"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { cn } from "@/lib/utils";
import { getAccountKindLabel, type AccountWithLedger } from "@/lib/accounts";

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

function AccountSummaryCard({
  account,
  selected,
  onSelect,
}: {
  account: AccountWithLedger;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-lg border bg-background p-3 text-right transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{account.name}</span>
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {getAccountKindLabel(account.kind)}
        </span>
      </div>
      <div dir="ltr" className="mt-1 text-2xl font-semibold tabular-nums">
        {formatIls(account.currentBalance)}
      </div>
      {(account.pendingIn > 0 || account.pendingOut > 0) && (
        <div dir="ltr" className="mt-1 flex flex-wrap justify-end gap-x-3 text-xs tabular-nums">
          {account.pendingIn > 0 && (
            <span className="text-success">+{formatIls(account.pendingIn)} צפוי</span>
          )}
          {account.pendingOut > 0 && (
            <span className="text-destructive">−{formatIls(account.pendingOut)} צפוי</span>
          )}
        </div>
      )}
    </button>
  );
}

export default function BankClient({ accounts }: { accounts: AccountWithLedger[] }) {
  const [selectedId, setSelectedId] = useState<string>(accounts[0]?.id ?? "");

  if (accounts.length === 0) {
    return (
      <div className="space-y-4 text-right" dir="rtl">
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              עדיין לא הוגדרו חשבונות. הגדר חשבונות בנק וקופות מזומן עם יתרת פתיחה כדי לראות כאן את
              היתרה העדכנית של כל אחד.
            </p>
            <Button asChild>
              <Link href="/settings">להגדרת חשבונות</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];
  const totalLiquidity = accounts
    .filter((a) => a.isActive)
    .reduce((sum, a) => sum + a.currentBalance, 0);

  // Group the selected account's ledger (already newest-first) by month.
  const groups: Array<{ month: string; items: typeof selected.ledger }> = [];
  for (const row of selected.ledger) {
    const month = row.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.items.push(row);
    else groups.push({ month, items: [row] });
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">סך נזילות (חשבונות פעילים)</div>
          <div dir="ltr" className="text-2xl font-semibold tabular-nums">
            {formatIls(totalLiquidity)}
          </div>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href="/settings">ניהול חשבונות</Link>
        </Button>
      </div>

      <AdaptiveGrid variant="customerStats">
        {accounts.map((account) => (
          <AccountSummaryCard
            key={account.id}
            account={account}
            selected={account.id === selected.id}
            onSelect={() => setSelectedId(account.id)}
          />
        ))}
      </AdaptiveGrid>

      {/* Register for the selected account */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
            <div className="font-medium">{selected.name}</div>
            <div className="text-xs text-muted-foreground">
              יתרת פתיחה {formatIls(selected.openingBalance)} · נכון ל-
              <span dir="ltr">{formatDate(selected.openingDate)}</span>
            </div>
          </div>

          {selected.ledger.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              אין תנועות משויכות לחשבון זה עדיין. תנועות יופיעו כאן ברגע שתשייך תקבולים והוצאות
              לחשבון.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {groups.map((group) => (
                <Fragment key={group.month}>
                  <div
                    dir="ltr"
                    className="bg-muted/30 px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-muted-foreground"
                  >
                    {monthLabel(group.month)}
                  </div>
                  {group.items.map((row) => (
                    <div key={row.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{row.label}</span>
                          {!row.posted && (
                            <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                              צפוי
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span dir="ltr">{formatDate(row.date)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end">
                        <div
                          dir="ltr"
                          className={cn(
                            "font-semibold tabular-nums",
                            row.type === "in" ? "text-success" : "text-destructive"
                          )}
                        >
                          {row.type === "in" ? "+" : "−"}
                          {formatIls(row.amount)}
                        </div>
                        {row.runningBalance !== null && (
                          <div dir="ltr" className="text-xs tabular-nums text-muted-foreground">
                            {formatIls(row.runningBalance)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        היתרה מחושבת מיתרת הפתיחה ועוד התקבולים, הלוואות שהתקבלו והחזרים שנגבו, פחות ההוצאות,
        תשלומי השכר, הלוואות שניתנו והחזרי הלוואות ששויכו לחשבון. תנועות מסומנות כ״צפוי״ (צ׳קים
        שטרם נפרעו, הוצאות שטרם שולמו) מוצגות אך אינן נכללות ביתרה.
      </p>
    </div>
  );
}
