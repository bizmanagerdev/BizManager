import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/requireProfile";

export const dynamic = "force-dynamic";

export default async function LoansPage() {
  const { profile } = await requireProfile();

  if (profile.role !== "admin") {
    redirect("/no-access");
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4 text-right" dir="rtl">
        <h1 className="text-lg font-semibold">הלוואות והחזרים</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            המסך בבנייה. כאן ינוהלו הלוואות שניתנו/התקבלו וההחזרים שלהן.
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
