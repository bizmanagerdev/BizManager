"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import NotificationSettings from "@/components/notifications/NotificationSettings";
import ConnectedDevicesCard, { type ConnectedDevice } from "@/components/notifications/ConnectedDevicesCard";
import MorningAutoIssueForm from "@/app/(app)/settings/integrations/morning/MorningAutoIssueForm";
import BackupCard from "@/app/(app)/settings/BackupCard";
import VatRateCard from "@/app/(app)/settings/VatRateCard";
import CcFeeRateCard from "@/app/(app)/settings/CcFeeRateCard";
import AuditLoggingCard from "@/app/(app)/settings/AuditLoggingCard";
import AccountsCard from "@/app/(app)/settings/AccountsCard";
import type { MorningSettings } from "@/lib/morning/settings";
import type { Account } from "@/lib/accounts";

type UserOption = { id: string; label: string };

type Props = {
  isAdmin: boolean;
  users: UserOption[];
  // Morning integration (admin only)
  morningSettings: MorningSettings | null;
  // Current VAT rate (fraction, e.g. 0.18) — admin only
  vatRate: number;
  // Credit-card processor (e.g. Grow) fee rate (fraction, e.g. 0.14) — admin only
  ccFeeRate: number;
  // Global audit-logging switch — admin only
  auditLoggingEnabled: boolean;
  // Bank/cash accounts (חשבונות) — admin only
  accounts: Account[];
  // Connected push devices across all users — admin only
  connectedDevices: ConnectedDevice[];
  devicesUnavailable: boolean;
};

const ALL_TABS = [
  { key: "notifications", label: "התראות", adminOnly: true },
  { key: "finance", label: "כספים", adminOnly: true },
  { key: "morning", label: "Morning", adminOnly: true },
  { key: "backup", label: "גיבוי", adminOnly: true },
  { key: "system", label: "מערכת", adminOnly: true },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

function isTabKey(value: string | null): value is TabKey {
  return value != null && ALL_TABS.some((tab) => tab.key === value);
}

export default function SettingsTabs(props: Props) {
  const tabs = ALL_TABS.filter((tab) => !tab.adminOnly || props.isAdmin);
  // A caller can deep-link a specific tab (e.g. /settings?tab=finance from the
  // חשבונות page's "ניהול חשבונות" button) — previously this always landed on
  // the first tab since nothing here read the URL at all.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabKey>(isTabKey(tabParam) ? tabParam : "notifications");
  // Re-sync if the param changes under an already-mounted instance (a second
  // Link to a different tab while already on /settings doesn't remount this
  // component). Adjusting state during render in response to a changed prop
  // (React's documented alternative to an effect for this) — a manual tab
  // click isn't affected, since this only fires when tabParam itself changes.
  const [prevTabParam, setPrevTabParam] = useState(tabParam);
  if (tabParam !== prevTabParam) {
    setPrevTabParam(tabParam);
    if (isTabKey(tabParam)) setActiveTab(tabParam);
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border bg-secondary/40 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notifications tab (admin config; personal push + prefs live in the profile) */}
      {activeTab === "notifications" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>התראות אוטומטיות</CardTitle>
              <CardDescription>מה המערכת מזהה לבד, ולמי זה מגיע.</CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationSettings users={props.users} />
            </CardContent>
          </Card>

          {props.isAdmin && (
            <ConnectedDevicesCard
              devices={props.connectedDevices}
              unavailable={props.devicesUnavailable}
            />
          )}
        </div>
      )}

      {/* Finance tab (admin only) */}
      {activeTab === "finance" && props.isAdmin && (
        <div className="space-y-4">
          <AccountsCard initialAccounts={props.accounts} />
          <VatRateCard initialRate={props.vatRate} />
          <CcFeeRateCard initialRate={props.ccFeeRate} />
        </div>
      )}

      {/* Morning integration tab (admin only) */}
      {activeTab === "morning" && props.isAdmin && props.morningSettings && (
        <div className="space-y-4">
          <MorningAutoIssueForm initial={props.morningSettings} />
          <Card>
            <CardHeader>
              <CardTitle>פעולות נוספות</CardTitle>
              <CardDescription>התאמת לקוחות Morning ובדיקת חיבור.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href="/settings/integrations/morning/customers">התאמת לקוחות</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/api/morning/health" target="_blank">
                  בדיקת חיבור (health)
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Backup tab (admin only) */}
      {activeTab === "backup" && props.isAdmin && <BackupCard />}

      {/* System tab (admin only) */}
      {activeTab === "system" && props.isAdmin && (
        <div className="space-y-4">
          <AuditLoggingCard initialEnabled={props.auditLoggingEnabled} />
        </div>
      )}
    </div>
  );
}
