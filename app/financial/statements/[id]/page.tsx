import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
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
    .select("id,file_name,source,created_count,total_rows,created_at,storage_key")
    .eq("id", id)
    .maybeSingle();
  if (!statement?.id) notFound();

  const [{ data: rowRows }, { data: projectRows }, { data: propertyRows }] = await Promise.all([
    supabase
      .from("card_statement_rows")
      .select(
        "id,expense_id,expense_date,transaction_date,amount,description,category,business_domain,project_id,property_id,notes," +
          "expense:expenses(id,amount,category,description,business_domain,project_id,property_id,expense_date,transaction_date,notes)"
      )
      .eq("statement_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("projects").select("id,name").order("name", { ascending: true }),
    supabase.from("properties").select("id,name").order("name", { ascending: true }),
  ]);

  const projects: Option[] = ((projectRows ?? []) as Option[]).filter(
    (r) => typeof r.id === "string" && typeof r.name === "string"
  );
  const properties: Option[] = ((propertyRows ?? []) as Option[]).filter(
    (r) => typeof r.id === "string" && typeof r.name === "string"
  );

  // Prefer the live expense (source of truth); fall back to the import snapshot.
  const rows: StatementRowView[] = ((rowRows ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const embed = r.expense as LiveExpense | LiveExpense[] | null;
    const live = (Array.isArray(embed) ? embed[0] : embed) ?? null;
    const expenseExists = Boolean(r.expense_id) && Boolean(live?.id);
    return {
      id: String(r.id),
      expenseId: typeof r.expense_id === "string" ? r.expense_id : null,
      expenseExists,
      expenseDate: String((live?.expense_date ?? r.expense_date ?? "") || "").slice(0, 10),
      transactionDate: String((live?.transaction_date ?? r.transaction_date ?? "") || "").slice(0, 10),
      amount: Number(live?.amount ?? r.amount ?? 0),
      description: String(live?.description ?? r.description ?? ""),
      category: String(live?.category ?? r.category ?? ""),
      businessDomain: String(live?.business_domain ?? r.business_domain ?? ""),
      projectId: String((live?.project_id ?? r.project_id ?? "") || ""),
      propertyId: String((live?.property_id ?? r.property_id ?? "") || ""),
      notes: String((live?.notes ?? r.notes ?? "") || ""),
    };
  });

  let fileUrl: string | null = null;
  if (typeof statement.storage_key === "string" && statement.storage_key) {
    const { data: signed } = await supabase.storage
      .from("business-documents")
      .createSignedUrl(statement.storage_key, 60 * 60);
    fileUrl = signed?.signedUrl ?? null;
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
        }}
        rows={rows}
        projects={projects}
        properties={properties}
        fileUrl={fileUrl}
      />
    </AppShell>
  );
}
