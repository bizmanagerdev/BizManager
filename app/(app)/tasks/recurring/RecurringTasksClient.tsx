"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteIcon, EditIcon, MoreIcon } from "@/components/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { LIST_CARD_BADGE, LIST_CARD_BODY, LIST_CARD_META, LIST_CARD_NAME } from "@/components/ui/list-card";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { cn } from "@/lib/utils";
import { NativeSelect } from "@/components/ui/native-select";
import { toHebrewError } from "@/lib/error-messages";
import { deleteRecurringTaskTemplate } from "@/lib/recurring/deleteTemplate";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit, registerReversibleCreate } from "@/lib/undo-engine";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import {
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import type { TaskOption, TaskPriority, TaskStatus, UserOption } from "@/components/tasks/TaskUpsertDialog";
import { getTaskPriorityLabel, getTaskStatusLabel } from "@/lib/ui/status-colors";
import { formatShortDate } from "@/lib/date";
import { offlineFetch } from "@/lib/offline-queue";

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
  hideHeader?: boolean;
};

type FormState = {
  id: string | null;
  subject_template: string;
  description_template: string;
  business_domain: ExpenseBusinessDomain | "";
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

/** The computer's table columns — loading.tsx draws the same ones. */
const RECURRING_COLUMNS = [
  "משימה קבועה",
  "מקושר ל",
  "דומיין",
  "יצירה",
  "יעד",
  "משויכים",
  "עדיפות",
  "סטטוס",
  "פעיל",
  "פעולות",
] as const;

const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];
const STATUS_OPTIONS: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];

function linkRequirement(domain: ExpenseBusinessDomain | "") {
  if (domain === "logistics_projects") return "project";
  if (domain === "property_management") return "property";
  return null;
}

