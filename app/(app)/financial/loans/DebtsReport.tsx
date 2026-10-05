"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BankIcon, CalendarIcon, ChartIcon, CloseIcon, LayersIcon, ListIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { SectionCard } from "@/components/ui/section-card";
import { SummaryCard } from "@/app/(app)/financial/FinancialPage.ui";
import {
  DEBT_KINDS,
  DEBT_KIND_LABEL,
  DEBT_TIMINGS,
  DEBT_TIMING_LABEL,
  addDaysIso,
  DEBT_SOON_DAYS,
  debtsByAccount,
  debtsByDomain,
  debtsByMonth,
  emptyDebtTotals,
  totalDebts,
  totalDebtsByKind,
  type DebtBreakdownRow,
  type DebtItem,
  type DebtTiming,
  type DebtTotals,
} from "@/lib/debts";
import { formatShortDate } from "@/lib/date";
import { accountOptions, domainOptions, filterDebts, type KindFilter } from "./debts.helpers";
import DebtsSections from "./DebtsSections";
import { formatIls } from "./shared";

// The דוח tab: what we owe, cut every useful way — by when it's due, by kind,
// month by month, by the account it will leave from, and by business domain.
// Filter by kind / account / domain and every figure on the tab follows. The
// summary cards open the debts behind them, right under the cards.

/** A summary card: every debt, or one timing bucket. */
type ReportBucket = "all" | DebtTiming;
const DETAIL_ID = "debts-report-detail";

const SHORT_TIMING: Record<(typeof DEBT_TIMINGS)[number], string> = {
  overdue: "באיחור",
  soon: `${DEBT_SOON_DAYS} ימים`,
  later: "בהמשך",
  undated: "ללא תאריך",
};

function Money({ value, tone }: { value: number; tone?: "danger" | "muted" }) {
  const zero = !(value > 0.009);
  return (
    <span
      dir="ltr"
      className={
        "tabular-nums " +
        (zero ? "text-muted-foreground/50" : tone === "danger" ? "font-medium text-destructive" : tone === "muted" ? "text-muted-foreground" : "")
      }
    >
      {zero ? "—" : formatIls(value)}
    </span>
  );
}

