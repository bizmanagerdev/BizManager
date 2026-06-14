"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import NotificationSettings from "@/components/notifications/NotificationSettings";
import RecurringTasksClient from "@/app/tasks/recurring/RecurringTasksClient";
import RecurringExpensesManager from "@/app/financial/RecurringExpensesManager";
import type { RecurringExpenseTemplateItem } from "@/app/financial/RecurringExpensesManager";
import type { TaskPriority, TaskStatus } from "@/components/tasks/TaskUpsertDialog";
import MorningAutoIssueForm from "@/app/settings/integrations/morning/MorningAutoIssueForm";
import BackupCard from "@/app/settings/BackupCard";
import type { MorningSettings } from "@/lib/morning/settings";

type UserOption = { id: string; label: string };
type Option = { id: string; label: string };

type TemplateItem = {
  id: string;
  subject_template: string;
  description_template: string | null;
  business_domain: string;
  project_id: string | null;
  property_id: string | null;
  default_priority: TaskPriority;
  default_status: TaskStatus;
  create_day_of_month: number;
  due_day_of_month: number;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  assignee_user_ids: string[];
};

type Props = {
  isAdmin: boolean;
  users: UserOption[];
  // recurring tasks
  taskTemplates: TemplateItem[];
  taskProjects: Option[];
  taskProperties: Option[];
  taskMissingSchema: boolean;
  // recurring expenses
  expenseTemplates: RecurringExpenseTemplateItem[];
  expenseProjects: Option[];
  expenseProperties: Option[];
  expenseOrders: Option[];
  expenseMissingSchema: boolean;
  // Morning integration (admin only)
  morningSettings: MorningSettings | null;
};

const ALL_TABS = [
  { key: "notifications", label: "התראות", adminOnly: false },
  { key: "recurring-tasks", label: "משימות קבועות", adminOnly: false },
  { key: "recurring-expenses", label: "הוצאות קבועות", adminOnly: false },
  { key: "morning", label: "Morning", adminOnly: true },
  { key: "backup", label: "גיבוי", adminOnly: true },
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

      {/* Recurring tasks tab */}
      {activeTab === "recurring-tasks" && (
        <RecurringTasksClient
          templates={props.taskTemplates}
          projects={props.taskProjects}
          properties={props.taskProperties}
          users={props.users}
          missingSchema={props.taskMissingSchema}
          hideHeader
        />
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
    </div>
  );
}
