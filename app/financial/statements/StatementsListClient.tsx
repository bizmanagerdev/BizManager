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
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

export default function StatementsListClient({ statements }: { statements: StatementListItem[] }) {
  const router = useRouter();

  if (statements.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          עדיין לא יובאו דפי אשראי.
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
              <th className="px-3 py-2 font-medium">תאריך ייבוא</th>
              <th className="px-3 py-2 font-medium">קובץ</th>
              <th className="px-3 py-2 font-medium">מקור</th>
              <th className="px-3 py-2 font-medium">הוצאות שנוצרו</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {statements.map((s) => (
              <tr
                key={s.id}
                onClick={() => router.push(`/financial/statements/${s.id}`)}
                className="cursor-pointer hover:bg-muted/40"
              >
                <td className="whitespace-nowrap px-3 py-2">{formatDateTime(s.created_at)}</td>
                <td className="px-3 py-2">{s.file_name || "—"}</td>
                <td className="px-3 py-2">{s.source === "pdf" ? "PDF" : "Excel/CSV"}</td>
                <td className="px-3 py-2">
                  {s.created_count ?? 0}
                  {typeof s.total_rows === "number" && s.total_rows !== (s.created_count ?? 0)
                    ? ` מתוך ${s.total_rows}`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
