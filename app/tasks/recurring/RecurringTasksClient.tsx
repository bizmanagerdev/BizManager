"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import type { TaskOption, TaskPriority, TaskStatus, UserOption } from "@/components/tasks/TaskUpsertDialog";

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
  templates: TemplateItem[];
  projects: TaskOption[];
  properties: TaskOption[];
  users: UserOption[];
  missingSchema?: boolean;
};

type FormState = {
  id: string | null;
  subject_template: string;
  description_template: string;
  business_domain: ExpenseBusinessDomain;
  project_id: string;
  property_id: string;
  default_priority: TaskPriority;
  default_status: TaskStatus;
  create_day_of_month: number;
  due_day_of_month: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  assignee_user_ids: string[];
};

const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];
const STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];

function linkRequirement(domain: ExpenseBusinessDomain) {
  if (domain === "logistics_projects") return "project";
  if (domain === "property_management") return "property";
  return null;
}

function createEmptyForm(): FormState {
  return {
    id: null,
    subject_template: "",
    description_template: "",
    business_domain: "general_business",
    project_id: "",
    property_id: "",
    default_priority: "medium",
    default_status: "todo",
    create_day_of_month: 1,
    due_day_of_month: 1,
    start_date: "",
    end_date: "",
    is_active: true,
    assignee_user_ids: [],
  };
}

