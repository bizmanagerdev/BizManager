// Aliased: this route also exports its own `dynamic` (route-segment config,
// below) which would otherwise collide with next/dynamic's default export.
import nextDynamic from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { STORAGE_BUCKET } from "@/lib/storage";
import { propertyDisplayName } from "@/lib/properties";
import { loadAccountBalanceOn } from "@/lib/accounts";
import { isForeignCurrency, type CurrencyCode } from "@/lib/fx/currencies";
import type { StatementRowView } from "./StatementDetailClient";
import StatementDetailSkeleton from "./StatementDetailSkeleton";

// The same placeholder as loading.tsx while the client's code loads.
const StatementDetailClient = nextDynamic(() => import("./StatementDetailClient"), {
  loading: () => <StatementDetailSkeleton />,
});

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

/** A day moved by n days ("2026-08-24", -15 → "2026-08-09"). */
function shiftDay(day: string, n: number): string {
  const t = Date.parse(`${day.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + n * 86_400_000).toISOString().slice(0, 10) : day;
}

type CashTransfer = { id: string; to_account_id: string | null; transfer_date: string | null };

type AccountRow = { id: string; name: string; kind: string | null; is_active: boolean | null; currency: string | null };

// A US card statement's transfer: a payment into the card, or cash out of it.
type TransferRow = {
  id: string;
  from_account_id: string | null;
  to_account_id: string | null;
  transfer_date: string | null;
  from_amount: number | string | null;
  to_amount: number | string | null;
};

type LiveExpense = {
  id: string;
  amount: number | null;
  category: string | null;
  description: string | null;
  business_domain: string | null;
  project_id: string | null;
  property_id: string | null;
  expense_date: string | null;
  transaction_date: string | null;
  notes: string | null;
  account_id: string | null;
  currency?: string | null;
  foreign_amount?: number | string | null;
};

export default async function CardStatementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const { data: statement } = await supabase
    .from("card_statements")
    .select(
      "id,file_name,source,created_count,total_rows,created_at,storage_key,marked_done,card_account_id,currency,period_start,period_end,payment_due_date,previous_balance,new_balance"
    )
    .eq("id", id)
    .maybeSingle();
  if (!statement?.id) notFound();
  // A US card kept as its own account (2026-10-25): its lines are in the card's
  // currency, its payments and cash are transfers, and there is no bank charge.
  const cardAccountId = typeof statement.card_account_id === "string" ? statement.card_account_id : null;
  const statementCurrency: CurrencyCode =
    cardAccountId && isForeignCurrency(String(statement.currency ?? "").toUpperCase())
      ? (String(statement.currency).toUpperCase() as CurrencyCode)
      : "ILS";

  const [
    { data: rowRows },
    { data: projectRows },
    { data: propertyRows },
    { data: orderRows },
    { data: chargeRows },
    { data: mappingRows },
    { data: accountRows },
    billingResult,
  ] = await Promise.all([
      supabase
        .from("card_statement_rows")
        .select(
          "id,expense_id,income_payment_id,expense_date,transaction_date,amount,description,category,card_label,business_domain,project_id,property_id,notes,assignment_raw,include,line_kind,transfer_id," +
            "expense:expenses(id,amount,category,description,business_domain,project_id,property_id,expense_date,transaction_date,notes,account_id,currency,foreign_amount)," +
            "income_payment:payments(id,amount_total,currency,foreign_amount)," +
            // "מול מזומן": the cash entry a line put in the cash box (one per line).
            "cash_transfer:account_transfers(id,to_account_id,transfer_date)"
        )
        .eq("statement_id", id)
        .order("row_index", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      supabase.from("projects").select("id,name").order("name", { ascending: true }),
      supabase.from("properties").select("id,name,address").order("address", { ascending: true }),
      // Orders for the income source picker — labeled by customer + date (orders have no number).
      supabase
        .from("orders")
        .select("id,order_date,customer:customers(name)")
        .order("order_date", { ascending: false })
        .limit(500),
      // This statement's own lump-sum bank charges (one per card, if recorded).
      supabase
        .from("card_statement_charges")
        .select("id,card_label,account_id,amount,charge_date,notes,created_at")
        .eq("statement_id", id),
      // Remembered card → account choice, for pre-filling a card that hasn't been charged yet.
      supabase.from("card_account_mappings").select("card_key,account_id"),
      supabase.from("accounts").select("id,name,kind,is_active,currency"),
      // "לחיוב לקוח" waits on its own column (migration 20261013120000). Asked apart from
      // the rows so the page keeps working before that migration runs — the tick just hides.
      supabase.from("card_statement_rows").select("id,bill_to_customer").eq("statement_id", id),
    ]);
  const billToCustomerAvailable = !billingResult.error;
  const billedDraftRows = new Set(
    ((billingResult.data ?? []) as Array<{ id: string; bill_to_customer: boolean | null }>)
      .filter((r) => r.bill_to_customer === true)
      .map((r) => r.id)
  );

  const projects: Option[] = ((projectRows ?? []) as Option[]).filter(
    (r) => typeof r.id === "string" && typeof r.name === "string"
  );
  const properties: Option[] = ((propertyRows ?? []) as { id: string; name: string | null; address: string }[])
    .filter((r) => typeof r.id === "string" && typeof r.address === "string")
    .map((r) => ({ id: r.id, name: propertyDisplayName(r) }));
  const orders: Option[] = ((orderRows ?? []) as Record<string, unknown>[])
    .filter((r) => typeof r.id === "string")
    .map((r) => {
      const cust = r.customer as { name?: string } | { name?: string }[] | null;
      const custName = (Array.isArray(cust) ? cust[0]?.name : cust?.name) ?? "";
      const date = String(r.order_date ?? "").slice(0, 10);
      const label = [custName || "הזמנה", date].filter(Boolean).join(" · ");
      return { id: String(r.id), name: label };
    });

  // A recorded line's billing lives on its project link; a draft's on the row.
  const liveExpenseIds = ((rowRows ?? []) as unknown as Array<{ expense_id: string | null }>)
    .map((r) => r.expense_id)
    .filter((v): v is string => typeof v === "string");
  const { data: linkRows } =
    billToCustomerAvailable && liveExpenseIds.length > 0
      ? await supabase.from("project_expenses").select("expense_id,billed_to_customer").in("expense_id", liveExpenseIds)
      : { data: [] };
  const billedExpenses = new Set(
    ((linkRows ?? []) as Array<{ expense_id: string; billed_to_customer: boolean | null }>)
      .filter((l) => l.billed_to_customer === true)
      .map((l) => l.expense_id)
  );

  // A US card's statement: the transfers its lines are (payments in, cash out),
  // the payments into the card not linked to a line yet (entered from the
  // bank's side), and the card's balance on the closing day.
  const linkedTransferIds = ((rowRows ?? []) as unknown as Array<{ transfer_id?: string | null }>)
    .map((r) => r.transfer_id)
    .filter((v): v is string => typeof v === "string");
  const periodStart = typeof statement.period_start === "string" ? statement.period_start : null;
  const periodEnd = typeof statement.period_end === "string" ? statement.period_end : null;
  const [{ data: linkedTransferRows }, { data: candidateRows }, cardBalanceOnClose] = await Promise.all([
    cardAccountId && linkedTransferIds.length > 0
      ? supabase
          .from("account_transfers")
          .select("id,from_account_id,to_account_id,transfer_date,from_amount,to_amount")
          .in("id", linkedTransferIds)
      : Promise.resolve({ data: [] as TransferRow[] }),
    cardAccountId
      ? supabase
          .from("account_transfers")
          .select("id,from_account_id,to_account_id,transfer_date,from_amount,to_amount")
          .eq("to_account_id", cardAccountId)
          .gte("transfer_date", shiftDay(periodStart ?? periodEnd ?? "2000-01-01", -15))
          .lte("transfer_date", shiftDay(periodEnd ?? periodStart ?? "2100-01-01", 15))
      : Promise.resolve({ data: [] as TransferRow[] }),
    cardAccountId && periodEnd ? loadAccountBalanceOn(supabase, cardAccountId, periodEnd) : Promise.resolve(null),
  ]);
  const transferById = new Map(((linkedTransferRows ?? []) as TransferRow[]).map((t) => [t.id, t] as const));
  // Linked to a line on ANY statement — those can't be linked again.
  const candidateList = (candidateRows ?? []) as TransferRow[];
  const { data: takenRows } =
    candidateList.length > 0
      ? await supabase.from("card_statement_rows").select("transfer_id").in("transfer_id", candidateList.map((t) => t.id))
      : { data: [] };
  const taken = new Set(((takenRows ?? []) as Array<{ transfer_id: string | null }>).map((r) => r.transfer_id));
  const paymentCandidates = candidateList
    .filter((t) => !taken.has(t.id))
    .map((t) => ({
      id: t.id,
      fromAccountId: t.from_account_id ?? "",
      date: String(t.transfer_date ?? "").slice(0, 10),
      amount: Number(t.to_amount ?? 0),
    }));

  // Prefer the live expense (source of truth); fall back to the import snapshot.
  const rows: StatementRowView[] = ((rowRows ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const embed = r.expense as LiveExpense | LiveExpense[] | null;
    const live = (Array.isArray(embed) ? embed[0] : embed) ?? null;
    const expenseExists = Boolean(r.expense_id) && Boolean(live?.id);
    const incEmbed = r.income_payment as { id?: string; amount_total?: number | string | null } | { id?: string; amount_total?: number | string | null }[] | null;
    const incPay = (Array.isArray(incEmbed) ? incEmbed[0] : incEmbed) ?? null;
    const incomePaymentId = typeof r.income_payment_id === "string" ? r.income_payment_id : null;
    const incomeExists = Boolean(incomePaymentId) && Boolean(incPay?.id);
    const cashEmbed = r.cash_transfer as CashTransfer | CashTransfer[] | null;
    const israeliCash = (Array.isArray(cashEmbed) ? cashEmbed[0] : cashEmbed) ?? null;
    const lineKind = r.line_kind === "payment" || r.line_kind === "cash_advance" ? r.line_kind : "charge";
    // A US card's line points at its transfer itself (a payment in, or cash out).
    const transfer = typeof r.transfer_id === "string" ? transferById.get(r.transfer_id) ?? null : null;
    const cash: CashTransfer | null =
      cardAccountId && lineKind !== "payment"
        ? transfer && { id: transfer.id, to_account_id: transfer.to_account_id, transfer_date: transfer.transfer_date }
        : israeliCash;
    // The live expense's own money in the statement's currency — its dollars on a US card.
    const liveAmount =
      live && cardAccountId && String(live.currency ?? "").toUpperCase() === statementCurrency && live.foreign_amount != null
        ? Number(live.foreign_amount)
        : live?.amount;
    const incomeAmount =
      incPay && cardAccountId && String((incPay as { currency?: string }).currency ?? "").toUpperCase() === statementCurrency
        ? Number((incPay as { foreign_amount?: number | string | null }).foreign_amount ?? 0)
        : Number(incPay?.amount_total ?? 0);
    return {
      id: String(r.id),
      expenseId: typeof r.expense_id === "string" ? r.expense_id : null,
      expenseExists,
      expenseDate: String((live?.expense_date ?? r.expense_date ?? "") || "").slice(0, 10),
      transactionDate: String((live?.transaction_date ?? r.transaction_date ?? "") || "").slice(0, 10),
      amount: Number(liveAmount ?? r.amount ?? 0),
      description: String(live?.description ?? r.description ?? ""),
      category: String(live?.category ?? r.category ?? ""),
      // Stable card identity — falls back to category for a pre-migration row.
      cardLabel: String((r.card_label ?? r.category ?? "") || ""),
      businessDomain: String(live?.business_domain ?? r.business_domain ?? ""),
      projectId: String((live?.project_id ?? r.project_id ?? "") || ""),
      propertyId: String((live?.property_id ?? r.property_id ?? "") || ""),
      notes: String((live?.notes ?? r.notes ?? "") || ""),
      // Statement-row-only fields (never on the live expense).
      assignmentRaw: String((r.assignment_raw ?? "") || ""),
      include: r.include !== false,
      incomePaymentId,
      incomeExists,
      incomeAmount,
      expenseAccountId: expenseExists && typeof live?.account_id === "string" ? live.account_id : null,
      billToCustomer: expenseExists ? billedExpenses.has(String(r.expense_id)) : billedDraftRows.has(String(r.id)),
      cashTransferId: cash?.id ?? null,
      cashAccountId: cash?.to_account_id ?? null,
      cashDate: String(cash?.transfer_date ?? "").slice(0, 10),
      lineKind,
      paymentTransferId: lineKind === "payment" ? transfer?.id ?? null : null,
      paymentFromAccountId: lineKind === "payment" ? transfer?.from_account_id ?? null : null,
      paymentDate: lineKind === "payment" ? String(transfer?.transfer_date ?? "").slice(0, 10) : "",
    };
  });

  let fileUrl: string | null = null;
  if (typeof statement.storage_key === "string" && statement.storage_key) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(statement.storage_key, 60 * 60);
    fileUrl = signed?.signedUrl ?? null;
  }

  const cardCharges = ((chargeRows ?? []) as Record<string, unknown>[])
    .filter((r) => typeof r.id === "string")
    .map((r) => ({
      id: String(r.id),
      cardLabel: String(r.card_label ?? ""),
      accountId: String(r.account_id ?? ""),
      amount: Number(r.amount ?? 0),
      chargeDate: String(r.charge_date ?? "").slice(0, 10),
      notes: typeof r.notes === "string" ? r.notes : null,
      createdAt: typeof r.created_at === "string" ? r.created_at : null,
    }));
  const accounts = ((accountRows ?? []) as AccountRow[]).filter((a) => typeof a.id === "string" && typeof a.name === "string");
  const cardAccountDefaults: Record<string, string> = {};
  for (const r of (mappingRows ?? []) as Record<string, unknown>[]) {
    const key = typeof r.card_key === "string" ? r.card_key : "";
    const accountId = typeof r.account_id === "string" ? r.account_id : "";
    if (key && accountId) cardAccountDefaults[key] = accountId;
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <StatementDetailClient
        statement={{
          id: String(statement.id),
          fileName: String(statement.file_name ?? ""),
          source: statement.source === "pdf" ? "pdf" : "excel",
          createdCount: Number(statement.created_count ?? 0),
          totalRows: Number(statement.total_rows ?? 0),
          createdAt: String(statement.created_at ?? ""),
          markedDone: statement.marked_done === true,
          cardAccount: cardAccountId
            ? {
                id: cardAccountId,
                name: accounts.find((a) => a.id === cardAccountId)?.name ?? "כרטיס",
                currency: statementCurrency,
                periodStart,
                periodEnd,
                dueDate: typeof statement.payment_due_date === "string" ? statement.payment_due_date : null,
                previousBalance: statement.previous_balance == null ? null : Number(statement.previous_balance),
                newBalance: statement.new_balance == null ? null : Number(statement.new_balance),
                // What we owe it: the account's balance is negative while we owe.
                balanceOnClose: cardBalanceOnClose,
              }
            : null,
        }}
        paymentCandidates={paymentCandidates}
        rows={rows}
        projects={projects}
        properties={properties}
        orders={orders}
        fileUrl={fileUrl}
        cardCharges={cardCharges}
        cardAccountDefaults={cardAccountDefaults}
        accounts={accounts}
        cashAccountId={accounts.find((a) => a.kind === "cash" && a.is_active !== false)?.id ?? null}
        billToCustomerAvailable={billToCustomerAvailable}
      />
    </AppShell>
  );
}
