"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { MetaRow } from "@/components/ui/meta-row";
import { SectionCard } from "@/components/ui/section-card";
import { Textarea } from "@/components/ui/textarea";
import {
  AddIcon,
  AllDoneIcon,
  ChecklistIcon,
  HistoryIcon,
  SettingsIcon,
  WarningIcon,
} from "@/components/ui/icons";
import { TaskUpsertDialog } from "@/components/tasks/TaskUpsertDialog";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { cn } from "@/lib/utils";
import {
  addAdHocItem,
  deleteMeetingItem,
  linkTaskToMeeting,
  patchMeeting,
  patchMeetingItem,
  setMeetingItemDone,
  type MeetingItemPatch,
} from "@/lib/meetings/client";
import type { UserOption } from "@/lib/meetings/load";
import {
  AUTO_SOURCE_PREVIOUS_TASKS,
  type Meeting,
  type MeetingItem,
  type MeetingTask,
  type WeekStats,
} from "@/lib/meetings/types";
import MeetingItemRow from "./MeetingItemRow";
import { useOpenInNewTab } from "./useOpenInNewTab";
import PreviousTasksPanel from "./PreviousTasksPanel";
import MeetingTemplatesDialog from "./MeetingTemplatesDialog";
import WeekNumbers from "./WeekNumbers";

// The meeting itself: numbers, prep, agenda, summary. One scroll from top to
// bottom, in the order the meeting is actually run — which is why this is a
// single column and not a set of tabs, on desktop as on mobile. On the shared
// screen the manager never has to hunt for the next item.

function formatMeetingDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

type TaskDialogState = { item: MeetingItem } | null;

