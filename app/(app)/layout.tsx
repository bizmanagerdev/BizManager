import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";
import SentryUser from "@/components/observability/SentryUser";
import { requireProfile } from "@/lib/auth/requireProfile";

// Shared chrome for every authenticated page. Rendering the shell here (instead
// of inside each page) means the top bar, sidebar and bottom nav PERSIST across
// navigations — they no longer remount on a tab switch. Pages still call
// <AppShell>, but those nested instances pass through (see AppShell), so there's
// no duplicate chrome. requireProfile() is cache()-wrapped, so this layout and
// the pages share a single profile fetch per request.
export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const { profile, supabase } = await requireProfile();

  // Tolerant: the column may not exist before db/sql/add_user_avatar_color.sql
  // runs. Passing the value here lets the top-bar avatar paint the right color
  // on the first render — no client fetch, no flash.
  const { data } = await supabase
    .from("users")
    .select("avatar_color")
    .eq("id", profile.id)
    .maybeSingle();
  const raw = (data as { avatar_color?: unknown } | null)?.avatar_color;
  const avatarColor = typeof raw === "string" ? raw : null;

  return (
    <AppShell
      userName={profile.full_name ?? profile.email ?? undefined}
      viewerRole={profile.role}
      viewerLocale={profile.locale}
      avatarColor={avatarColor}
    >
      <SentryUser
        id={profile.id}
        email={profile.email}
        fullName={profile.full_name}
        role={profile.role}
      />
      {children}
    </AppShell>
  );
}
