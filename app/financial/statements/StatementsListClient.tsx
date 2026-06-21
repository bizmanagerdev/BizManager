"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";

export type StatementListItem = {
  id: string;
  file_name: string | null;
  source: string | null;
  created_count: number | null;
  total_rows: number | null;
  created_at: string;
  marked_done: boolean | null;
  expensesTotal: number;
  incomeTotal: number;
  chargesTotal: number;
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

// Progress chip: an explicitly "done" statement wins; otherwise nothing created yet →
// awaiting assignment; some but not all → partial; all rows materialized → done.
function statusChip(created: number, total: number, markedDone: boolean) {
  if (markedDone) {
    return <span className="rounded bg-success-soft px-1.5 py-0.5 text-xs text-success-soft-foreground">בוצע</span>;
  }
  if (total > 0 && created >= total) {
    return <span className="rounded bg-success-soft px-1.5 py-0.5 text-xs text-success-soft-foreground">הושלם</span>;
  }
  if (created > 0) {
    return <span className="rounded bg-info-soft px-1.5 py-0.5 text-xs text-info-soft-foreground">חלקי</span>;
  }
  return <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning-soft-foreground">ממתין לשיוך</span>;
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
              <th className="px-3 py-2 font-medium">מקור</th>
              <th className="px-3 py-2 font-medium">סטטוס</th>
              <th className="px-3 py-2 font-medium">הוצאות שנוצרו</th>
              <th className="px-3 py-2 font-medium">סה"כ הוצאות</th>
              <th className="px-3 py-2 font-medium">סה"כ הכנסות</th>
              <th className="px-3 py-2 font-medium">סה"כ חיובים</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {statements.map((s) => {
              const created = s.created_count ?? 0;
              const total = s.total_rows ?? 0;
              return (
              <tr
                key={s.id}
                onClick={() => router.push(`/financial/statements/${s.id}`)}
                className="cursor-pointer hover:bg-muted/40"
              >
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(s.created_at)}</td>
                <td className="px-3 py-2">{s.file_name || "—"}</td>
                <td className="px-3 py-2">{s.source === "pdf" ? "PDF" : "Excel/CSV"}</td>
                <td className="px-3 py-2">{statusChip(created, total, s.marked_done === true)}</td>
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
                  {s.chargesTotal > 0 ? formatCurrency(s.chargesTotal) : "—"}
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
