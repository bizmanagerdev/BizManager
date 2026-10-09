import AppShell from "@/components/layout/AppShell";
import SettingsLoadingBody from "./SettingsLoadingBody";

// Streamed instantly while settings data (users, Morning integration, VAT/CC
// fee rates, accounts, connected devices) loads, so TTFB = time-to-shell.
// The page's own shape (SettingsSkeleton) — the segmented tab bar and the open
// tab's cards — to keep the swap shift-free; on the way to a Morning page,
// that page's own (SettingsLoadingBody).
export default function SettingsLoading() {
  return (
    <AppShell>
      <SettingsLoadingBody />
    </AppShell>
  );
}