/** Rows × (באיחור, 7 ימים, בהמשך, ללא תאריך, סה״כ) — a table on desktop, cards on a phone. */
function TimingMatrix({ rows, footer }: { rows: DebtBreakdownRow[]; footer: DebtTotals }) {
  if (rows.length === 0) {
    return <div className="py-4 text-center text-sm text-muted-foreground">אין נתונים לסינון הזה.</div>;
  }
  return (
    <>
      <div className="hidden overflow-auto rounded-2xl border border-border/70 sm:block">
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead className="bg-muted">
            <tr className="border-b border-border/70 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-right font-medium" />
              {DEBT_TIMINGS.map((t) => (
                <th key={t} className="px-3 py-2 text-end font-medium">{SHORT_TIMING[t]}</th>
              ))}
              <th className="px-3 py-2 text-end font-medium">סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-border/50">
                <td className="px-3 py-2 font-medium">{row.label}</td>
                {DEBT_TIMINGS.map((t) => (
                  <td key={t} className="px-3 py-2 text-end">
                    <Money value={row.totals[t]} tone={t === "overdue" ? "danger" : undefined} />
                  </td>
                ))}
                <td className="px-3 py-2 text-end font-semibold">
                  <Money value={row.totals.open} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border/70 bg-muted/30 text-xs font-semibold">
              <td className="px-3 py-2">סה״כ</td>
              {DEBT_TIMINGS.map((t) => (
                <td key={t} className="px-3 py-2 text-end">
                  <Money value={footer[t]} tone={t === "overdue" ? "danger" : undefined} />
                </td>
              ))}
              <td className="px-3 py-2 text-end">
                <Money value={footer.open} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => {
          const parts = DEBT_TIMINGS.filter((t) => row.totals[t] > 0.009);
          return (
            <div key={row.key} className="rounded-2xl border border-border/70 bg-background/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.label}</span>
                <span className="font-semibold tabular-nums" dir="ltr">{formatIls(row.totals.open)}</span>
              </div>
              {parts.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  {parts.map((t) => (
                    <span key={t} className={t === "overdue" ? "font-medium text-destructive" : undefined}>
                      {SHORT_TIMING[t]} {formatIls(row.totals[t])}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <div className="rounded-2xl border border-border/70 bg-muted/30 p-3 text-sm font-semibold">
          סה״כ: <span dir="ltr">{formatIls(footer.open)}</span>
        </div>
      </div>
    </>
  );
}

function ReportSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <SectionCard icon={icon} title={title}>
      {children}
    </SectionCard>
  );
}

export default function DebtsReport({
  items,
  todayIso,
  accountNames,
}: {
  items: DebtItem[];
  todayIso: string;
  accountNames: Map<string, string>;
}) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [account, setAccount] = useState("all");
  const [domain, setDomain] = useState("all");

  const accounts = useMemo(() => accountOptions(items, accountNames), [items, accountNames]);
  const domains = useMemo(() => domainOptions(items), [items]);
  const filtered = useMemo(
    () => filterDebts(items, { timing: "all", domain, search: "", kind, account }, todayIso),
    [items, domain, kind, account, todayIso]
  );

  const totals = useMemo(() => totalDebts(filtered, todayIso), [filtered, todayIso]);
  const kindRows = useMemo<DebtBreakdownRow[]>(() => {
    const byKind = totalDebtsByKind(filtered, todayIso);
    return DEBT_KINDS.filter((k) => byKind[k].count > 0).map((k) => ({ key: k, label: DEBT_KIND_LABEL[k], totals: byKind[k] }));
  }, [filtered, todayIso]);
  const accountRows = useMemo(() => debtsByAccount(filtered, accountNames, todayIso), [filtered, accountNames, todayIso]);
  const domainRows = useMemo(() => debtsByDomain(filtered, todayIso), [filtered, todayIso]);
  const monthRows = useMemo(() => debtsByMonth(filtered, todayIso, 6), [filtered, todayIso]);

  // The card that's open, and the debts behind it — under the same filters as
  // its figure, narrowed to that timing (a series shows only its late part
  // under "באיחור"), so the list always adds up to the number on the card.
  const [openBucket, setOpenBucket] = useState<ReportBucket | null>(null);
  const bucketItems = useMemo(
    () =>
      openBucket === null
        ? []
        : openBucket === "all"
          ? filtered
          : filterDebts(items, { timing: openBucket, domain, search: "", kind, account }, todayIso),
    [openBucket, filtered, items, domain, kind, account, todayIso]
  );
  const bucketOpen = useMemo(() => bucketItems.reduce((sum, item) => sum + item.open, 0), [bucketItems]);
  const cardToggle = (bucket: ReportBucket) => ({
    active: openBucket === bucket,
    controls: DETAIL_ID,
    onClick: () => setOpenBucket((current) => (current === bucket ? null : bucket)),
  });

  // On a phone the list opens below all five cards — bring it into view when
  // it starts below the fold (a card tapped near the top of a short screen).
  useEffect(() => {
    if (!openBucket) return;
    const panel = document.getElementById(DETAIL_ID);
    if (panel && panel.getBoundingClientRect().top > window.innerHeight * 0.6) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [openBucket]);

  const selectClass = "w-full sm:w-auto";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <NativeSelect dense value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} className={selectClass}>
          <option value="all">כל סוגי החובות</option>
          {DEBT_KINDS.map((k) => (
            <option key={k} value={k}>
              {DEBT_KIND_LABEL[k]}
            </option>
          ))}
        </NativeSelect>
        {accounts.length > 0 ? (
          <NativeSelect dense value={account} onChange={(e) => setAccount(e.target.value)} className={selectClass}>
            <option value="all">כל החשבונות</option>
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        {domains.length > 1 ? (
          <NativeSelect dense value={domain} onChange={(e) => setDomain(e.target.value)} className={selectClass}>
            <option value="all">כל התחומים</option>
            {domains.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </div>

      {/* Each card opens the debts behind its figure right under the cards
          (tap again, or ✕, to close). */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <SummaryCard
          title="סה״כ חובות"
          value={formatIls(totals.open)}
          description={`${totals.count} חובות פתוחים`}
          accent="destructive"
          {...cardToggle("all")}
        />
        <SummaryCard
          title={DEBT_TIMING_LABEL.overdue}
          value={formatIls(totals.overdue)}
          description="עבר המועד ועדיין לא שולם"
          accent={totals.overdue > 0.009 ? "destructive" : "default"}
          {...cardToggle("overdue")}
        />
        <SummaryCard
          title={DEBT_TIMING_LABEL.soon}
          value={formatIls(totals.soon)}
          description={`עד ${formatShortDate(addDaysIso(todayIso, DEBT_SOON_DAYS))}`}
          {...cardToggle("soon")}
        />
        <SummaryCard
          title={DEBT_TIMING_LABEL.later}
          value={formatIls(totals.later)}
          description="מעבר לשבוע הקרוב"
          {...cardToggle("later")}
        />
        <SummaryCard
          title={DEBT_TIMING_LABEL.undated}
          value={formatIls(totals.undated)}
          description="לא נקבע מתי לשלם"
          {...cardToggle("undated")}
        />
      </div>

      {openBucket ? (
        <SectionCard
          id={DETAIL_ID}
          icon={<ListIcon className="h-4 w-4" />}
          title={`${openBucket === "all" ? "כל החובות" : DEBT_TIMING_LABEL[openBucket]} — ${
            bucketItems.length === 1 ? "חוב אחד" : `${bucketItems.length} חובות`
          } · ${formatIls(bucketOpen)}`}
          aside={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="סגירת הפירוט"
              onClick={() => setOpenBucket(null)}
            >
              <CloseIcon className="h-4 w-4" />
            </Button>
          }
        >
          <DebtsSections key={openBucket} items={bucketItems} emptyMessage="אין חובות כאן לסינון הזה." />
        </SectionCard>
      ) : null}

      <ReportSection icon={<LayersIcon className="h-4 w-4" />} title="לפי סוג">
        <TimingMatrix rows={kindRows} footer={kindRows.length ? totals : emptyDebtTotals()} />
      </ReportSection>

      <ReportSection icon={<CalendarIcon className="h-4 w-4" />} title="לפי חודש — מתי צריך לשלם">
        <div className="divide-y divide-border/50 rounded-2xl border border-border/70">
          {monthRows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className={row.tone === "overdue" ? "font-medium text-destructive" : row.tone === "month" ? undefined : "text-muted-foreground"}>
                {row.label}
              </span>
              <Money value={row.amount} tone={row.tone === "overdue" ? "danger" : undefined} />
            </div>
          ))}
        </div>
      </ReportSection>

      <ReportSection icon={<BankIcon className="h-4 w-4" />} title="לפי חשבון — מאיפה הכסף ייצא">
        <TimingMatrix rows={accountRows} footer={totals} />
        <p className="text-xs text-muted-foreground">שכר עובדים משולם לכל עובד בנפרד ולכן מופיע תחת ״ללא חשבון״.</p>
      </ReportSection>

      <ReportSection icon={<ChartIcon className="h-4 w-4" />} title="לפי תחום">
        <TimingMatrix rows={domainRows} footer={totals} />
      </ReportSection>
    </div>
  );
}
