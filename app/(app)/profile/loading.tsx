import AppShell from "@/components/layout/AppShell";
import ProfileSkeleton from "./ProfileSkeleton";

// Streamed instantly while this profile's data loads (sessions, agreements,
// payslips, bonuses, payroll totals — several independent reads keyed off the
// viewer's own id), so TTFB = time-to-shell. The page's own shape
// (ProfileSkeleton) — its tab bar and the open tab's cards — the same
// placeholder its dynamic(ProfileClient) import falls back to.
export default function ProfileLoading() {
  return (
    <AppShell>
      <div className="space-y-4" data-route-loading="true">
        <ProfileSkeleton />
      </div>
    </AppShell>
  );
}