export function MeetingClient({
  meeting,
  items: initialItems,
  stats,
  previousMeetingDate,
  previousTasks,
  users,
  currentUserId,
  viewerRole,
  readOnly = false,
}: {
  meeting: Meeting;
  items: MeetingItem[];
  stats: WeekStats;
  previousMeetingDate: string | null;
  previousTasks: MeetingTask[];
  users: UserOption[];
  currentUserId: string;
  viewerRole: string;
  /** A meeting opened from history: everything renders, nothing writes. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  // Desktop browser only: agenda links open in a tab so the meeting stays on
  // the wall screen behind them.
  const openInNewTab = useOpenInNewTab();
  const [items, setItems] = useState(initialItems);
  const [taskDialog, setTaskDialog] = useState<TaskDialogState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MeetingItem | null>(null);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  const [target, setTarget] = useState(
    meeting.collectionTarget != null ? String(meeting.collectionTarget) : ""
  );
  const [nextDate, setNextDate] = useState(meeting.nextMeetingDate ?? "");
  const [meetingNotes, setMeetingNotes] = useState(meeting.notes ?? "");
  const [savingSummary, setSavingSummary] = useState(false);

  const prepItems = useMemo(() => items.filter((i) => i.kind === "prep"), [items]);
  const agendaItems = useMemo(() => items.filter((i) => i.kind === "agenda"), [items]);
  const agendaDone = agendaItems.filter((i) => i.isDone).length;
  const prepOutstanding = prepItems.filter((i) => !i.isDone);
  const closed = meeting.status === "closed";
  const locked = readOnly || closed;

  const applyLocal = useCallback((id: string, patch: Partial<MeetingItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const handleToggle = useCallback(
    async (item: MeetingItem, next: boolean) => {
      // Optimistic: on a shared screen a checkbox that waits for a round trip
      // reads as a dead click, and someone taps it twice.
      applyLocal(item.id, {
        isDone: next,
        doneBy: next ? currentUserId : null,
        doneByName: next ? users.find((u) => u.id === currentUserId)?.label ?? null : null,
        doneAt: next ? new Date().toISOString() : null,
      });
      try {
        await setMeetingItemDone(item.id, next, currentUserId);
      } catch (err) {
        applyLocal(item.id, {
          isDone: item.isDone,
          doneBy: item.doneBy,
          doneByName: item.doneByName,
          doneAt: item.doneAt,
        });
        throw err;
      }
    },
    [applyLocal, currentUserId, users]
  );

  const handlePatch = useCallback(
    async (id: string, patch: MeetingItemPatch) => {
      await patchMeetingItem(id, patch);
      applyLocal(id, {
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.assigned_user_id !== undefined ? { assignedUserId: patch.assigned_user_id } : {}),
      });
    },
    [applyLocal]
  );

  const saveSummary = useCallback(async () => {
    setSavingSummary(true);
    try {
      const parsed = Number(target.replace(/[^\d.-]/g, ""));
      await patchMeeting(meeting.id, {
        collection_target: target.trim() && Number.isFinite(parsed) ? parsed : null,
        next_meeting_date: nextDate || null,
        notes: meetingNotes.trim() || null,
      });
      toast.success("סיכום הישיבה נשמר");
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "שמירת הסיכום נכשלה");
    } finally {
      setSavingSummary(false);
    }
  }, [meeting.id, meetingNotes, nextDate, router, target]);

  const closeMeeting = useCallback(async () => {
    setClosing(true);
    try {
      await patchMeeting(meeting.id, {
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: currentUserId,
        // Freeze the numbers as they stood at the close, so reopening this
        // meeting later shows the week it actually reviewed.
        stats,
      });
      toast.success("הישיבה נסגרה");
      setCloseOpen(false);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "סגירת הישיבה נכשלה");
    } finally {
      setClosing(false);
    }
  }, [currentUserId, meeting.id, router, stats]);

  const addItem = useCallback(async () => {
    const title = newItemTitle.trim();
    if (!title) return;
    setAddingItem(true);
    try {
      const maxPosition = agendaItems.reduce((max, i) => Math.max(max, i.position), 0);
      const id = await addAdHocItem({
        meetingId: meeting.id,
        kind: "agenda",
        title,
        position: maxPosition + 5,
      });
      setItems((prev) => [
        ...prev,
        {
          id,
          meetingId: meeting.id,
          templateId: null,
          kind: "agenda",
          position: maxPosition + 5,
          title,
          subpoints: [],
          linkHref: null,
          linkLabel: null,
          autoSource: null,
          isDone: false,
          doneBy: null,
          doneByName: null,
          doneAt: null,
          assignedUserId: null,
          notes: null,
          carriedOverFrom: null,
          carriedOverFromDate: null,
        },
      ]);
      setNewItemTitle("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "הוספת הסעיף נכשלה");
    } finally {
      setAddingItem(false);
    }
  }, [agendaItems, meeting.id, newItemTitle]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMeetingItem(deleteTarget.id);
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "מחיקת הסעיף נכשלה");
    }
  }, [deleteTarget]);

  // The due date a task raised here gets: the next meeting, because that is
  // when it will be asked about (agenda item 0).
  const taskDueDate = meeting.nextMeetingDate || nextDate || "";

  return (
    <div className="space-y-4" dir="rtl">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">ישיבה שבועית</h1>
          <MetaRow
            className="text-xs text-muted-foreground"
            items={[
              formatMeetingDate(meeting.meetingDate),
              closed ? "ישיבה סגורה" : "ישיבה פתוחה",
              meeting.nextMeetingDate ? `הישיבה הבאה ${formatMeetingDate(meeting.nextMeetingDate)}` : null,
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
              agendaDone === agendaItems.length && agendaItems.length > 0
                ? getStatusColorClasses("success")
                : getStatusColorClasses("info")
            )}
          >
            <ChecklistIcon className="h-4 w-4" />
            {agendaDone} / {agendaItems.length}
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/meetings/history">
              <HistoryIcon />
              היסטוריה
            </Link>
          </Button>
          {!locked ? (
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon />
              עריכת הסעיפים
            </Button>
          ) : null}
        </div>
      </div>

      <WeekNumbers stats={stats} frozen={closed} />

      {/* ── Prep ───────────────────────────────────────────────────── */}
      <SectionCard
        icon={<ChecklistIcon className="h-4 w-4" />}
        title="הכנה לישיבה"
        aside={
          prepItems.length === 0 ? null : prepOutstanding.length === 0 ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                getStatusColorClasses("success")
              )}
            >
              <AllDoneIcon className="h-3.5 w-3.5" />
              ההכנה הושלמה
            </span>
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
                getStatusColorClasses("warning")
              )}
            >
              <WarningIcon className="h-3.5 w-3.5" />
              {`ההכנה לא הושלמה — ${prepOutstanding.length} מתוך ${prepItems.length}`}
            </span>
          )
        }
      >
        {prepItems.length === 0 ? (
          <p className="text-xs text-muted-foreground">לא הוגדרו סעיפי הכנה.</p>
        ) : (
          <div className="space-y-2">
            {prepItems.map((item) => (
              <MeetingItemRow
                key={item.id}
                item={item}
                index={null}
                users={users}
                readOnly={locked}
                onToggleDone={handleToggle}
                onPatch={handlePatch}
                onAddTask={(target) => setTaskDialog({ item: target })}
                openInNewTab={openInNewTab}
                onDelete={item.templateId ? undefined : (target) => setDeleteTarget(target)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Agenda ─────────────────────────────────────────────────── */}
      <SectionCard icon={<ChecklistIcon className="h-4 w-4" />} title="סדר היום">
        <div className="space-y-2">
          {agendaItems.map((item, index) => (
            <MeetingItemRow
              key={item.id}
              item={item}
              index={index}
              users={users}
              readOnly={locked}
              onToggleDone={handleToggle}
              onPatch={handlePatch}
              onAddTask={(target) => setTaskDialog({ item: target })}
              openInNewTab={openInNewTab}
              onDelete={item.templateId ? undefined : (target) => setDeleteTarget(target)}
            >
              {item.autoSource === AUTO_SOURCE_PREVIOUS_TASKS ? (
                <PreviousTasksPanel
                  tasks={previousTasks}
                  previousMeetingDate={previousMeetingDate}
                  openInNewTab={openInNewTab}
                />
              ) : null}
            </MeetingItemRow>
          ))}

          {!locked ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border/70 p-3">
              <Input
                value={newItemTitle}
                onChange={(event) => setNewItemTitle(event.target.value)}
                placeholder="סעיף נוסף לישיבה הזו בלבד"
                className="h-9 min-w-[14rem] flex-1"
                aria-label="כותרת סעיף חדש"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addItem();
                  }
                }}
              />
              <Button size="sm" onClick={() => void addItem()} disabled={!newItemTitle.trim() || addingItem}>
                <AddIcon />
                {addingItem ? "מוסיף..." : "הוספה"}
              </Button>
            </div>
          ) : null}
        </div>
      </SectionCard>

      {/* ── Summary ────────────────────────────────────────────────── */}
      <SectionCard icon={<AllDoneIcon className="h-4 w-4" />} title="סיכום ההחלטות">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">יעד הגבייה לשבוע הבא</span>
            <CurrencyInput
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={locked}
              placeholder="0"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">תאריך הישיבה הבאה</span>
            <DateInput value={nextDate} onChange={(event) => setNextDate(event.target.value)} disabled={locked} />
          </label>
        </div>
        <Textarea
          value={meetingNotes}
          onChange={(event) => setMeetingNotes(event.target.value)}
          disabled={locked}
          rows={3}
          placeholder="סיכום כללי של הישיבה"
          aria-label="סיכום כללי של הישיבה"
        />
        {!locked ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void saveSummary()} disabled={savingSummary}>
              {savingSummary ? "שומר..." : "שמירת הסיכום"}
            </Button>
            <Button variant="success" onClick={() => setCloseOpen(true)}>
              <AllDoneIcon />
              סגירת הישיבה
            </Button>
          </div>
        ) : null}
      </SectionCard>

      {/* ── Dialogs ────────────────────────────────────────────────── */}
      {taskDialog ? (
        <TaskUpsertDialog
          open
          onOpenChange={(next) => {
            if (!next) setTaskDialog(null);
          }}
          mode="create"
          wizard
          users={users}
          currentUserId={currentUserId}
          viewerRole={viewerRole}
          defaultSubject={taskDialog.item.title}
          defaultDueDate={taskDueDate}
          onSaved={(created) => {
            const taskId = created && typeof created.id === "string" ? created.id : null;
            setTaskDialog(null);
            if (!taskId) {
              // Saved, but we didn't get the row back — the task exists, it just
              // isn't tied to this meeting, and saying so is better than a
              // silent gap in next week's item 0.
              toast.warning("המשימה נוצרה אך לא שויכה לישיבה");
              router.refresh();
              return;
            }
            void linkTaskToMeeting({
              meetingId: meeting.id,
              meetingItemId: taskDialog.item.id,
              taskId,
            })
              .then(() => toast.success("המשימה נוצרה ושויכה לישיבה"))
              .catch((err: unknown) => {
                toast.error(err instanceof Error ? err.message : "שיוך המשימה לישיבה נכשל");
              })
              .finally(() => router.refresh());
          }}
        />
      ) : null}

      <MeetingTemplatesDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        users={users}
        onSaved={() => router.refresh()}
      />

      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="לסגור את הישיבה?"
        description={
          agendaDone < agendaItems.length
            ? `${agendaItems.length - agendaDone} סעיפים לא סומנו. הם יועברו לישיבה הבאה ויסומנו כהועברו.`
            : "כל הסעיפים סומנו. הישיבה תיסגר ותעבור להיסטוריה."
        }
        confirmLabel="סגירת הישיבה"
        loading={closing}
        onConfirm={() => void closeMeeting()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
        title="למחוק את הסעיף?"
        description={deleteTarget ? `"${deleteTarget.title}" יימחק מהישיבה הזו.` : undefined}
        confirmLabel="מחיקה"
        destructive
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

export default MeetingClient;
