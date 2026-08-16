"use client";

// Presentational section components for TaskUpsertDialog. These hold no business
// logic and no data fetching — they render props and call back. The dialog owns
// all state; this file just shrinks its render. (Logic lives in
// TaskUpsertDialog.helpers.ts; the orchestrator is TaskUpsertDialog.tsx.)

import Image from "next/image";
import { AddIcon, AttachIcon, CheckIcon, ClockIcon, CloseIcon, CommentIcon, LocationIcon, NotificationIcon } from "@/components/ui/icons";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TagPicker } from "@/components/tags/TagPicker";
import { formatShortDateTime } from "@/lib/date";
import { getTaskPriorityLabel, getTaskStatusLabel } from "@/lib/ui/status-colors";
import { CITY_OPTIONS } from "@/lib/ui/cities";
import type { ExpenseBusinessDomain } from "@/lib/expenses";
import {
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type LegacyNote,
  type TaskPriority,
  type TaskStatus,
  type TaskTargetType,
} from "@/components/tasks/TaskUpsertDialog.helpers";

// Shared data shapes used by the dialog and these sections.
export type TaskOption = { id: string; label: string };
export type UserOption = { id: string; label: string; color?: string | null };
export type CommentItem = {
  id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
};
export type ReminderItem = {
  id: string;
  remind_at: string;
  content: string | null;
  status: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
};
export type AttachmentItem = {
  id: string;
  kind: "image" | "video" | "file";
  original_name: string | null;
  created_at: string | null;
  uploader_name: string | null;
  url: string | null;
};