export default function RecurringTasksClient(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(createEmptyForm());

  const requirement = linkRequirement(form.business_domain);
  const canSave =
    Boolean(form.subject_template.trim()) &&
    form.assignee_user_ids.length > 0 &&
    (requirement === "project"
      ? Boolean(form.project_id)
      : requirement === "property"
        ? Boolean(form.property_id)
        : true);

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setForm(createEmptyForm());
    setOpen(true);
  }

  function openEdit(template: TemplateItem) {
    setForm({
      id: template.id,
      subject_template: template.subject_template,
      description_template: template.description_template ?? "",
      business_domain: template.business_domain as ExpenseBusinessDomain,
      project_id: template.project_id ?? "",
      property_id: template.property_id ?? "",
      default_priority: template.default_priority,
      default_status: template.default_status,
      create_day_of_month: template.create_day_of_month,
      due_day_of_month: template.due_day_of_month,
      start_date: template.start_date ?? "",
      end_date: template.end_date ?? "",
      is_active: template.is_active,
      assignee_user_ids: template.assignee_user_ids,
    });
    setOpen(true);
  }

  function handleDomainChange(next: ExpenseBusinessDomain) {
    setForm((current) => ({
      ...current,
      business_domain: next,
      project_id: linkRequirement(next) === "project" ? current.project_id : "",
      property_id: linkRequirement(next) === "property" ? current.property_id : "",
    }));
  }

  function toggleAssignee(userId: string) {
    setForm((current) => ({
      ...current,
      assignee_user_ids: current.assignee_user_ids.includes(userId)
        ? current.assignee_user_ids.filter((id) => id !== userId)
        : [...current.assignee_user_ids, userId],
    }));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/recurring-tasks/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          subject_template: form.subject_template.trim(),
          description_template: form.description_template.trim() || null,
          business_domain: form.business_domain,
          project_id: requirement === "project" ? form.project_id : null,
          property_id: requirement === "property" ? form.property_id : null,
          default_priority: form.default_priority,
          default_status: form.default_status,
          create_day_of_month: form.create_day_of_month,
          due_day_of_month: form.due_day_of_month,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          is_active: form.is_active,
          assignee_user_ids: form.assignee_user_ids,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה בשמירת משימה קבועה", { description: json?.error ?? "" });
        return;
      }
      setOpen(false);
      router.refresh();
      toast.success("המשימה הקבועה נשמרה");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const ok = window.confirm("למחוק את המשימה הקבועה?");
    if (!ok) return;

    const res = await fetch("/api/recurring-tasks/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("שגיאה במחיקת משימה קבועה", { description: json?.error ?? "" });
      return;
    }
    router.refresh();
    toast.success("המשימה הקבועה נמחקה");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">משימות קבועות</h1>
          <div className="text-sm text-muted-foreground">
            תבניות חודשיות שיוצרות משימות רגילות אוטומטית.
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/tasks">חזרה למשימות</Link>
          </Button>
          <Button type="button" onClick={openCreate}>
            משימה קבועה חדשה
          </Button>
        </div>
      </div>

      {props.missingSchema ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            צריך קודם להריץ את `db/sql/create_recurring_task_templates.sql` במסד הנתונים.
          </CardContent>
        </Card>
      ) : props.templates.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            אין עדיין משימות קבועות. אפשר להתחיל ממשימה חודשית כמו חשמל, שכירות או משכורות.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {props.templates.map((template) => {
              const linkedLabel =
                template.project_id
                  ? props.projects.find((item) => item.id === template.project_id)?.label ?? "פרויקט"
                  : template.property_id
                    ? props.properties.find((item) => item.id === template.property_id)?.label ?? "נכס"
                    : "ללא קישור";
              const assignees = template.assignee_user_ids
                .map((userId) => props.users.find((user) => user.id === userId)?.label)
                .filter(Boolean)
                .join(", ");

              return (
                <Card key={template.id} className="overflow-hidden">
                  <CardContent className="space-y-2 p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="font-medium">{template.subject_template}</div>
                        <div className="text-xs text-muted-foreground">
                          {getBusinessDomainLabel(template.business_domain)} • {linkedLabel}
                        </div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(template)}>
                        עריכה
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={template.default_priority} type="priority" />
                      <StatusBadge value={template.default_status} type="task" />
                      {!template.is_active ? <span className="text-xs text-muted-foreground">לא פעיל</span> : null}
                    </div>
                    <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                      <div>
                        נוצר: <span className="text-foreground">ביום {template.create_day_of_month}</span>
                      </div>
                      <div>
                        יעד: <span className="text-foreground">ביום {template.due_day_of_month}</span>
                      </div>
                      <div>
                        משויכים: <span className="text-foreground">{assignees || "—"}</span>
                      </div>
                      <div>
                        טווח:{" "}
                        <span className="text-foreground">
                          {template.start_date || "ללא התחלה"} | {template.end_date || "ללא סוף"}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="destructive" size="sm" onClick={() => void remove(template.id)}>
                        מחיקה
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-md border md:block">
            <table className="min-w-[1100px] w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">משימה קבועה</th>
                  <th className="px-3 py-2 text-right font-medium">מקושר ל</th>
                  <th className="px-3 py-2 text-right font-medium">דומיין</th>
                  <th className="px-3 py-2 text-right font-medium">יצירה</th>
                  <th className="px-3 py-2 text-right font-medium">יעד</th>
                  <th className="px-3 py-2 text-right font-medium">משויכים</th>
                  <th className="px-3 py-2 text-right font-medium">עדיפות</th>
                  <th className="px-3 py-2 text-right font-medium">סטטוס</th>
                  <th className="px-3 py-2 text-right font-medium">פעיל</th>
                  <th className="px-3 py-2 text-right font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {props.templates.map((template) => {
                  const linkedLabel =
                    template.project_id
                      ? props.projects.find((item) => item.id === template.project_id)?.label ?? "פרויקט"
                      : template.property_id
                        ? props.properties.find((item) => item.id === template.property_id)?.label ?? "נכס"
                        : "ללא קישור";
                  const assignees = template.assignee_user_ids
                    .map((userId) => props.users.find((user) => user.id === userId)?.label)
                    .filter(Boolean)
                    .join(", ");

                  return (
                    <tr key={template.id} className="hover:bg-muted/30 align-top">
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <div className="font-medium">{template.subject_template}</div>
                          {template.description_template ? (
                            <div className="line-clamp-2 max-w-[280px] text-xs text-muted-foreground">
                              {template.description_template}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">{linkedLabel}</td>
                      <td className="px-3 py-2">{getBusinessDomainLabel(template.business_domain)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">ביום {template.create_day_of_month}</td>
                      <td className="px-3 py-2 whitespace-nowrap">ביום {template.due_day_of_month}</td>
                      <td className="px-3 py-2">
                        <div className="max-w-[220px] leading-snug">{assignees || "—"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge value={template.default_priority} type="priority" />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge value={template.default_status} type="task" />
                      </td>
                      <td className="px-3 py-2">{template.is_active ? "כן" : "לא"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => openEdit(template)}>
                            עריכה
                          </Button>
                          <Button type="button" variant="destructive" size="sm" onClick={() => void remove(template.id)}>
                            מחיקה
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && saving) return;
          setOpen(next);
        }}
      >
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>{form.id ? "עריכת משימה קבועה" : "משימה קבועה חדשה"}</DialogTitle>
            <DialogDescription>
              אפשר להשתמש בטוקנים `{"{{month_label}}"}`, `{"{{month_key}}"}`, `{"{{due_date}}"}`.
            </DialogDescription>
          </DialogHeader>

          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium">דומיין *</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.business_domain}
                onChange={(e) => handleDomainChange(e.target.value as ExpenseBusinessDomain)}
              >
                {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {getBusinessDomainLabel(domain)}
                  </option>
                ))}
              </select>
            </div>

            {requirement === "project" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">פרויקט *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.project_id}
                  onChange={(e) => updateForm("project_id", e.target.value)}
                >
                  <option value="">בחר פרויקט...</option>
                  {props.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {requirement === "property" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">נכס *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.property_id}
                  onChange={(e) => updateForm("property_id", e.target.value)}
                >
                  <option value="">בחר נכס...</option>
                  {props.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">כותרת תבנית *</div>
              <Input
                value={form.subject_template}
                onChange={(e) => updateForm("subject_template", e.target.value)}
                placeholder="למשל: תשלום משכורות - {{month_label}}"
              />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">תיאור תבנית</div>
              <Textarea
                value={form.description_template}
                onChange={(e) => updateForm("description_template", e.target.value)}
                placeholder="פרטי המשימה החוזרת..."
              />
            </div>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">יום יצירה בכל חודש *</div>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={String(form.create_day_of_month)}
                  onChange={(e) => updateForm("create_day_of_month", Number(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">יום יעד בכל חודש *</div>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={String(form.due_day_of_month)}
                  onChange={(e) => updateForm("due_day_of_month", Number(e.target.value) || 1)}
                />
              </div>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">מתחיל מ</div>
                <DateInput value={form.start_date} onChange={(e) => updateForm("start_date", e.target.value)} />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">עד</div>
                <DateInput value={form.end_date} onChange={(e) => updateForm("end_date", e.target.value)} />
              </div>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">עדיפות ברירת מחדל</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.default_priority}
                  onChange={(e) => updateForm("default_priority", e.target.value as TaskPriority)}
                >
                  {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">סטטוס ברירת מחדל</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.default_status}
                  onChange={(e) => updateForm("default_status", e.target.value as TaskStatus)}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            </AdaptiveGrid>

            <div className="space-y-2">
              <div className="text-sm font-medium">משויכים *</div>
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-md border p-3">
                {props.users.map((user) => (
                  <label key={user.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.assignee_user_ids.includes(user.id)}
                      onChange={() => toggleAssignee(user.id)}
                    />
                    <span>{user.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => updateForm("is_active", e.target.checked)}
              />
              <span>פעיל</span>
            </label>

            <DialogFooter className="mt-6">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={!canSave || saving}>
                {saving ? "שומר..." : "שמירה"}
              </Button>
            </DialogFooter>
          </form>
        </AdaptiveDialog>
      </Dialog>
    </div>
  );
}
