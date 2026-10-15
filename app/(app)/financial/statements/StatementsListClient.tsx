"use client";

import { useRouter } from "next/navigation";
import { formatShortDateTime } from "@/lib/date";
import { Card, CardContent } from "@/components/ui/card";
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


export default function StatementsListClient({ statements }: { statements: StatementListItem[] }) {
  const router = useRouter();

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
            {statements.map((s) => {
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
                    <span dir="ltr">{formatShortDateTime(s.created_at)}</span>
                    {s.importedByName ? (
                      <div className="text-[11px] text-muted-foreground/70">הועלה ע״י {s.importedByName}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {s.file_name || "—"}
                    <span className="ms-1 text-xs text-muted-foreground">{s.source === "pdf" ? "PDF" : "Excel"}</span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip steps={s.steps} markedDone={s.marked_done === true} />
                  </td>
                  <td className="px-3 py-2">
                    {created}
                    {total !== created ? ` מתוך ${total}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {s.expensesTotal > 0 ? formatCurrency(s.expensesTotal) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-success-soft-foreground">
                    {s.incomeTotal > 0 ? formatCurrency(s.incomeTotal) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {totals.bill !== 0 ? formatCurrency(totals.bill) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {totals.charged > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="whitespace-nowrap font-medium">{formatCurrency(totals.charged)}</span>
                        <DifferenceChip difference={totals.difference} />
                      </div>
                    ) : null}
                    {s.bankAccounts.length > 0 ? (
                      <div className="text-xs text-muted-foreground">{s.bankAccounts.join(" · ")}</div>
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
  );
}
