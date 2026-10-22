"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatShortDateTime } from "@/lib/date";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchIcon } from "@/components/ui/icons";
import { Painted, SearchReasons, SearchTermsProvider } from "@/components/search/Painted";
import type { GlobalSearchReason } from "@/lib/global-search";
import { searchList, type SearchRecord } from "@/lib/search/listSearch";
import { findStatementsByLines } from "./actions";
import type { StatementSteps } from "@/lib/financial/cardStatementMath";
import { DifferenceChip, StatusChip } from "./[id]/StatementSteps";

export type StatementListItem = {
  id: string;
  file_name: string | null;
  source: string | null;
  created_count: number | null;
  total_rows: number | null;
  created_at: string;
  /** Who uploaded it (card_statements.imported_by → name). */
  importedByName: string | null;
  marked_done: boolean | null;
  expensesTotal: number;
  incomeTotal: number;
  /** Money per card and where the statement stands — the statement page's own rules. */
  steps: StatementSteps;
  /** The bank account(s) its cards were charged to. */
  bankAccounts: string[];
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
}


// The list's search (owner, 2026-10-19: "credit-card statement lines … no
// search"): a statement is found by what its row shows — the file, the upload
// day, who uploaded it, its totals, its bank accounts — and by any of its lines
// (findStatementsByLines: a merchant, an amount, a day), said under it.
function statementSearchRecord(s: StatementListItem): SearchRecord {
  return {
    text: [
      [null, s.file_name],
      [null, s.importedByName],
      [null, s.bankAccounts.join(" · ")],
      [null, s.source === "pdf" ? "PDF" : "Excel"],
    ],
    amounts: [
      [null, s.expensesTotal],
      [null, s.incomeTotal],
      [null, s.steps.totals.bill],
      [null, s.steps.totals.charged],
    ],
    dates: [[null, s.created_at]],
  };
}

export default function StatementsListClient({ statements }: { statements: StatementListItem[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const found = useMemo(() => searchList(statements, statementSearchRecord, deferredSearch), [statements, deferredSearch]);
  // The lines are on the server: asked a moment after typing stops.
  const [lineMatches, setLineMatches] = useState<{
    query: string;
    byStatement: Record<string, { count: number; reason: GlobalSearchReason }>;
  } | null>(null);
  useEffect(() => {
    const query = deferredSearch.trim();
    if (!query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      findStatementsByLines(query)
        .then((byStatement) => {
          if (!cancelled) setLineMatches({ query, byStatement });
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deferredSearch]);
  const lines = found && lineMatches?.query === deferredSearch.trim() ? lineMatches.byStatement : {};
  const shown = found ? statements.filter((s) => found.reasons.has(s) || lines[s.id]) : statements;
  const reasonsFor = (s: StatementListItem): GlobalSearchReason[] => {
    const line = lines[s.id];
    if (!line) return found?.reasons.get(s) ?? [];
    const more = line.count > 1 ? { ...line.reason, label: `${line.count} שורות, למשל` } : line.reason;
    return [...(found?.reasons.get(s) ?? []), more];
  };

  if (statements.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          עדיין לא הועלו פירוטי אשראי.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
    <div className="relative md:w-96">
      <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חיפוש בפירוטים — בית עסק, סכום, תאריך, קובץ..."
        aria-label="חיפוש בפירוטי האשראי"
        className="h-10 ps-9"
      />
    </div>
    {found && shown.length === 0 ? (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">לא נמצאו פירוטים לחיפוש הזה.</CardContent>
      </Card>
    ) : (
    <SearchTermsProvider terms={found?.search.terms ?? null}>
    <Card className="overflow-hidden">
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr className="text-right">
              <th className="px-3 py-2 font-medium">תאריך העלאה</th>
              <th className="px-3 py-2 font-medium">קובץ</th>
              <th className="px-3 py-2 font-medium">סטטוס</th>
              <th className="px-3 py-2 font-medium">הוצאות שנוצרו</th>
              <th className="px-3 py-2 font-medium">סה״כ הוצאות</th>
              <th className="px-3 py-2 font-medium">סה״כ הכנסות</th>
              <th className="px-3 py-2 font-medium">סה״כ שורות</th>
              <th className="px-3 py-2 font-medium">חיוב בבנק</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((s) => {
              const created = s.created_count ?? 0;
              const total = s.total_rows ?? 0;
              const { totals, bank } = s.steps;
              return (
                <tr
                  key={s.id}
                  onClick={() => router.push(`/financial/statements/${s.id}`)}
                  className="cursor-pointer hover:bg-muted/40"
                >
                  <td className="whitespace-nowrap px-3 py-2">
                    <span dir="ltr"><Painted text={formatShortDateTime(s.created_at)} /></span>
                    {s.importedByName ? (
                      <div className="text-[11px] text-muted-foreground/70">הועלה ע״י <Painted text={s.importedByName} /></div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {s.file_name ? <Painted text={s.file_name} /> : "—"}
                    <span className="ms-1 text-xs text-muted-foreground">{s.source === "pdf" ? "PDF" : "Excel"}</span>
                    <SearchReasons reasons={reasonsFor(s)} className="mt-0.5" />
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip steps={s.steps} markedDone={s.marked_done === true} />
                  </td>
                  <td className="px-3 py-2">
                    {created}
                    {total !== created ? ` מתוך ${total}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {s.expensesTotal > 0 ? <Painted text={formatCurrency(s.expensesTotal)} /> : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-success-soft-foreground">
                    {s.incomeTotal > 0 ? <Painted text={formatCurrency(s.incomeTotal)} /> : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {totals.bill !== 0 ? <Painted text={formatCurrency(totals.bill)} /> : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {totals.charged > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="whitespace-nowrap font-medium"><Painted text={formatCurrency(totals.charged)} /></span>
                        <DifferenceChip difference={totals.difference} />
                      </div>
                    ) : null}
                    {s.bankAccounts.length > 0 ? (
                      <div className="text-xs text-muted-foreground"><Painted text={s.bankAccounts.join(" · ")} /></div>
                    ) : null}
                    {totals.countedTwice > 0 ? (
                      <div className="text-xs text-warning-soft-foreground" title="שורות שרשומות גם כהוצאה שיורדת מחשבון בנק בנפרד">
                        נספר פעמיים: {formatCurrency(totals.countedTwice)}
                      </div>
                    ) : null}
                    {bank.missingCards.length > 0 && s.marked_done !== true ? (
                      <div className="text-xs text-warning-soft-foreground">חסר: {bank.missingCards.join(", ")}</div>
                    ) : totals.charged > 0 ? null : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
    </SearchTermsProvider>
    )}
    </div>
  );
}
