import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { resolveUserDisplayNamesForValues } from "@/lib/audit";
import { loadCardCostsByMonth } from "@/lib/financial/cardCosts";
import { summarizeStatement, type StatementMathCharge, type StatementMathRow } from "@/lib/financial/cardStatementMath";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { type StatementListItem } from "./StatementsListClient";
import CardsPageClient from "./CardsPageClient";

export const dynamic = "force-dynamic";

export default async function CardStatementsPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const { data } = await supabase
    .from("card_statements")
    .select("id,file_name,source,created_count,total_rows,created_at,marked_done,imported_by")
    .order("created_at", { ascending: false })
    .limit(200);

  const baseStatements = (data ?? []) as Array<
    Omit<StatementListItem, "expensesTotal" | "incomeTotal" | "steps" | "bankAccounts" | "importedByName"> & {
      imported_by: string | null;
    }
  >;

  // Row-level amounts for the money columns and each statement's steps (same rules as the
  // statement page — lib/financial/cardStatementMath.ts). Paged: the lines of every
  // statement pass the database's 1000-row answer cap, and the rest used to vanish quietly.
  type RowAmountRow = {
    id: string;
    statement_id: string;
    card_label: string | null;
    category: string | null;
    amount: number | string | null;
    include: boolean | null;
    expense_date: string | null;
    business_domain: string | null;
    expense_id: string | null;
    income_payment_id: string | null;
    expense: { id: string; amount: number | null; account_id: string | null } | { id: string; amount: number | null; account_id: string | null }[] | null;
    income_payment: { amount_total: number | null } | { amount_total: number | null }[] | null;
  };

  const statementIds = baseStatements.map((s) => s.id);
  // Who uploaded each statement, beside its upload time (owner, 2026-10-15).
  // The import route writes the login id there; user_labels() resolves a user id
  // or a login id alike, for every statement in one call.
  const importerNamesPromise = resolveUserDisplayNamesForValues(
    supabase,
    baseStatements.map((s) => s.imported_by).filter((v): v is string => Boolean(v))
  ).catch(() => ({}) as Record<string, string>);
  const [rowData, chargeData] =
    statementIds.length > 0
      ? await Promise.all([
          fetchAllPaged<RowAmountRow>((from, to) =>
            supabase
              .from("card_statement_rows")
              .select(
                "id,statement_id,card_label,category,amount,include,expense_date,business_domain,expense_id,income_payment_id," +
                  "expense:expenses(id,amount,account_id),income_payment:payments(amount_total)"
              )
              .in("statement_id", statementIds)
              .order("id")
              .range(from, to)
          ).catch(() => [] as RowAmountRow[]),
          supabase
            .from("card_statement_charges")
            .select("id,statement_id,card_label,amount,charge_date,account_id,account:accounts(name)")
            .in("statement_id", statementIds)
            .then((r) => (r.data ?? []) as Array<Record<string, unknown>>),
        ])
      : [[] as RowAmountRow[], [] as Array<Record<string, unknown>>];

  const totals: Record<string, { expensesTotal: number; incomeTotal: number }> = {};
  const mathRows = new Map<string, StatementMathRow[]>();
  for (const r of rowData) {
    const sid = r.statement_id;
    if (!totals[sid]) totals[sid] = { expensesTotal: 0, incomeTotal: 0 };
    const rowAmount = Number(r.amount ?? 0);
    const live = Array.isArray(r.expense) ? r.expense[0] : r.expense;
    const pay = Array.isArray(r.income_payment) ? r.income_payment[0] : r.income_payment;
    if (r.expense_id) totals[sid].expensesTotal += Number(live?.amount ?? rowAmount);
    if (r.income_payment_id) totals[sid].incomeTotal += Number(pay?.amount_total ?? 0);
    const list = mathRows.get(sid) ?? [];
    list.push({
      id: r.id,
      cardLabel: r.card_label ?? r.category ?? "",
      amount: Number(live?.amount ?? rowAmount),
      include: r.include !== false,
      expenseDate: String(r.expense_date ?? "").slice(0, 10),
      businessDomain: r.business_domain ?? "",
      expenseId: r.expense_id,
      expenseExists: Boolean(r.expense_id && live?.id),
      expenseAccountId: r.expense_id && live?.account_id ? live.account_id : null,
      incomePaymentId: r.income_payment_id,
      incomeExists: Boolean(r.income_payment_id && pay),
    });
    mathRows.set(sid, list);
  }
  const mathCharges = new Map<string, StatementMathCharge[]>();
  // Which bank account(s) each statement's cards were charged to (owner, 2026-10-14:
  // "I want to see the account here").
  const bankAccounts = new Map<string, Set<string>>();
  for (const c of chargeData) {
    const sid = String(c.statement_id ?? "");
    const account = (Array.isArray(c.account) ? c.account[0] : c.account) as { name?: string } | null | undefined;
    if (account?.name) bankAccounts.set(sid, (bankAccounts.get(sid) ?? new Set<string>()).add(account.name));
    const list = mathCharges.get(sid) ?? [];
    list.push({
      id: String(c.id ?? ""),
      cardLabel: String(c.card_label ?? ""),
      amount: Number(c.amount ?? 0),
      chargeDate: String(c.charge_date ?? "").slice(0, 10),
      accountId: String(c.account_id ?? ""),
    });
    mathCharges.set(sid, list);
  }

  const importerNames = await importerNamesPromise;
  const statements: StatementListItem[] = baseStatements.map(({ imported_by, ...s }) => ({
    ...s,
    importedByName: imported_by ? importerNames[imported_by] ?? null : null,
    expensesTotal: totals[s.id]?.expensesTotal ?? 0,
    incomeTotal: totals[s.id]?.incomeTotal ?? 0,
    steps: summarizeStatement(mathRows.get(s.id) ?? [], mathCharges.get(s.id) ?? []),
    bankAccounts: [...(bankAccounts.get(s.id) ?? [])].sort((a, b) => a.localeCompare(b, "he")),
  }));

  const cardCosts = await loadCardCostsByMonth(supabase);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <CardsPageClient report={cardCosts} statements={statements} />
      </div>
    </AppShell>
  );
}
