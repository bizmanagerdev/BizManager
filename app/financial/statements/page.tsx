import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth/requireProfile";

export const dynamic = "force-dynamic";

type StatementRow = {
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

export default async function CardStatementsPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const { data } = await supabase
    .from("card_statements")
    .select("id,file_name,source,created_count,total_rows,created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const statements = (data ?? []) as StatementRow[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">דפי אשראי שיובאו</h1>
            <p className="text-sm text-muted-foreground">כל ייבוא נשמר כאן — ניתן לפתוח דף ולערוך שורה.</p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href="/financial/import">ייבוא חדש</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/financial">חזרה לפיננסי</Link>
            </Button>
          </div>
        </div>

        {statements.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              עדיין לא יובאו דפי אשראי.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr className="text-right">
                    <th className="px-3 py-2 font-medium">תאריך ייבוא</th>
                    <th className="px-3 py-2 font-medium">קובץ</th>
                    <th className="px-3 py-2 font-medium">מקור</th>
                    <th className="px-3 py-2 font-medium">הוצאות שנוצרו</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {statements.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/40">
                      <td className="whitespace-nowrap px-3 py-2">{formatDateTime(s.created_at)}</td>
                      <td className="px-3 py-2">{s.file_name || "—"}</td>
                      <td className="px-3 py-2">{s.source === "pdf" ? "PDF" : "Excel/CSV"}</td>
                      <td className="px-3 py-2">
                        {s.created_count ?? 0}
                        {typeof s.total_rows === "number" && s.total_rows !== (s.created_count ?? 0)
                          ? ` מתוך ${s.total_rows}`
                          : ""}
                      </td>
                      <td className="px-3 py-2 text-left">
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/financial/statements/${s.id}`}>פתח</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
