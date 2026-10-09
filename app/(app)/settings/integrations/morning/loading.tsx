import AppShell from "@/components/layout/AppShell";
import SettingsLoadingBody from "@/app/(app)/settings/SettingsLoadingBody";

// Streamed instantly while the Morning settings load, so TTFB = time-to-shell.
// The page's own shape — its heading, the auto-issue form's two cards, the
// links card — instead of the settings page's tab bar it used to inherit; on
// the way to the customers page, that page's own (SettingsLoadingBody).
export default function MorningSettingsLoading() {
  return (
    <AppShell>
      <SettingsLoadingBody />
    </AppShell>
  );
}
