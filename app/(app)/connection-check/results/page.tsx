import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import PageTitle from "@/components/layout/PageTitle";
import { requireAdminPage } from "@/lib/auth/roleAccess";
import { Card, CardContent } from "@/components/ui/card";
import { formatShortDateTime } from "@/lib/date";

// TEMPORARY (2026-10-05) — admins only: every connection check people have run
// (/connection-check sends them here by itself), newest first, so the answer to
// "what do the phones' filters let through?" doesn't depend on anyone sending
// screenshots. Reads public.connection_checks (admin-only by RLS too).

type Row = {
  id: string;
  created_at: string;
  opened_in: string | null;
  user_agent: string | null;
  all_passed: boolean;
  results: Record<string, { status?: string; detail?: string }>;
  report: string | null;
  user: { full_name: string | null; email: string | null } | null;
};

// The checks that decide how data can sync, in the order the page runs them.
const COLUMNS: Array<{ id: string; label: string }> = [
  { id: "site", label: "האתר" },
  { id: "db", label: "מסד נתונים" },
  { id: "live", label: "חיבור חי (קיים)" },
  { id: "stream", label: "חיבור פתוח" },
  { id: "new", label: "כתובת חדשה" },
  { id: "newLive", label: "חיבור חי לכתובת חדשה" },
  { id: "powersync", label: "כתובת PowerSync" },
  { id: "powersyncLive", label: "סנכרון PowerSync" },
  { id: "storage", label: "אחסון במכשיר" },
  { id: "worker", label: "עבודה ברקע" },
  { id: "wasm", label: "WebAssembly" },
  { id: "files", label: "OPFS" },
];

const MARK: Record<string, string> = { pass: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };

function isMissingTable(error: { code?: string; message?: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205" || /connection_checks/.test(error?.message ?? "");
}

export default async function ConnectionCheckResultsPage() {
  const { profile, supabase } = await requireAdminPage();
  const { data, error } = await supabase
    .from("connection_checks")
    .select("id,created_at,opened_in,user_agent,all_passed,results,report,user:users(full_name,email)")
    .order("created_at", { ascending: false })
    .range(0, 499);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageTitle title="תוצאות בדיקת חיבור" subtitle={`${rows.length} בדיקות`} />
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            כל בדיקה שמישהו הריץ נשלחת לכאן לבד. ✅ עובד · ⚠️ עובד חלקית · ❌ חסום או נכשל.
          </p>
          <Link href="/connection-check" className="text-sm text-primary hover:underline">
            להריץ את הבדיקה כאן
          </Link>
        </div>

        {error ? (
          <Card>
            <CardContent className="p-4 text-sm">
              {isMissingTable(error)
                ? "טבלת התוצאות עדיין לא נוצרה במסד הנתונים — יש להריץ את קובץ ה-SQL של הבדיקה (20261005200000_connection_checks.sql). עד אז התוצאות נשמרות ב-Sentry."
                : `שגיאה בטעינת התוצאות: ${error.message}`}
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">עדיין אף אחד לא הריץ את הבדיקה.</CardContent>
          </Card>
        ) : (
          rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-semibold">
                    {row.all_passed ? "✅" : "⚠️"} {row.user?.full_name ?? row.user?.email ?? "משתמש"}
                    <span className="ms-2 text-sm font-normal text-muted-foreground">{row.opened_in ?? ""}</span>
                  </div>
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    {formatShortDateTime(row.created_at)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
                  {COLUMNS.map((column) => {
                    const result = row.results?.[column.id];
                    return (
                      <div key={column.id} className="flex items-center gap-1.5" title={result?.detail ?? ""}>
                        <span aria-hidden>{MARK[result?.status ?? ""] ?? "—"}</span>
                        <span className="text-muted-foreground">{column.label}</span>
                      </div>
                    );
                  })}
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">פרטים מלאים</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2" dir="rtl">
                    {row.report ?? ""}
                  </pre>
                  {row.user_agent ? (
                    <div className="mt-1 break-words text-muted-foreground" dir="ltr">
                      {row.user_agent}
                    </div>
                  ) : null}
                </details>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
