import Link from "next/link";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth/requireProfile";
import StatementsListClient, { type StatementListItem } from "./StatementsListClient";

export const dynamic = "force-dynamic";

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

  const statements = (data ?? []) as StatementListItem[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">דפי אשראי שיובאו</h1>
            <p className="text-sm text-muted-foreground">כל ייבוא נשמר כאן — לחצ/י על שורה כדי לפתוח ולערוך.</p>
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

        <StatementsListClient statements={statements} />
      </div>
    </AppShell>
  );
}