function createEmptyForm(): FormState {
  return {
    id: null,
    subject_template: "",
    description_template: "",
    business_domain: "",
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

function templatePatchFromForm(f: FormState): Partial<TemplateItem> {
  return {
    subject_template: f.subject_template.trim(),
    description_template: f.description_template.trim() || null,
    business_domain: f.business_domain,
    project_id: f.project_id || null,
    property_id: f.property_id || null,
    default_priority: f.default_priority,
    default_status: f.default_status,
    create_day_of_month: f.create_day_of_month,
    due_day_of_month: f.due_day_of_month,
    start_date: f.start_date || null,
    end_date: f.end_date || null,
    is_active: f.is_active,
    assignee_user_ids: f.assignee_user_ids,
  };
}

export default function RecurringTasksClient(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const templates = useUndoOverlay(props.templates, (t) => t.id, "recurring-task-template");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(createEmptyForm());
  // Deleting asks through the styled ConfirmDialog, never window.confirm.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Only one card's actions are uncovered at a time (phones).
  const [swipedTemplateId, setSwipedTemplateId] = useState<string | null>(null);

  const requirement = linkRequirement(form.business_domain);
  const canSave =
    Boolean(form.business_domain) &&
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

  function handleDomainChange(next: ExpenseBusinessDomain | "") {
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

  function save() {
    if (!canSave) return;
    const payload = {
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
    };

    if (form.id) {
      const id = form.id;
      setOpen(false);
      scheduleDeferredEdit({
        scope: "recurring-task-template",
        id,
        message: "המשימה הקבועה נשמרה",
        patch: templatePatchFromForm(form),
        onCommit: async () => {
          // Through the send queue: with no signal the edit waits for the
          // connection instead of reverting (and losing the form) after
          // "נשמרה". Saving the same template again is harmless.
          const result = await offlineFetch("/api/recurring-tasks/save", payload, "עדכון המשימה הקבועה");
          if (!result.queued && !result.ok) {
            return { ok: false, error: toHebrewError(result.error, "שגיאה בשמירת משימה קבועה") };
          }
          if (!result.queued) {
            startTransition(() => {
              router.refresh();
            });
          }
          return { ok: true };
        },
      });
      return;
    }

    setSaving(true);
    void (async () => {
      try {
        const res = await fetch("/api/recurring-tasks/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error("שגיאה בשמירת משימה קבועה", { description: toHebrewError(json?.error, "") });
          return;
        }
        setOpen(false);
        startTransition(() => {
          router.refresh();
        });
        const newId = typeof json?.id === "string" ? json.id : undefined;
        if (!newId) {
          toast.success("המשימה הקבועה נשמרה");
          return;
        }
        registerReversibleCreate({
          scope: "recurring-task-template",
          id: newId,
          message: "המשימה הקבועה נשמרה",
          onUndo: async () => {
            const del = await deleteRecurringTaskTemplate(newId);
            startTransition(() => {
              router.refresh();
            });
            return del.ok ? { ok: true } : { ok: false, error: toHebrewError(del.error, "ביטול נכשל.") };
          },
        });
      } finally {
        setSaving(false);
      }
    })();
  }

  function remove(id: string) {
    setPendingDeleteId(null);
    scheduleDeferredDelete({
      scope: "recurring-task-template",
      id,
      message: "המשימה הקבועה נמחקה",
      onCommit: async () => {
        const result = await deleteRecurringTaskTemplate(id);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "שגיאה במחיקת משימה קבועה") };
        startTransition(() => {
          router.refresh();
        });
        return { ok: true };
      },
    });
  }

  return (
    <div className="space-y-4">
      {!props.hideHeader && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">משימות קבועות</h1>
            <div className="text-sm text-muted-foreground">
              תבניות חודשיות שיוצרות משימות רגילות אוטומטית.
            </div>
          </div>
          <Button type="button" onClick={openCreate}>
            משימה קבועה חדשה
          </Button>
        </div>
      )}
      {props.hideHeader && (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">תבניות חודשיות שיוצרות משימות אוטומטית.</div>
          <Button type="button" onClick={openCreate}>
            משימה קבועה חדשה
          </Button>
        </div>
      )}

      {props.missingSchema ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            צריך קודם להריץ את `db/sql/create_recurring_task_templates.sql` במסד הנתונים.
          </CardContent>
        </Card>
      ) : templates.length === 0 ? (
        // The app's one empty box (owner, 2026-10-11: "empty lists: one look").
        <EmptyState>
          אין עדיין משימות קבועות. אפשר להתחיל ממשימה חודשית כמו חשמל, שכירות או משכורות.
        </EmptyState>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {/* Same hint the customers list carries — a swipe is invisible until
                someone tells you it's there. */}
            <p className="px-1 text-[0.647rem] text-muted-foreground">החלק כרטיס ימינה לעריכה ומחיקה</p>
            {templates.map((template) => {
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
                // Swipe for עריכה / מחיקה — the same pattern as the customers
                // list. The buttons used to sit ON the card, which cost a row
                // each and made every template card taller than its content.
                <SwipeActions
                  key={template.id}
                  className="rounded-xl border border-border/70 bg-card shadow-sm"
                  open={swipedTemplateId === template.id}
                  onOpenChange={(next) => setSwipedTemplateId(next ? template.id : null)}
                  actions={[
                    {
                      key: "edit",
                      label: "עריכה",
                      icon: <EditIcon className="h-5 w-5" />,
                      className: "bg-secondary",
                      onSelect: () => {
                        setSwipedTemplateId(null);
                        openEdit(template);
                      },
                    },
                    {
                      key: "delete",
                      label: "מחיקה",
                      icon: <DeleteIcon className="h-5 w-5" />,
                      className: "bg-destructive",
                      onSelect: () => {
                        setSwipedTemplateId(null);
                        setPendingDeleteId(template.id);
                      },
                    },
                  ]}
                >
                  {/* The list card's parts, as every phone list draws them (owner,
                      2026-10-11): the name, the where line under it, the pills. */}
                  <button
                    type="button"
                    data-focus-id={template.id}
                    onClick={() => openEdit(template)}
                    className={cn("w-full space-y-2 text-right text-sm", LIST_CARD_BODY)}
                  >
                    <div className="space-y-0.5">
                      <div className={LIST_CARD_NAME}>{template.subject_template}</div>
                      <div className={LIST_CARD_META}>
                        {getBusinessDomainLabel(template.business_domain)} • {linkedLabel}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={template.default_priority} type="priority" className={LIST_CARD_BADGE} />
                      <StatusBadge value={template.default_status} type="task" className={LIST_CARD_BADGE} />
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
                          {formatShortDate(template.start_date, "ללא התחלה")} | {formatShortDate(template.end_date, "ללא סוף")}
                        </span>
                      </div>
                    </div>
                  </button>
                </SwipeActions>
              );
            })}
          </div>

          {/* The orders table's shell, density and header (owner, 2026-10-11:
              "tables one density" — this one was tighter, in its own box). */}
          <div className="hidden md:block">
            <DataTableShell
              header={
                <>
                  {RECURRING_COLUMNS.map((column) => (
                    <th key={column} className="px-4 py-3 font-medium">
                      {column}
                    </th>
                  ))}
                </>
              }
            >
                {templates.map((template) => {
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
                    <tr key={template.id} data-focus-id={template.id} className="hover:bg-muted/30 align-top">
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <div className="font-medium">{template.subject_template}</div>
                          {template.description_template ? (
                            <div className="line-clamp-2 max-w-[280px] text-xs text-muted-foreground">
                              {template.description_template}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4">{linkedLabel}</td>
                      <td className="px-4 py-4">{getBusinessDomainLabel(template.business_domain)}</td>
                      <td className="px-4 py-4 whitespace-nowrap">ביום {template.create_day_of_month}</td>
                      <td className="px-4 py-4 whitespace-nowrap">ביום {template.due_day_of_month}</td>
                      <td className="px-4 py-4">
                        <div className="max-w-[220px] leading-snug">{assignees || "—"}</div>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={template.default_priority} type="priority" />
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={template.default_status} type="task" />
                      </td>
                      <td className="px-4 py-4">{template.is_active ? "כן" : "לא"}</td>
                      {/* Edit and delete behind a ⋮, as every big list on the
                          computer (owner, 2026-10-11) — the phone swipes. */}
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                              title="פעולות"
                              aria-label="פעולות"
                            >
                              <MoreIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem onClick={() => openEdit(template)}>
                              <EditIcon className="me-2 h-4 w-4" />
                              עריכה
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setPendingDeleteId(template.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <DeleteIcon className="me-2 h-4 w-4" />
                              מחיקה
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
            </DataTableShell>
          </div>
        </>
      )}

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title={form.id ? "עריכת משימה קבועה" : "משימה קבועה חדשה"}
        description="אפשר להשתמש בטוקנים {{month_label}}, {{month_key}}, {{due_date}}."
        onSubmit={save}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={saving}
        submitDisabled={!canSave}
      >
            {/* The shared label-over-input, its "*" red (owner, 2026-10-11:
                every form the same Field). */}
            <Field label="דומיין" required>
              <DomainSelect
                value={form.business_domain}
                onChange={(value) => handleDomainChange(value as ExpenseBusinessDomain | "")}
              />
            </Field>

            {requirement === "project" ? (
              <Field label="פרויקט" required>
                <ProjectPicker
                  projects={props.projects}
                  value={form.project_id}
                  onChange={(id) => updateForm("project_id", id)}
                  emptyLabel="בחר פרויקט..."
                  allowClear={false}
                />
              </Field>
            ) : null}

            {requirement === "property" ? (
              <Field label="נכס" required>
                <NativeSelect
                  value={form.property_id}
                  onChange={(e) => updateForm("property_id", e.target.value)}
                >
                  <option value="">בחר נכס...</option>
                  {props.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}

            {form.business_domain ? (
              <>
            <Field label="כותרת תבנית" required>
              <Input
                value={form.subject_template}
                onChange={(e) => updateForm("subject_template", e.target.value)}
                placeholder="למשל: תשלום משכורות - {{month_label}}"
              />
            </Field>

            <Field label="תיאור תבנית">
              <div className="relative">
                <Textarea
                  value={form.description_template}
                  onChange={(e) => updateForm("description_template", e.target.value)}
                  placeholder="פרטי המשימה החוזרת..."
                  className="pe-11"
                />
                <DictateButton
                  onTranscript={(text) =>
                    updateForm("description_template", appendDictatedText(form.description_template, text))
                  }
                  className="absolute bottom-1 end-1 h-8 w-8"
                />
              </div>
            </Field>

            <AdaptiveGrid variant="formTwo">
              <Field label="יום יצירה בכל חודש" required>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={String(form.create_day_of_month)}
                  onChange={(e) => updateForm("create_day_of_month", Number(e.target.value) || 1)}
                />
              </Field>
              <Field label="יום יעד בכל חודש" required>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={String(form.due_day_of_month)}
                  onChange={(e) => updateForm("due_day_of_month", Number(e.target.value) || 1)}
                />
              </Field>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
              <Field label="מתחיל מ">
                <DateInput value={form.start_date} onChange={(e) => updateForm("start_date", e.target.value)} />
              </Field>
              <Field label="עד">
                <DateInput value={form.end_date} onChange={(e) => updateForm("end_date", e.target.value)} />
              </Field>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
              <Field label="עדיפות ברירת מחדל">
                <NativeSelect
                  value={form.default_priority}
                  onChange={(e) => updateForm("default_priority", e.target.value as TaskPriority)}
                >
                  {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {getTaskPriorityLabel(priority)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="סטטוס ברירת מחדל">
                <NativeSelect
                  value={form.default_status}
                  onChange={(e) => updateForm("default_status", e.target.value as TaskStatus)}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {getTaskStatusLabel(status)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </AdaptiveGrid>

            <Field label="משויכים" required className="space-y-2">
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
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => updateForm("is_active", e.target.checked)}
              />
              <span>פעיל</span>
            </label>
              </>
            ) : null}

      </FormDialog>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteId(null);
        }}
        destructive
        title="מחיקת משימה קבועה"
        description="המשימות שכבר נוצרו מהתבנית יישארו. התבנית לא תיצור משימות חדשות."
        confirmLabel="מחיקה"
        onConfirm={() => {
          if (pendingDeleteId) remove(pendingDeleteId);
        }}
      />
    </div>
  );
}
