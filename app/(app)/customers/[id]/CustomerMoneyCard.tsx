"use client";

import { Suspense, use, type ReactNode } from "react";
import { PaymentIcon, PhoneCallIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { InlineSkeleton } from "@/app/(app)/customers/[id]/customerSectionUi";
import { formatMoney } from "@/lib/money";
import { formatShortDate } from "@/lib/date";
import { daysHe } from "@/lib/i18n/pluralHe";
import { paymentTermsLabel } from "@/lib/paymentTerms";
import type { CounterpartyBalance } from "@/lib/customers/counterpartyBalance";
import {
  laterDate,
  type CustomerMoney,
  type CustomerPaymentsResult,
} from "@/app/(app)/customers/[id]/customerPageModel";

// The money card at the top of the customer page: what this customer owes us,
// stated the way the project and order pages state a payment — the open debt as
// the headline, then what it's made of (paid of the total, still expected, how
// late, the terms), and the one thing to do about it. Always there, ₪0 and
// "אין חוב פתוח" when nothing is owed, so the loading screen can hold its place
// and nothing jumps when the page lands.
//
// מאזן מול העסק (loans both ways, open salary) folds in under it when this
// person has any — the two directions of one relationship, a reading; nothing
// is netted in the books.

/** Whole days from `date` back to `today` (both read as calendar days). */
function daysBefore(date: string, today: string) {
  const day = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Math.round((day(today) - day(date.slice(0, 10))) / 86_400_000);
}

/**
 * "dd/mm/yy (לפני יומיים)" — how long ago only while it's days, said the
 * Hebrew way (daysHe); further back the date alone says it. Against the
 * server's today, so the two renders agree.
 */
export function activityText(date: string | null, today: string) {
  if (!date) return "—";
  const ago = daysBefore(date, today);
  const relative = ago === 0 ? "היום" : ago === 1 ? "אתמול" : ago > 1 && ago < 7 ? `לפני ${daysHe(ago)}` : null;
  return `${formatShortDate(date, "—")}${relative ? ` (${relative})` : ""}`;
}

function LastActivity({
  lastOrderAt,
  payments,
  today,
}: {
  lastOrderAt: string | null;
  payments: Promise<CustomerPaymentsResult>;
  today: string;
}) {
  const { lastPaymentAt } = use(payments);
  return <>{activityText(laterDate(lastOrderAt, lastPaymentAt), today)}</>;
}

function Money({ value, className }: { value: number; className?: string }) {
  return <span className={`tabular-nums ${className ?? ""}`}>{formatMoney(value)}</span>;
}

export default function CustomerMoneyCard({
  money,
  balance,
  payments,
  today,
  onCollectionActions,
}: {
  money: CustomerMoney;
  balance: CounterpartyBalance | null;
  /** The page's payments, on their way — the newest of them is the "last activity". */
  payments: Promise<CustomerPaymentsResult>;
  today: string;
  /** Opens the page's גבייה section; null when the viewer may not act on it. */
  onCollectionActions: (() => void) | null;
}) {
  const hasDebt = money.openBalance > 0.009;

  const details: { label: string; value: ReactNode }[] = [
    {
      label: "נגבה",
      value: (
        <span>
          <Money value={money.totalPaid} /> מתוך <Money value={money.totalSales} />
        </span>
      ),
    },
  ];
  if (money.totalExpected > 0.009) {
    details.push({
      label: "צפוי לגבייה",
      value: (
        <span>
          <Money value={money.totalExpected} />
          {money.totalOverdueExpected > 0.009 ? (
            <span className="ms-1 text-destructive">
              (<Money value={money.totalOverdueExpected} /> באיחור)
            </span>
          ) : null}
        </span>
      ),
    });
  }
  if (hasDebt) {
    if (money.maxDaysLate > 0) {
      details.push({ label: "באיחור", value: <span className="text-destructive">{daysHe(money.maxDaysLate)}</span> });
    }
    details.push({
      label: "תנאי תשלום",
      value: `${paymentTermsLabel(money.terms)}${money.dueDate ? ` · פירעון ${formatShortDate(money.dueDate, "—")}` : ""}`,
    });
  }
  details.push({
    label: "פעילות אחרונה",
    value: (
      // The payments come after the page: the row is there from the start, its
      // date fills in — the card doesn't change height.
      <Suspense fallback={<InlineSkeleton className="h-3 w-20" />}>
        <LastActivity lastOrderAt={money.lastOrderAt} payments={payments} today={today} />
      </Suspense>
    ),
  });

  return (
    <StatActionCard
      icon={<PaymentIcon className="h-5 w-5" />}
      label="חוב פתוח"
      value={formatMoney(money.openBalance)}
      // Unpaid in red, the dashboard's way; nothing owed in green.
      valueClassName={`tabular-nums ${hasDebt ? "text-destructive" : "text-success-soft-foreground"}`}
      badges={
        <span className={`text-xs font-semibold ${hasDebt ? "text-destructive" : "text-muted-foreground"}`}>
          {hasDebt ? (money.totalPaid > 0.009 ? "שולם חלקית" : "טרם שולם") : "אין חוב פתוח"}
        </span>
      }
      details={details}
      action={
        onCollectionActions ? (
          <Button
            type="button"
            size="sm"
            variant={hasDebt ? "default" : "outline"}
            className="h-9 w-full"
            onClick={onCollectionActions}
          >
            <PhoneCallIcon className="h-4 w-4" />
            פעולות גבייה
          </Button>
        ) : null
      }
    >
      {money.totalSales > 0 ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-destructive/25" aria-hidden>
          <div className="h-full rounded-full bg-success" style={{ width: `${money.paidPct}%` }} />
        </div>
      ) : null}
      {balance ? <BalanceBlock balance={balance} /> : null}
    </StatActionCard>
  );
}

function BalanceBlock({ balance }: { balance: CounterpartyBalance }) {
  const rows: { label: string; value: ReactNode }[] = [];
  if (balance.salesOwedToUs > 0.009) rows.push({ label: "הזמנות ופרויקטים", value: <Money value={balance.salesOwedToUs} /> });
  if (balance.loansOwedToUs > 0.009) rows.push({ label: "הלוואה שנתתי לו", value: <Money value={balance.loansOwedToUs} /> });
  if (balance.loansOwedByUs > 0.009) {
    rows.push({ label: "הלוואה שלקחתי ממנו", value: <Money value={balance.loansOwedByUs} className="text-success-soft-foreground" /> });
  }
  rows.push({
    label: balance.net >= 0 ? "נטו — חייב לנו" : "נטו — אני חייב לו",
    value: (
      <Money
        value={Math.abs(balance.net)}
        className={`font-bold ${balance.net >= 0 ? "text-destructive" : "text-success-soft-foreground"}`}
      />
    ),
  });
  // Outside the net on purpose: salary accrues daily and clears on payday, so
  // folding it in would make the net swing with the payroll cycle while
  // nothing about the loan or orders changed.
  if (balance.payrollOwed !== null && balance.payrollOwed > 0.009) {
    rows.push({ label: "שכר פתוח (מחוץ לנטו)", value: <Money value={balance.payrollOwed} /> });
  }

  return (
    <div className="mt-2.5 space-y-1 border-t border-border/50 pt-2">
      <div className="text-xs font-semibold">מאזן מול העסק</div>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="min-w-0 text-end font-medium">{row.value}</span>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        כל סכום נספר בדוחות במקומו — חוב לקוח בגבייה, הלוואה כחוב ולא כרווח, שכר בשכר עבודה. קיזוז ביניהם נרשם ידנית
        בשני הצדדים.
      </p>
    </div>
  );
}
