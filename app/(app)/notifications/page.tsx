import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import { PageStack } from "@/components/layout/page-layout";
import { NotificationIcon } from "@/components/ui/icons";
import NotificationsClient from "@/app/(app)/notifications/NotificationsClient";
import type { NotificationItem } from "@/lib/ui/notifications-store";
import { t } from "@/lib/i18n/t";
import { notificationsDict } from "@/lib/i18n/dictionaries/notifications";

export const revalidate = 0;

// Full notification history (read/unread), paginated. The bell shows the latest;
// this page shows everything.
export default async function NotificationsPage() {
  const { profile, supabase } = await requireProfile();

  const { data, error } = await supabase
    .from("notifications")
    .select("id,title,body,url,category,read_at,created_at")
    .order("created_at", { ascending: false })
    .limit(40);
  const items = (error ? [] : (data ?? [])) as NotificationItem[];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <PageStack>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <NotificationIcon className="h-6 w-6" />
            {t(notificationsDict, profile.locale, "pageTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t(notificationsDict, profile.locale, "pageDescription")}</p>
        </div>
        <NotificationsClient initialItems={items} initialHasMore={items.length === 40} locale={profile.locale} />
      </PageStack>
    </AppShell>
  );
}
