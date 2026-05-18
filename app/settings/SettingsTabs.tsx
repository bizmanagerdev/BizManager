"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import NotificationSettings from "@/components/notifications/NotificationSettings";
import RecurringTasksClient from "@/app/tasks/recurring/RecurringTasksClient";
import RecurringExpensesManager from "@/app/financial/RecurringExpensesManager";
import type { RecurringExpenseTemplateItem } from "@/app/financial/RecurringExpensesManager";
import type { TaskPriority, TaskStatus } from "@/components/tasks/TaskUpsertDialog";

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
};

const TABS = [
  { key: "notifications", label: "התראות" },
  { key: "recurring-tasks", label: "משימות קבועות" },
  { key: "recurring-expenses", label: "הוצאות קבועות" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function SettingsTabs(props: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>("notifications");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">הגדרות ניהול</h1>
        <p className="text-sm text-muted-foreground">התראות, משימות קבועות והוצאות קבועות.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border bg-muted/40 p-1">
        {TABS.map((tab) => (
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
    </div>
  );
}
