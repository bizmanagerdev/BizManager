"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import NotificationSettings from "@/components/notifications/NotificationSettings";
import RecurringExpensesManager from "@/app/financial/RecurringExpensesManager";
import type { RecurringExpenseTemplateItem } from "@/app/financial/RecurringExpensesManager";
import MorningAutoIssueForm from "@/app/settings/integrations/morning/MorningAutoIssueForm";
import BackupCard from "@/app/settings/BackupCard";
import VatRateCard from "@/app/settings/VatRateCard";
import AuditLoggingCard from "@/app/settings/AuditLoggingCard";
import type { MorningSettings } from "@/lib/morning/settings";

type UserOption = { id: string; label: string };
type Option = { id: string; label: string };

type Props = {
  isAdmin: boolean;
  users: UserOption[];
  // recurring expenses
  expenseTemplates: RecurringExpenseTemplateItem[];
  expenseProjects: Option[];
  expenseProperties: Option[];
  expenseOrders: Option[];
  expenseMissingSchema: boolean;
  // Morning integration (admin only)
  morningSettings: MorningSettings | null;
  // Current VAT rate (fraction, e.g. 0.18) — admin only
  vatRate: number;
  // Global audit-logging switch — admin only
  auditLoggingEnabled: boolean;
};

const ALL_TABS = [
  { key: "notifications", label: "התראות", adminOnly: false },
  { key: "recurring-expenses", label: "הוצאות קבועות", adminOnly: false },
  { key: "finance", label: "כספים", adminOnly: true },
  { key: "morning", label: "Morning", adminOnly: true },
  { key: "backup", label: "גיבוי", adminOnly: true },
  { key: "system", label: "מערכת", adminOnly: true },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

export default function SettingsTabs(props: Props) {
  const tabs = ALL_TABS.filter((tab) => !tab.adminOnly || props.isAdmin);
  const [activeTab, setActiveTab] = useState<TabKey>("notifications");

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

      {/* Notifications tab */}
      {activeTab === "notifications" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>התראות לטלפון</CardTitle>
              <CardDescription>הפעל התראות כדי לקבל עדכונים ישירות לטלפון שלך.</CardDescription>
            </CardHeader>
            <CardContent>
              <PushSubscribeButton />
            </CardContent>
          </Card>

          {props.isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>הגדרות התראות</CardTitle>
                <CardDescription>הוסף, ערוך ומחק התראות — מי מקבל ומתי.</CardDescription>
              </CardHeader>
              <CardContent>
                <NotificationSettings users={props.users} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Recurring expenses tab */}
      {activeTab === "recurring-expenses" && (
        <RecurringExpensesManager
          templates={props.expenseTemplates}
          projects={props.expenseProjects}
          properties={props.expenseProperties}
          orders={props.expenseOrders}
          missingSchema={props.expenseMissingSchema}
        />
      )}

      {/* Finance tab (admin only) */}
      {activeTab === "finance" && props.isAdmin && (
        <div className="space-y-4">
          <VatRateCard initialRate={props.vatRate} />
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
