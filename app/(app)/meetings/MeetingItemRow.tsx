"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/icon-button";
import { MetaRow } from "@/components/ui/meta-row";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import {
  AddIcon,
  CheckboxCheckedIcon,
  CheckboxUncheckedIcon,
  ExternalLinkIcon,
  HistoryIcon,
  NoteIcon,
  SpinnerIcon,
} from "@/components/ui/icons";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { cn } from "@/lib/utils";
import type { MeetingItem } from "@/lib/meetings/types";
import type { UserOption } from "@/lib/meetings/load";

// One row of the meeting — the same component for a prep row and an agenda row,
// because they do the same four things (tick, note, open the page, raise a
// task). What differs is only what is shown: an agenda row wears its number, a
// prep row wears its owner.

function formatDoneAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
}

function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : null;
}

const NOTES_DEBOUNCE_MS = 700;

export function MeetingItemRow({
  item,
  index,
  users,
  readOnly,
  onToggleDone,
  onPatch,
  onAddTask,
  openInNewTab,
  onDelete,
  children,
}: {
  item: MeetingItem;
  /** The agenda number shown in the corner. null for prep rows. */
  index: number | null;
  users: UserOption[];
  readOnly: boolean;
  onToggleDone: (item: MeetingItem, next: boolean) => Promise<void>;
  onPatch: (id: string, patch: { notes?: string | null; assigned_user_id?: string | null }) => Promise<void>;
  onAddTask: (item: MeetingItem) => void;
  /** Desktop shared screen: open the agenda link in a tab so the meeting stays up. */
  openInNewTab: boolean;
  /** Only offered for a hand-added item — a seeded one is disabled in settings, not deleted here. */
  onDelete?: (item: MeetingItem) => void;
  /** Auto-filled body (agenda item 0's task list). */
  children?: React.ReactNode;
}) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [toggling, setToggling] = useState(false);
  // An always-open textarea on every row turns the agenda into a column of
  // empty grey boxes on a wall screen, and roughly doubles the scrolling. A row
  // with something written on it shows it; an empty one offers a link instead.
  const [notesOpen, setNotesOpen] = useState(() => Boolean((item.notes ?? "").trim()));
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last value we know is on the server. The row is "dirty" whenever what
  // is in the box differs from it.
  const savedRef = useRef(item.notes ?? "");
  const dirtyRef = useRef(false);
  /** What is in the box right now, readable from inside an async callback. */
  const latestTypedRef = useRef(item.notes ?? "");

  // A note being typed must survive the router.refresh() that a sibling row's
  // tick triggers. Compare against the DIRTY flag, not against the incoming
  // prop: half-typed text and an unchanged empty note look identical from the
  // server's side, and letting the prop win there wipes what was just typed.
  useEffect(() => {
    if (dirtyRef.current) return;
    savedRef.current = item.notes ?? "";
    setNotes(item.notes ?? "");
    // Someone else wrote a note on this row — never keep it folded away.
    if ((item.notes ?? "").trim()) setNotesOpen(true);
  }, [item.notes]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const saveNotes = useCallback(
    (value: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setSavingNotes(true);
        void onPatch(item.id, { notes: value.trim() || null })
          .then(() => {
            savedRef.current = value;
            // Anything typed DURING the save keeps the row dirty, so the next
            // refresh still can't overwrite it.
            dirtyRef.current = latestTypedRef.current !== value;
          })
          .catch((err: unknown) => {
            // Typing IS a real user action, so a failed save must say so —
            // silently losing what was written in the meeting is the worst
            // outcome this page has.
            toast.error(err instanceof Error ? err.message : "שמירת ההערה נכשלה");
          })
          .finally(() => setSavingNotes(false));
      }, NOTES_DEBOUNCE_MS);
    },
    [item.id, onPatch]
  );

  const toggle = async () => {
    if (readOnly || toggling) return;
    setToggling(true);
    try {
      await onToggleDone(item, !item.isDone);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "עדכון הסעיף נכשל");
    } finally {
      setToggling(false);
    }
  };

  const doneAt = formatDoneAt(item.doneAt);
  const carriedFrom = formatDay(item.carriedOverFromDate);

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card/80 p-3 shadow-sm transition-colors",
        item.isDone ? "border-success/40 bg-success-soft/30" : "border-border/70"
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={readOnly || toggling}
          aria-pressed={item.isDone}
          aria-label={item.isDone ? `ביטול סימון: ${item.title}` : `סימון כבוצע: ${item.title}`}
          className={cn(
            "mt-0.5 shrink-0 rounded-lg p-1 transition-colors",
            item.isDone ? "text-success" : "text-muted-foreground hover:text-secondary",
            readOnly && "cursor-default opacity-70"
          )}
        >
          {toggling ? (
            <SpinnerIcon className="h-6 w-6 animate-spin" />
          ) : item.isDone ? (
            <CheckboxCheckedIcon className="h-6 w-6" />
          ) : (
            <CheckboxUncheckedIcon className="h-6 w-6" />
          )}
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {index !== null ? (
              <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-bold text-primary">
                {index}
              </span>
            ) : null}
            <h3 className={cn("text-sm font-semibold", item.isDone && "text-muted-foreground")}>{item.title}</h3>
            {carriedFrom ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium",
                  getStatusColorClasses("warning")
                )}
              >
                <HistoryIcon className="h-3 w-3" />
                הועבר מישיבת {carriedFrom}
              </span>
            ) : null}
          </div>

          {item.subpoints.length > 0 ? (
            <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
              {item.subpoints.map((point, i) => (
                <li key={i} className="flex gap-1.5">
                  <span aria-hidden className="text-muted-foreground/60">
                    •
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {children}

          {notesOpen ? (
            <Textarea
              ref={notesRef}
              value={notes}
              onChange={(event) => {
                const next = event.target.value;
                setNotes(next);
                latestTypedRef.current = next;
                dirtyRef.current = next !== savedRef.current;
                saveNotes(next);
              }}
              disabled={readOnly}
              rows={2}
              placeholder="הערות, החלטות ופערים שנמצאו"
              className="min-h-[3.25rem] resize-y text-sm"
              aria-label={`הערות לסעיף ${item.title}`}
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {item.linkHref ? (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={item.linkHref}
                  // On the shared screen the agenda must stay up behind the page
                  // it opens — see useOpenInNewTab for why this isn't always on.
                  target={openInNewTab ? "_blank" : undefined}
                  rel={openInNewTab ? "noopener noreferrer" : undefined}
                >
                  <ExternalLinkIcon />
                  {item.linkLabel || "פתיחת הדף"}
                </Link>
              </Button>
            ) : null}

            {!readOnly ? (
              <Button size="sm" variant="outline" onClick={() => onAddTask(item)}>
                <AddIcon />
                משימה
              </Button>
            ) : null}

            {!notesOpen && !readOnly ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setNotesOpen(true);
                  // The box mounts in this render; focus it once it is painted,
                  // so the click lands straight in the field.
                  requestAnimationFrame(() => notesRef.current?.focus());
                }}
              >
                <NoteIcon />
                הערה
              </Button>
            ) : null}

            {item.kind === "prep" ? (
              <div className="flex min-w-[11rem] items-center gap-1.5">
                <span className="shrink-0 text-xs text-muted-foreground">אחראי</span>
                <SearchableSelect
                  options={users.map((u) => ({ value: u.id, label: u.label }))}
                  value={item.assignedUserId ?? ""}
                  onChange={(value) => {
                    void onPatch(item.id, { assigned_user_id: value || null }).catch((err: unknown) => {
                      toast.error(err instanceof Error ? err.message : "עדכון האחראי נכשל");
                    });
                  }}
                  disabled={readOnly}
                  emptyOptionLabel="ללא אחראי"
                  placeholder="בחירת אחראי"
                  ariaLabel={`אחראי על ${item.title}`}
                  className="h-9"
                />
              </div>
            ) : null}

            {savingNotes ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <SpinnerIcon className="h-3 w-3 animate-spin" />
                שומר
              </span>
            ) : null}

            {onDelete && !readOnly ? (
              <DeleteButton label={`מחיקת הסעיף ${item.title}`} className="ms-auto" onClick={() => onDelete(item)} />
            ) : null}
          </div>

          {item.isDone && (doneAt || item.doneByName) ? (
            <MetaRow
              className="text-[0.6875rem] text-muted-foreground"
              items={[item.doneByName ? `סומן על ידי ${item.doneByName}` : null, doneAt]}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default MeetingItemRow;