export function TaskDescriptionSection({
  description,
  onChange,
}: {
  description: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1 rounded-md border bg-muted/20 p-3">
      <div className="text-sm font-medium">תיאור</div>
      <Textarea value={description} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function TaskDomainSection({
  allowedDomains,
  effectiveDomain,
  onDomainChange,
  tagIds,
  onTagIdsChange,
  showTargetPicker,
  derivedTargetType,
  projects,
  projectId,
  onProjectIdChange,
  properties,
  propertyId,
  onPropertyIdChange,
  customers,
  customerId,
  onCustomerIdChange,
}: {
  allowedDomains: ExpenseBusinessDomain[];
  effectiveDomain: ExpenseBusinessDomain | "";
  onDomainChange: (value: ExpenseBusinessDomain | "") => void;
  tagIds: string[];
  onTagIdsChange: (ids: string[]) => void;
  showTargetPicker: boolean;
  derivedTargetType: TaskTargetType | null;
  projects: TaskOption[];
  projectId: string;
  onProjectIdChange: (id: string) => void;
  properties: TaskOption[];
  propertyId: string;
  onPropertyIdChange: (id: string) => void;
  customers: TaskOption[];
  customerId: string;
  onCustomerIdChange: (id: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">תחום עסקי</div>
        <DomainSelect
          domains={allowedDomains}
          value={effectiveDomain}
          onChange={(value) => onDomainChange(value as ExpenseBusinessDomain | "")}
        />
      </div>

      {effectiveDomain === "general_business" ? (
        <TagPicker value={tagIds} onChange={onTagIdsChange} />
      ) : null}

      {showTargetPicker && derivedTargetType === "project" ? (
        <div className="space-y-1">
          <div className="text-sm font-medium">פרויקט *</div>
          <ProjectPicker
            projects={projects}
            value={projectId}
            onChange={onProjectIdChange}
            emptyLabel="בחר פרויקט..."
            allowClear={false}
          />
        </div>
      ) : null}

      {showTargetPicker && derivedTargetType === "property" ? (
        <div className="space-y-1">
          <div className="text-sm font-medium">נכס *</div>
          <NativeSelect
            value={propertyId}
            onChange={(e) => onPropertyIdChange(e.target.value)}
          >
            <option value="">בחר נכס...</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {/* Customer link — independent of the project/property target. A follow-up can
          point at a customer even when there's no order/project yet (e.g. a prospect).
          Only shown where the caller supplies the customer list. */}
      {customers.length > 0 ? (
        <div className="space-y-1">
          <div className="text-sm font-medium">לקוח מקושר</div>
          <SearchableSelect
            options={customers.map((c) => ({ value: c.id, label: c.label }))}
            value={customerId}
            onChange={onCustomerIdChange}
            placeholder="ללא לקוח"
            searchPlaceholder="חיפוש לקוח..."
            emptyOptionLabel="ללא לקוח"
            noResultsLabel="לא נמצאו לקוחות לחיפוש הזה."
            maxHeightClassName="max-h-56"
            searchThreshold={0}
          />
        </div>
      ) : null}
    </div>
  );
}

export function TaskDatesSection({
  dueDate,
  onDueDateChange,
  dueTime,
  onDueTimeChange,
}: {
  dueDate: string;
  onDueDateChange: (value: string) => void;
  dueTime: string;
  onDueTimeChange: (value: string) => void;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <AdaptiveGrid variant="formTwo">
        <div className="space-y-1">
          <div className="text-sm font-medium">תאריך יעד</div>
          <DateInput value={dueDate} onChange={(e) => onDueDateChange(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-sm font-medium">
            <ClockIcon className="h-3.5 w-3.5 text-muted-foreground" />
            שעה
          </div>
          <Input type="time" value={dueTime} onChange={(e) => onDueTimeChange(e.target.value)} dir="ltr" />
        </div>
      </AdaptiveGrid>
    </div>
  );
}

export function TaskPeopleSection({
  users,
  assignedUserId,
  onAssignedChange,
  canAddSelf,
  meId,
  memberIds,
  onToggleMember,
  selectedMembers,
  memberOptions,
  colorIndexById,
}: {
  users: UserOption[];
  assignedUserId: string;
  onAssignedChange: (id: string) => void;
  canAddSelf: boolean;
  meId: string;
  memberIds: string[];
  onToggleMember: (id: string) => void;
  selectedMembers: UserOption[];
  memberOptions: UserOption[];
  colorIndexById: Map<string, number>;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">אחראי</div>
        <NativeSelect
          value={assignedUserId}
          onChange={(e) => onAssignedChange(e.target.value)}
        >
          <option value="">בחר משתמש...</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {canAddSelf ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={memberIds.includes(meId)}
            onChange={() => onToggleMember(meId)}
          />
          הוסף גם אותי כחבר במשימה
        </label>
      ) : null}

      <div className="space-y-1">
        <div className="text-sm font-medium">חברים נוספים</div>
        {selectedMembers.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selectedMembers.map((member) => (
              <span
                key={member.id}
                className="inline-flex items-center gap-1 rounded-full border bg-secondary/40 py-0.5 ps-1 pe-2 text-xs"
              >
                <InitialsAvatar name={member.label} color={member.color} colorKey={member.id} colorIndex={colorIndexById.get(member.id)} size="sm" />
                {member.label}
                <button
                  type="button"
                  onClick={() => onToggleMember(member.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`הסר ${member.label}`}
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <details className="rounded-md border bg-background">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm text-muted-foreground">
            <AddIcon className="ms-0 me-1 inline h-3.5 w-3.5" />
            הוספת חברים
          </summary>
          <div className="max-h-40 overflow-auto border-t p-1">
            {memberOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">אין משתמשים זמינים.</div>
            ) : (
              memberOptions.map((user) => {
                const checked = memberIds.includes(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => onToggleMember(user.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-muted/40"
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
                      }`}
                    >
                      {checked ? <CheckIcon className="h-3 w-3" /> : null}
                    </span>
                    <InitialsAvatar name={user.label} color={user.color} colorKey={user.id} colorIndex={colorIndexById.get(user.id)} size="sm" />
                    {user.label}
                  </button>
                );
              })
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

export function TaskLocationSection({
  city,
  setCity,
  cityOther,
  setCityOther,
  address,
  onAddressChange,
}: {
  city: string;
  setCity: (value: string) => void;
  cityOther: boolean;
  setCityOther: (value: boolean) => void;
  address: string;
  onAddressChange: (value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <AdaptiveGrid variant="formTwo">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-sm font-medium">
            <LocationIcon className="h-3.5 w-3.5 text-muted-foreground" />
            עיר
          </div>
          <NativeSelect
            value={cityOther ? "אחר" : city}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "אחר") {
                setCityOther(true);
                setCity("");
              } else {
                setCityOther(false);
                setCity(value);
              }
            }}
          >
            <option value="">בחר עיר...</option>
            {CITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">כתובת</div>
          <Input value={address} onChange={(e) => onAddressChange(e.target.value)} />
        </div>
      </AdaptiveGrid>

      {cityOther ? (
        <div className="space-y-1">
          <div className="text-sm font-medium">עיר (הקלדה חופשית)</div>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Files chosen BEFORE the task exists.
 *
 * Uploading needs a task id, so during creation we just hold the File objects and
 * send them once the task has been created. Without this, attaching a photo meant
 * create → reopen the card → attach, which is why "קבצים ותמונות" was invisible on
 * a new task.
 */
export function TaskPendingFilesSection({
  files,
  onAdd,
  onRemove,
}: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <AttachIcon className="h-3.5 w-3.5 text-muted-foreground" />
          קבצים ותמונות
        </div>
        <FileUploadActions
          files={[]}
          accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
          multiple
          size="sm"
          onFilesSelected={(picked) => onAdd(picked)}
          chooseLabel="צירוף קובץ"
          takePhotoLabel="צילום"
          showPreview={false}
          notifyOnAdd={false}
        />
      </div>
      {files.length === 0 ? (
        <div className="text-xs text-muted-foreground">אפשר לצרף קבצים כבר עכשיו — הם יועלו עם יצירת המשימה.</div>
      ) : (
        <div className="space-y-1.5">
          {files.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5"
            >
              <span className="min-w-0 truncate text-xs">{file.name}</span>
              <DeleteButton label={`הסרת ${file.name}`} onClick={() => onRemove(index)} />
            </div>
          ))}
          <div className="text-[11px] text-muted-foreground">{files.length} קבצים יועלו עם השמירה</div>
        </div>
      )}
    </div>
  );
}

export function TaskAttachmentsSection({
  attachments,
  uploadingFiles,
  onUpload,
  onRequestDelete,
}: {
  attachments: AttachmentItem[];
  uploadingFiles: boolean;
  onUpload: (files: File[]) => void;
  onRequestDelete: (target: { id: string; name: string | null }) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <AttachIcon className="h-3.5 w-3.5 text-muted-foreground" />
          קבצים ותמונות
        </div>
        <FileUploadActions
          files={[]}
          accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt"
          multiple
          size="sm"
          disabled={uploadingFiles}
          onFilesSelected={(files) => onUpload(files)}
          chooseLabel={uploadingFiles ? "מעלה..." : "צירוף קובץ"}
          takePhotoLabel="צילום"
          showPreview={false}
          notifyOnAdd={false}
        />
      </div>
      {attachments.length === 0 ? (
        <div className="text-xs text-muted-foreground">אין קבצים מצורפים.</div>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5"
            >
              <a
                href={attachment.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-2"
              >
                {attachment.url && attachment.kind === "image" ? (
                  <Image
                    src={attachment.url}
                    alt={attachment.original_name ?? "image"}
                    width={64}
                    height={64}
                    unoptimized
                    className="h-9 w-9 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                    {attachment.kind === "video" ? "וידאו" : "קובץ"}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm text-primary hover:underline">
                    {attachment.original_name ?? "קובץ"}
                  </span>
                  {attachment.created_at || attachment.uploader_name ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[
                        attachment.created_at ? formatShortDateTime(attachment.created_at) : null,
                        attachment.uploader_name ? `הועלה ע"י ${attachment.uploader_name}` : null,
                      ]
                        .filter(Boolean)
                        .join(" • ")}
                    </span>
                  ) : null}
                </span>
              </a>
              <DeleteButton
                label="מחיקת קובץ"
                onClick={() => onRequestDelete({ id: attachment.id, name: attachment.original_name })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskLabelsSection({
  priority,
  onPriorityChange,
  status,
  onStatusChange,
}: {
  priority: TaskPriority;
  onPriorityChange: (value: TaskPriority) => void;
  status: TaskStatus;
  onStatusChange: (value: TaskStatus) => void;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <AdaptiveGrid variant="formTwo">
        <div className="space-y-1">
          <div className="text-sm font-medium">עדיפות</div>
          <NativeSelect
            value={priority}
            onChange={(e) => onPriorityChange(e.target.value as TaskPriority)}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {getTaskPriorityLabel(option)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">סטטוס</div>
          <NativeSelect
            value={status}
            onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {getTaskStatusLabel(option)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </AdaptiveGrid>
    </div>
  );
}

export function TaskRemindersStagingSection({
  pendingReminders,
  reminderAt,
  setReminderAt,
  reminderNote,
  setReminderNote,
  onStage,
  onRemove,
}: {
  pendingReminders: { remind_at: string; content: string }[];
  reminderAt: string;
  setReminderAt: (value: string) => void;
  reminderNote: string;
  setReminderNote: (value: string) => void;
  onStage: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <NotificationIcon className="h-3.5 w-3.5 text-muted-foreground" />
        תזכורות
      </div>
      {pendingReminders.length > 0 ? (
        <div className="space-y-1.5">
          {pendingReminders.map((reminder, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{formatShortDateTime(reminder.remind_at)}</div>
                {reminder.content ? (
                  <div className="truncate text-xs text-muted-foreground">{reminder.content}</div>
                ) : null}
              </div>
              <DeleteButton label="הסרת תזכורת" onClick={() => onRemove(index)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">אפשר להוסיף תזכורות כבר עכשיו — הן ייווצרו עם המשימה.</div>
      )}
      <AdaptiveGrid variant="formTwo">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">מועד התזכורת</div>
          <DateTimeInput value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">הערה (אופציונלי)</div>
          <Input value={reminderNote} onChange={(e) => setReminderNote(e.target.value)} />
        </div>
      </AdaptiveGrid>
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="secondary" disabled={!reminderAt} onClick={onStage}>
          הוספת תזכורת
        </Button>
      </div>
    </div>
  );
}

// Edit-mode right column: live reminders (add / done / cancel) + comments.
export function TaskCardSidebar({
  reminders,
  reminderAt,
  setReminderAt,
  reminderNote,
  setReminderNote,
  addingReminder,
  editingReminderId,
  onAddReminder,
  onEditReminder,
  onCancelEditReminder,
  onSetReminderStatus,
  comments,
  legacyNotes,
  newComment,
  setNewComment,
  addingComment,
  onAddComment,
  colorIndexById,
  chosenColorById,
}: {
  reminders: ReminderItem[];
  reminderAt: string;
  setReminderAt: (value: string) => void;
  reminderNote: string;
  setReminderNote: (value: string) => void;
  addingReminder: boolean;
  editingReminderId: string | null;
  onAddReminder: () => void;
  onEditReminder: (reminder: ReminderItem) => void;
  onCancelEditReminder: () => void;
  onSetReminderStatus: (id: string, status: "done" | "cancelled") => void;
  comments: CommentItem[];
  legacyNotes: LegacyNote[];
  newComment: string;
  setNewComment: (value: string) => void;
  addingComment: boolean;
  onAddComment: () => void;
  colorIndexById: Map<string, number>;
  chosenColorById: Map<string, string>;
}) {
  return (
    <div className="space-y-4 rounded-lg bg-muted/40 p-4 lg:p-5">
      {/* Reminders */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <NotificationIcon className="h-4 w-4 text-muted-foreground" />
          תזכורות
        </div>
        {reminders.filter((r) => r.status === "pending").length === 0 ? (
          <div className="text-xs text-muted-foreground">אין תזכורות פעילות.</div>
        ) : (
          <div className="space-y-1.5">
            {reminders
              .filter((r) => r.status === "pending")
              .map((reminder) => (
                <div
                  key={reminder.id}
                  className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                    editingReminderId === reminder.id ? "border-primary/50 bg-primary/5" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="font-medium">{formatShortDateTime(reminder.remind_at)}</div>
                    {reminder.content ? (
                      <div className="truncate text-xs text-muted-foreground">{reminder.content}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <EditButton onClick={() => onEditReminder(reminder)} label="עריכת תזכורת" />
                    <Button type="button" size="sm" variant="secondary" onClick={() => onSetReminderStatus(reminder.id, "done")}>
                      בוצע
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => onSetReminderStatus(reminder.id, "cancelled")}>
                      ביטול
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        )}
        <AdaptiveGrid variant="formTwo">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">מועד התזכורת</div>
            <DateTimeInput value={reminderAt} onChange={(e) => setReminderAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">הערה (אופציונלי)</div>
            <Input value={reminderNote} onChange={(e) => setReminderNote(e.target.value)} />
          </div>
        </AdaptiveGrid>
        <div className="flex justify-end gap-1.5">
          {editingReminderId ? (
            <Button type="button" size="sm" variant="outline" disabled={addingReminder} onClick={onCancelEditReminder}>
              ביטול עריכה
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={!reminderAt || addingReminder} onClick={onAddReminder}>
            {addingReminder ? "שומר..." : editingReminderId ? "עדכון תזכורת" : "הוספת תזכורת"}
          </Button>
        </div>
      </section>

      {/* Comments */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <CommentIcon className="h-4 w-4 text-muted-foreground" />
          תגובות
        </div>
        {comments.length === 0 && legacyNotes.length === 0 ? (
          <div className="text-xs text-muted-foreground">אין תגובות עדיין.</div>
        ) : (
          <div className="space-y-2">
            {/* Legacy comments stored in tasks.notes (read-only history). */}
            {legacyNotes.map((note, index) => (
              <div key={`legacy-${index}`} className="rounded-md border bg-muted/20 px-3 py-2">
                {note.stamp && note.author ? (
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{note.author}</span>
                    <span className="text-[11px] text-muted-foreground">{note.stamp}</span>
                  </div>
                ) : null}
                <div className="mt-0.5 whitespace-pre-wrap text-sm">{note.message ?? note.raw}</div>
              </div>
            ))}
            {comments.map((comment) => (
              <div key={comment.id} className="flex gap-2">
                <InitialsAvatar name={comment.author_name} color={comment.author_id ? chosenColorById.get(comment.author_id) : undefined} colorKey={comment.author_id} colorIndex={comment.author_id ? colorIndexById.get(comment.author_id) : undefined} size="sm" />
                <div className="min-w-0 flex-1 rounded-md border bg-muted/20 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{comment.author_name ?? "משתמש"}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatShortDateTime(comment.created_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap text-sm">{comment.body}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="כתבו תגובה..."
          className="min-h-16"
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={addingComment || !newComment.trim()} onClick={onAddComment}>
            {addingComment ? "שומר..." : "הוספת תגובה"}
          </Button>
        </div>
      </section>
    </div>
  );
}
