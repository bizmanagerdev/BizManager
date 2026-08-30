import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { STORAGE_BUCKET } from "@/lib/storage";
import { propertyDisplayName } from "@/lib/properties";
import StatementDetailClient, { type StatementRowView } from "./StatementDetailClient";

export const dynamic = "force-dynamic";

type Option = { id: string; name: string };

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
};

export default async function CardStatementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const { data: statement } = await supabase
    .from("card_statements")
    .select("id,file_name,source,created_count,total_rows,created_at,storage_key,marked_done")
    .eq("id", id)
    .maybeSingle();
  if (!statement?.id) notFound();

  const [{ data: rowRows }, { data: projectRows }, { data: propertyRows }, { data: orderRows }, { data: chargeRows }, { data: mappingRows }] =
    await Promise.all([
      supabase
        .from("card_statement_rows")
        .select(
          "id,expense_id,income_payment_id,expense_date,transaction_date,amount,description,category,card_label,business_domain,project_id,property_id,notes,assignment_raw,include," +
            "expense:expenses(id,amount,category,description,business_domain,project_id,property_id,expense_date,transaction_date,notes)," +
            "income_payment:payments(id,amount_total)"
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
        .select("id,card_label,account_id,amount,charge_date,notes")
        .eq("statement_id", id),
      // Remembered card → account choice, for pre-filling a card that hasn't been charged yet.
      supabase.from("card_account_mappings").select("card_key,account_id"),
    ]);

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

  // Prefer the live expense (source of truth); fall back to the import snapshot.
  const rows: StatementRowView[] = ((rowRows ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const embed = r.expense as LiveExpense | LiveExpense[] | null;
    const live = (Array.isArray(embed) ? embed[0] : embed) ?? null;
    const expenseExists = Boolean(r.expense_id) && Boolean(live?.id);
    const incEmbed = r.income_payment as { id?: string; amount_total?: number | string | null } | { id?: string; amount_total?: number | string | null }[] | null;
    const incPay = (Array.isArray(incEmbed) ? incEmbed[0] : incEmbed) ?? null;
    const incomePaymentId = typeof r.income_payment_id === "string" ? r.income_payment_id : null;
    const incomeExists = Boolean(incomePaymentId) && Boolean(incPay?.id);
    return {
      id: String(r.id),
      expenseId: typeof r.expense_id === "string" ? r.expense_id : null,
      expenseExists,
      expenseDate: String((live?.expense_date ?? r.expense_date ?? "") || "").slice(0, 10),
      transactionDate: String((live?.transaction_date ?? r.transaction_date ?? "") || "").slice(0, 10),
      amount: Number(live?.amount ?? r.amount ?? 0),
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
      incomeAmount: Number(incPay?.amount_total ?? 0),
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
    }));
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
        }}
        rows={rows}
        projects={projects}
        properties={properties}
        orders={orders}
        fileUrl={fileUrl}
        cardCharges={cardCharges}
        cardAccountDefaults={cardAccountDefaults}
      />
    </AppShell>
  );
}
