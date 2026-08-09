import Link from "next/link";
import { redirect } from "next/navigation";
import { UserIcon } from "@/components/ui/icons";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import SalaryCenterClient from "@/app/(app)/payroll/SalaryCenterClient";
import { requireProfile, type UserRole } from "@/lib/auth/requireProfile";
import { loadPayrollPageData } from "@/lib/payroll-page-loader";
import { getCustomerOpenBalance } from "@/lib/customers/openBalance";
import { isMissingLinkColumn } from "@/lib/customers/workerLink";
import { buildCounterpartyBalance, getCustomerLoanPositions } from "@/lib/customers/counterpartyBalance";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

export default async function WorkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();

  if (profile.role !== "admin" && profile.role !== "office") {
    redirect("/no-access");
  }

  const { users, sessions, projectOptions, propertyOptions, periods, loadError } = await loadPayrollPageData(supabase);

  // עובד שהוא גם לקוח — the other half of this person. Best-effort: before the
  // link migration runs there is no column, and the page renders as it always did.
  const { data: linkedCustomerRow, error: linkedCustomerError } = await supabase
    .from("customers")
    .select("id,name,phone")
    .eq("linked_user_id", id)
    .maybeSingle();
  const linkedCustomer =
    linkedCustomerRow && !isMissingLinkColumn(linkedCustomerError)
      ? {
          id: String(linkedCustomerRow.id ?? ""),
          name: String(linkedCustomerRow.name ?? "לקוח"),
          phone: typeof linkedCustomerRow.phone === "string" ? linkedCustomerRow.phone : null,
        }
      : null;
  // Same two-sided reading as the customer card, from the same helpers, so the
  // two pages can never quote different numbers for the same person. Salary is
  // omitted here — it's the whole rest of this page.
  const counterparty = linkedCustomer
    ? await Promise.all([
        getCustomerOpenBalance(supabase, linkedCustomer.id),
        getCustomerLoanPositions(supabase, linkedCustomer.id).catch(() => ({
          owedToUs: 0,
          owedByUs: 0,
          loans: [],
        })),
      ]).then(([sales, loans]) =>
        buildCounterpartyBalance({
          salesOwedToUs: sales.openBalance,
          loansOwedToUs: loans.owedToUs,
          loansOwedByUs: loans.owedByUs,
          payrollOwed: null,
        })
      )
    : null;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        {linkedCustomer ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <UserIcon className="h-4 w-4 text-primary" />
                  העובד הזה הוא גם לקוח: {linkedCustomer.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {linkedCustomer.phone ? (
                    <>
                      <span dir="ltr">{linkedCustomer.phone}</span>
                      {" · "}
                    </>
                  ) : null}
                  {counterparty && (counterparty.totalOwedToUs > 0.009 || counterparty.totalOwedByUs > 0.009) ? (
                    <>
                      {counterparty.totalOwedToUs > 0.009 ? (
                        <>
                          חייב לנו{" "}
                          <span className="font-semibold text-destructive">
                            {formatCurrency(counterparty.totalOwedToUs)}
                          </span>
                        </>
                      ) : null}
                      {counterparty.totalOwedToUs > 0.009 && counterparty.totalOwedByUs > 0.009
                        ? " · "
                        : null}
                      {counterparty.totalOwedByUs > 0.009 ? (
                        <>
                          הלוואה שלקחנו ממנו{" "}
                          <span className="font-semibold text-success-soft-foreground">
                            {formatCurrency(counterparty.totalOwedByUs)}
                          </span>
                        </>
                      ) : null}
                      {" — נספר בנפרד מהשכר"}
                    </>
                  ) : (
                    "אין חוב פתוח בין הצדדים"
                  )}
                </div>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/customers/${encodeURIComponent(linkedCustomer.id)}`}>לכרטיס הלקוח</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {loadError ? (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {`שגיאה בטעינת פרטי עובד: ${loadError}`}
            </CardContent>
          </Card>
        ) : (
          <SalaryCenterClient
            viewerRole={profile.role as UserRole}
            publicUsers={users}
            publicSessions={sessions}
            projectOptions={projectOptions}
            propertyOptions={propertyOptions}
            publicPeriods={periods}
            initiallyUnlocked
            hasPasswordConfigured
            defaultWorkerId={id}
            mode="worker-detail"
          />
        )}
      </div>
    </AppShell>
  );
}
