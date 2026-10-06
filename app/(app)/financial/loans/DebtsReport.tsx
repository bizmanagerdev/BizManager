"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ListIcon } from "@/components/ui/icons";
import { NativeSelect } from "@/components/ui/native-select";
import { SectionCard } from "@/components/ui/section-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SummaryCard } from "@/app/(app)/financial/FinancialPage.ui";
import {
  DEBT_KINDS,
  DEBT_KIND_LABEL,
  DEBT_SOON_DAYS,
  DEBT_TIMING_LABEL,
  addDaysIso,
  debtsByAccount,
  debtsByDomain,
  debtsByDueMonth,
  totalDebts,
  totalDebtsByKind,
  type DebtBreakdownRow,
  type DebtItem,
  type DebtTiming,
} from "@/lib/debts";
import { formatShortDate } from "@/lib/date";
import { accountOptions, domainOptions, filterDebts, type KindFilter } from "./debts.helpers";
import DebtsSections from "./DebtsSections";
import { formatIls } from "./shared";

// The דוח tab, in three layers and nothing else:
//   1. filters — kind, account, business area; everything below follows them;
//   2. five cards — the total, then by when it's due. Tap one to look at just
//      that money (tap it again to go back to everything);
//   3. one box that shows that money one way at a time — the debts themselves,
//      or totalled by kind, month, account or business area.

/** A summary card: every debt, or one timing bucket. */
type ReportBucket = "all" | DebtTiming;
type ReportView = "list" | "kind" | "month" | "account" | "domain";

// Short labels so all five fit across a phone.
const VIEWS: Array<{ key: ReportView; label: string }> = [
  { key: "list", label: "פירוט" },
  { key: "kind", label: "סוג" },
  { key: "month", label: "חודש" },
  { key: "account", label: "חשבון" },
  { key: "domain", label: "תחום" },
];

const BOX_ID = "debts-report-box";

function debtCount(count: number) {
  return count === 1 ? "חוב אחד" : `${count} חובות`;
}

/** One row per group: its name, how many debts, how much — and, while looking
 *  at everything, how much of it is already late. Totals at the bottom. */
function BreakdownList({ rows, showOverdue }: { rows: DebtBreakdownRow[]; showOverdue: boolean }) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">אין חובות כאן לסינון הזה.</div>;
  }
  const total = rows.reduce((sum, row) => sum + row.totals.open, 0);
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70">
      <div className="divide-y divide-border/50">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="font-medium">{row.label}</div>
              <div className="text-xs text-muted-foreground">
                {debtCount(row.totals.count)}
                {showOverdue && row.totals.overdue > 0.009 ? (
                  <span className="text-destructive">
                    {" · מזה באיחור "}
                    <span dir="ltr">{formatIls(row.totals.overdue)}</span>
                  </span>
                ) : null}
              </div>
            </div>
            <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
              {formatIls(row.totals.open)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-muted/30 px-3 py-2 text-sm font-semibold">
        <span>סה״כ</span>
        <span className="tabular-nums" dir="ltr">
          {formatIls(total)}
        </span>
      </div>
    </div>
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
  const [bucket, setBucket] = useState<ReportBucket>("all");
  const [view, setView] = useState<ReportView>("list");

  const accounts = useMemo(() => accountOptions(items, accountNames), [items, accountNames]);
  const domains = useMemo(() => domainOptions(items), [items]);
  const filtered = useMemo(
    () => filterDebts(items, { timing: "all", domain, search: "", kind, account }, todayIso),
    [items, domain, kind, account, todayIso]
  );
  const totals = useMemo(() => totalDebts(filtered, todayIso), [filtered, todayIso]);

  // The money behind the picked card — under the same filters as its figure,
  // narrowed to that timing (a series shows only its late part under
  // "באיחור"), so the box always adds up to the number on the card.
  const shown = useMemo(
    () =>
      bucket === "all" ? filtered : filterDebts(items, { timing: bucket, domain, search: "", kind, account }, todayIso),
    [bucket, filtered, items, domain, kind, account, todayIso]
  );
  const shownOpen = useMemo(() => shown.reduce((sum, item) => sum + item.open, 0), [shown]);

  const rows = useMemo<DebtBreakdownRow[]>(() => {
    if (view === "kind") {
      const byKind = totalDebtsByKind(shown, todayIso);
      return DEBT_KINDS.filter((k) => byKind[k].count > 0).map((k) => ({ key: k, label: DEBT_KIND_LABEL[k], totals: byKind[k] }));
    }
    if (view === "month") return debtsByDueMonth(shown, todayIso);
    if (view === "account") return debtsByAccount(shown, accountNames, todayIso);
    if (view === "domain") return debtsByDomain(shown, todayIso);
    return [];
  }, [view, shown, accountNames, todayIso]);

  const pick = (next: ReportBucket) => ({
    active: bucket === next,
    // Tapping the picked timing card again goes back to everything.
    onClick: () => setBucket((current) => (current === next && next !== "all" ? "all" : next)),
  });

  // On a phone the box sits below all five cards — after a tap, bring it into
  // view when it starts below the fold. Not on first load.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const box = document.getElementById(BOX_ID);
    if (box && box.getBoundingClientRect().top > window.innerHeight * 0.6) {
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [bucket]);

  const selectClass = "w-full sm:w-auto";
  const bucketLabel = bucket === "all" ? "כל החובות" : DEBT_TIMING_LABEL[bucket];

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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <SummaryCard
          title="סה״כ חובות"
          value={formatIls(totals.open)}
          description={`${totals.count} חובות פתוחים`}
          accent="destructive"
          {...pick("all")}
        />
        <SummaryCard
          title={DEBT_TIMING_LABEL.overdue}
          value={formatIls(totals.overdue)}
          description="עבר המועד ועדיין לא שולם"
          accent={totals.overdue > 0.009 ? "destructive" : "default"}
          {...pick("overdue")}
        />
        <SummaryCard
          title={DEBT_TIMING_LABEL.soon}
          value={formatIls(totals.soon)}
          description={`עד ${formatShortDate(addDaysIso(todayIso, DEBT_SOON_DAYS))}`}
          {...pick("soon")}
        />
        <SummaryCard
          title={DEBT_TIMING_LABEL.later}
          value={formatIls(totals.later)}
          description="מעבר לשבוע הקרוב"
          {...pick("later")}
        />
        <SummaryCard
          title={DEBT_TIMING_LABEL.undated}
          value={formatIls(totals.undated)}
          description="לא נקבע מתי לשלם"
          {...pick("undated")}
        />
      </div>

      <SectionCard
        id={BOX_ID}
        icon={<ListIcon className="h-4 w-4" />}
        title={`${bucketLabel} — ${debtCount(shown.length)} · ${formatIls(shownOpen)}`}
      >
        <Tabs dir="rtl" value={view} onValueChange={(value) => setView(value as ReportView)}>
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v.key} value={v.key}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="list" className="mt-3">
            <DebtsSections key={bucket} items={shown} emptyMessage="אין חובות כאן לסינון הזה." />
          </TabsContent>
          {VIEWS.filter((v) => v.key !== "list").map((v) => (
            <TabsContent key={v.key} value={v.key} className="mt-3 space-y-2">
              <BreakdownList rows={rows} showOverdue={bucket === "all"} />
              {v.key === "account" && shown.some((item) => item.kind === "wages") ? (
                <p className="text-xs text-muted-foreground">שכר עובדים משולם לכל עובד בנפרד ולכן מופיע תחת ״ללא חשבון״.</p>
              ) : null}
            </TabsContent>
          ))}
        </Tabs>
      </SectionCard>
    </div>
  );
}
