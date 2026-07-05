import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { Card, CardContent } from "@/components/ui/card";
import { ensureRecurringExpensesForDate } from "@/lib/recurring-expenses";
import { loadPaymentCalendarItems, type PaymentCalendarItem } from "@/lib/payables";
import PaymentsCalendar from "./PaymentsCalendar";

export const revalidate = 0;

// "לוח תשלומים" — the outgoing-payments calendar. Every upcoming payment the
// business needs to make (unpaid/scheduled expenses, recurring bills, loan
// repayments, worker wages) plus hand-added payments, on a month grid. Add a
// payment to a day, mark it paid, split it into installments.
export default async function PaymentsCalendarPage() {
  const { profile, supabase } = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") redirect("/dashboard");

  // Materialize any recurring expenses due up to today before reading the ledger.
  await ensureRecurringExpensesForDate(supabase).catch(() => undefined);

  let items: PaymentCalendarItem[] = [];
  let todayIso = new Date().toISOString().slice(0, 10);
  let error: string | null = null;
  try {
    const result = await loadPaymentCalendarItems(supabase);
    items = result.items;
    todayIso = result.todayIso;
  } catch (err) {
    error = (err as { message?: string })?.message ?? "שגיאה בטעינת התשלומים";
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-5">
        {error ? (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : (
          <PaymentsCalendar items={items} todayIso={todayIso} />
        )}
      </div>
    </AppShell>
  );
}
