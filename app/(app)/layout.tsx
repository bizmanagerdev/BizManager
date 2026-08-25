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
//
// This layout sits ABOVE every route's loading.tsx (Next only wraps page.tsx
// and below in that Suspense boundary), so anything awaited here blocks the
// shell — and every navigation in the app — before any skeleton can even show.
// avatar_color used to be its own sequential `users` round-trip after this;
// it now rides along in requireProfile's single query instead.
export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireProfile();
  const avatarColor = profile.avatar_color;

  return (
    <AppShell
      userName={profile.full_name ?? profile.email ?? undefined}
      viewerRole={profile.role}
      viewerLocale={profile.locale}
      viewerDeliveriesAccess={profile.deliveries_access}
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
