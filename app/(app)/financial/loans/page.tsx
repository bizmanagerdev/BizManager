import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { loadAccounts, type Account } from "@/lib/accounts";
import { loadDebts } from "@/lib/debts-load";
import { fetchLoans, summarizeLoans } from "@/lib/loans";
import DebtsHubClient from "./DebtsHubClient";

export const revalidate = 30;

// חובות — what the business owes: unpaid expenses and wages (the default tab),
// the loans themselves, and a report of all of it, loans included. The route
// keeps its old /financial/loans path so existing links, alerts and bookmarks
// keep working.
export default async function DebtsPage() {
  const { profile, supabase } = await requireProfile();

  // Debts and loans are sensitive financial data — admin only (matches the nav gating).
  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  // Loans feed both the loans tab and the debts list — read once, and handed to
  // the debts loader as a promise so all of it loads side by side. Accounts
  // only name things.
  const loansPromise = fetchLoans(supabase);
  const [loans, accounts, debts] = await Promise.all([
    loansPromise,
    loadAccounts(supabase).catch(() => [] as Account[]),
    loadDebts(supabase, { loans: loansPromise }),
  ]);

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <DebtsHubClient
        items={debts.items}
        todayIso={debts.todayIso}
        errors={debts.errors}
        loans={loans}
        loansSummary={summarizeLoans(loans)}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      />
    </AppShell>
  );
}
