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
    .select("id,file_name,source,created_count,total_rows,created_at,marked_done")
    .order("created_at", { ascending: false })
    .limit(200);

  const baseStatements = (data ?? []) as Omit<StatementListItem, "expensesTotal" | "incomeTotal" | "chargesTotal">[];

  // Fetch row-level amounts so we can show money totals per statement on the list.
  type RowAmountRow = {
    statement_id: string;
    amount: number | null;
    expense_id: string | null;
    income_payment_id: string | null;
    expense: { amount: number | null } | { amount: number | null }[] | null;
    income_payment: { amount_total: number | null } | { amount_total: number | null }[] | null;
  };

  const statementIds = baseStatements.map((s) => s.id);
  const { data: rowData } = statementIds.length > 0
    ? await supabase
        .from("card_statement_rows")
        .select("statement_id,amount,expense_id,income_payment_id,expense:expenses(amount),income_payment:payments(amount_total)")
        .in("statement_id", statementIds)
    : { data: [] };

  // Aggregate per statement.
  const totals: Record<string, { expensesTotal: number; incomeTotal: number; chargesTotal: number }> = {};
  for (const r of (rowData ?? []) as RowAmountRow[]) {
    const sid = r.statement_id;
    if (!totals[sid]) totals[sid] = { expensesTotal: 0, incomeTotal: 0, chargesTotal: 0 };
    const rowAmount = Number(r.amount ?? 0);
    if (rowAmount > 0) totals[sid].chargesTotal += rowAmount;
    if (r.expense_id) {
      const live = Array.isArray(r.expense) ? r.expense[0] : r.expense;
      totals[sid].expensesTotal += Number(live?.amount ?? rowAmount);
    }
    if (r.income_payment_id) {
      const pay = Array.isArray(r.income_payment) ? r.income_payment[0] : r.income_payment;
      totals[sid].incomeTotal += Number(pay?.amount_total ?? 0);
    }
  }

  const statements: StatementListItem[] = baseStatements.map((s) => ({
    ...s,
    expensesTotal: totals[s.id]?.expensesTotal ?? 0,
    incomeTotal: totals[s.id]?.incomeTotal ?? 0,
    chargesTotal: totals[s.id]?.chargesTotal ?? 0,
  }));

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">פירוטי אשראי שנשמרו</h1>
            <p className="text-sm text-muted-foreground">
              כל פירוט שהועלה נשמר כאן — לחצ/י על שורה כדי לשייך תחומים, ליצור הוצאות ולערוך.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm">
              <Link href="/financial/import">העלאת פירוט חדש</Link>
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
