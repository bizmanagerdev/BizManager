"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChartIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import { NativeSelect } from "@/components/ui/native-select";
import DomainBarChart from "@/components/charts/DomainBarChart";
import { loadDomainChartMonth } from "@/app/(app)/dashboard/actions";
import { monthChoices, type DomainBar, type MonthKey } from "@/lib/dashboard/domain-chart";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";

// Income vs expenses per business domain, for ONE month — with the month picker
// at the far end of the header (the LEFT end, RTL), where the card's controls go.
//
// The picker replaced the "החודש הנוכחי" line under the title (user, 2026-08-18):
// it names the month itself, so the line was the same sentence twice. It opens on
// the current month, which is what the card always showed before.
//
// Switching months goes back to the server (a month's cash can't be re-derived
// from the month already on screen) through `loadDomainChartMonth`, which re-checks
// the role. While that's in flight the select is DISABLED and the chart is dimmed,
// so nothing on screen can be read as the month you just picked.

export default function DomainChartCard({
  initialBars,
  initialMonth,
  todayIso,
  locale,
}: {
  /** The first month's bars, loaded server-side with the page. */
  initialBars: DomainBar[];
  /** The month those bars are for — the current one. */
  initialMonth: MonthKey;
  /** The server's date, so the picker's list is identical on both sides. */
  todayIso: string;
  locale: Locale;
}) {
  const [month, setMonth] = useState<MonthKey>(initialMonth);
  const [bars, setBars] = useState<DomainBar[]>(initialBars);
  const [pending, startTransition] = useTransition();

  const choices = useMemo(() => monthChoices(todayIso), [todayIso]);

  function pickMonth(next: MonthKey) {
    if (next === month) return;
    const previous = month;
    setMonth(next);
    startTransition(async () => {
      const result = await loadDomainChartMonth(next);
      if (!result.ok) {
        // Put the picker back on the month whose numbers are still drawn, rather
        // than leaving the header naming a month the chart isn't showing.
        setMonth(previous);
        toast.error(result.error);
        return;
      }
      setBars(result.bars);
    });
  }

  return (
    // Overlay link, not a wrapper: the chart has its own hover/tooltip layer, and
    // the picker inside the header has to stay clickable.
    <Card className="relative flex h-full flex-col">
      <Link
        href="/financial"
        aria-label={t(dashboardDict, locale, "toFinancialLabel")}
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        {/* "הכנסות והוצאות", not "...לפי תחום": the month picker shares this row,
            and the longer name pushed it onto a second line. What the split is by
            is written along the chart's own axis anyway. */}
        <DashboardCardHeader
          icon={ChartIcon}
          title={t(dashboardDict, locale, "incomeExpensesTitle")}
          nowrap
          action={
            <NativeSelect
              dense
              aria-label={t(dashboardDict, locale, "selectMonthAria")}
              // Sized to the count badge it sits beside, not to a form field: no
              // border, no plate, no shadow — just the month in muted text with
              // the native arrow. A full-height bordered select in a header made
              // the picker the loudest thing on the card, ahead of its name.
              className="pointer-events-auto h-6 w-auto rounded-full border-0 bg-transparent px-1 py-0 text-xs font-semibold text-muted-foreground shadow-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-offset-0"
              value={month}
              disabled={pending}
              onChange={(event) => pickMonth(event.target.value)}
            >
              {choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </NativeSelect>
          }
        />
        <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-3">
          {/* The chart fills its box, so the box needs a REAL height. On desktop
              the board's fixed row gives the card one and `h-full` resolves; below
              xl the board is a plain stack, the card is auto-height, and a
              percentage there resolves to zero — which is why the card rendered as
              a header over blank space on a phone. Hence the fixed 16rem. */}
          <div className={pending ? "h-64 opacity-50 transition-opacity xl:h-full" : "h-64 xl:h-full"}>
            {bars.length > 0 ? (
              <DomainBarChart data={bars} height="100%" />
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                {pending
                  ? t(dashboardDict, locale, "loadingDataLabel")
                  : t(dashboardDict, locale, "noCashMovementsLabel")}
              </div>
            )}
          </div>
        </CardContent>
        <DashboardCardFooter href="/financial" label={t(dashboardDict, locale, "toFinancialLabel")} />
      </div>
    </Card>
  );
}
