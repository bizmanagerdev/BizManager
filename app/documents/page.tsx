import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";

export default async function DocumentsPage() {
  const { profile } = await requireProfile();

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">מסמכים</h1>
        <p className="text-sm text-muted-foreground">
          ארכיון מסמכים מרכזי. ניתן להרחיב מכאן לחיפוש, סינון ושיוך מסמכים ללקוח/פרויקט.
        </p>
      </div>
    </AppShell>
  );
}

