"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { computeInsertSortOrder } from "@/lib/tasks/sortOrder";
import { AddIcon, AttachIcon, BuildingIcon, ClockIcon, CloseIcon, CommentIcon, DragIcon, FilterIcon, LockIcon, NotificationIcon, ProjectIcon, RecurringIcon, SearchIcon, SuccessIcon, UncheckedIcon, UserIcon, WazeIcon, ZoomInIcon, ZoomOutIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { offlineFetch } from "@/lib/offline-queue";
import { BOARD_STATUSES, type TaskBoardItem } from "@/app/(app)/tasks/loadTasks";
import { AddressLink } from "@/components/ui/address-link";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedLines, parseTaskLines } from "@/components/tasks/taskLines.helpers";
import { StatusBadge } from "@/components/ui/status-badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { InitialsAvatar, buildColorIndexMap } from "@/components/dashboard/InitialsAvatar";
import { dueUrgencyChipClass, formatShortDate, getDueUrgency } from "@/lib/date";
import { TaskUpsertDialog, type TaskOption, type UserOption } from "@/components/tasks/TaskUpsertDialog";
import { emitNavigationStart, emitProgressActivityEnd, emitProgressActivityStart } from "@/components/layout/TopNavigationProgress";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { getTaskPriorityLabel, getTaskStatusLabel } from "@/lib/ui/status-colors";
import type { Locale } from "@/lib/i18n/types";
import { t } from "@/lib/i18n/t";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import { tasksDict } from "@/lib/i18n/dictionaries/tasks";

// Bidirectional: subject_he is only ever set when the AUTHOR's own locale was
// 'ar' (see app/api/tasks/create) — so its presence means `original` is
// already Arabic. subject_ar is the reverse: a Hebrew-authored task's title,
// lazily translated + cached for an Arabic viewer (see loadTasksBoard).
function preferHe(
  original: string,
  translatedHe: string | null | undefined,
  locale: Locale,
  translatedAr?: string | null
) {
  if (locale === "he") return translatedHe || original;
  if (translatedHe) return original;
  return translatedAr || original;
}

type Props = {
  tasks: TaskBoardItem[];
  projects: TaskOption[];
  properties: TaskOption[];
  customers: TaskOption[];
  users: UserOption[];
  canSeeAll?: boolean;
  currentUserId: string;
  locale: Locale;
  initialFilters?: {
    q: string;
    priority: string;
    domain: string;
    linkedId: string;
    scope: "mine" | "all";
  };
};

const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;
const COLUMN_PREFIX = "column:";

// The magnifier is a two-state toggle: normal, or the whole list shrunk to fit
// the screen. The card's text and spacing are `em`, so a font-size on the
// scroller scales entire cards. 1 = normal (a card's base text is text-sm).
const CARD_BASE_REM = 0.875;
// Used when the list already fits and there's nothing to measure a fit against.
const OVERVIEW_FALLBACK_ZOOM = 0.6;
const MIN_OVERVIEW_ZOOM = 0.35;
// How far the board's background runs on past its content (behind the bottom nav
// on a phone, past the bottom of the window on desktop). The parent clips it —
// keep the clip margin there bigger than this.
const BOARD_BLEED = 48;
// The only priorities a card shows. "בינונית" on every card is a chip that says
// nothing — the badge is worth its space only when the task deviates from normal.
const SHOWN_PRIORITIES = new Set(["high", "urgent"]);

type UrlFilters = {
  q: string;
  priority: string;
  domain: string;
  linkedId: string;
  scope: "mine" | "all";
};

function buildTasksUrl(filters: UrlFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.domain) params.set("domain", filters.domain);
  if (filters.linkedId) params.set("linked_id", filters.linkedId);
  // "mine" is the default for everyone, so only persist the opt-in "all".
  if (filters.scope === "all") params.set("scope", "all");
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

function columnSortableId(status: string) {
  return `${COLUMN_PREFIX}${status}`;
}

/**
 * A card for the board's local state before the server round trip confirms
 * it — used so a just-created task appears instantly instead of waiting on a
 * toast-then-refresh. Fields the create response doesn't carry (joined
 * project/customer names, members, counts) default to "unknown yet";
 * router.refresh() replaces this row with the authoritative one moments later.
 */
function buildOptimisticTask(fields: {
  id: string;
  subject: string;
  status: string;
  priority?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  city?: string | null;
  business_domain?: string | null;
  project_id?: string | null;
  property_id?: string | null;
  customer_id?: string | null;
  assigned_user_id?: string | null;
  assigned_user_name?: string | null;
  is_private?: boolean | null;
  sort_order: number;
}): TaskBoardItem {
  const dueDate = fields.due_date ?? null;
  const status = fields.status;
  const todayIso = new Date().toISOString().slice(0, 10);
  return {
    id: fields.id,
    subject: fields.subject,
    subject_he: null,
    subject_ar: null,
    status,
    priority: fields.priority ?? "medium",
    due_date: dueDate,
    due_time: fields.due_time ?? null,
    city: fields.city ?? null,
    business_domain: fields.business_domain ?? null,
    project_id: fields.project_id ?? null,
    property_id: fields.property_id ?? null,
    customer_id: fields.customer_id ?? null,
    project_name: null,
    property_name: null,
    customer_name: null,
    customer_phone: null,
    assigned_user_id: fields.assigned_user_id ?? null,
    assigned_user_name: fields.assigned_user_name ?? null,
    members: [],
    comment_count: 0,
    attachment_count: 0,
    has_open_reminder: false,
    is_overdue: status !== "done" && status !== "cancelled" && dueDate !== null && dueDate.slice(0, 10) < todayIso,
    is_private: fields.is_private === true,
    sort_order: fields.sort_order,
  };
}

// ─── Card ──────────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  onOpen,
  onToggleDone,
  onContextMenu,
  colorIndexById,
  longPress,
  overview,
  locale,
}: {
  task: TaskBoardItem;
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  colorIndexById: Map<string, number>;
  /** Phones: hold a card to open its menu (there's no right-click and no drag). */
  longPress: boolean;
  /** Zoomed out: titles only — the point is to see the list, not each card. */
  overview: boolean;
  locale: Locale;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform, transition } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const extraMembers = task.members.length > 3 ? task.members.length - 3 : 0;
  const isDone = task.status === "done";
  const displaySubject = preferHe(task.subject, task.subject_he, locale, task.subject_ar);
  // Colour the due date by how close it is: red ≤3 days / overdue, yellow ≤1 week.
  const dueUrgency = getDueUrgency(task.due_date, { done: isDone });
  const dueChipClass = dueUrgencyChipClass(dueUrgency);

  // Long press → the card menu, opened on the RELEASE rather than while the
  // finger is still down. A menu that appears under a finger is dismissed by
  // that same finger: the click which follows the press lands on whatever the
  // menu just put there. So the press only ARMS it (with a haptic tick, so the
  // hold is acknowledged) and the click that ends the press opens it — after
  // which no further click is pending. The timer is cancelled by a move (that's
  // a scroll, not a press) or by lifting early.
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef({ x: 0, y: 0 });
  const menuPendingRef = useRef(false);
  const cancelPress = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);
  useEffect(() => cancelPress, [cancelPress]);

  // Everything the meta row carries — skipped entirely when zoomed out.
  const hasMeta =
    Boolean(task.project_name || task.property_name || task.customer_name || task.due_date || task.city) ||
    task.is_private ||
    task.has_open_reminder ||
    task.attachment_count > 0 ||
    task.comment_count > 0;

  // Sizes below are `em`, not rem: the board's magnifier sets a font-size on the
  // scroller and the whole card — text, padding, glyphs — scales with it.
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={() => {
        if (menuPendingRef.current) {
          menuPendingRef.current = false;
          onContextMenu(task.id, pressStartRef.current.x, pressStartRef.current.y);
          return;
        }
        onOpen(task.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(task.id, e.clientX, e.clientY);
      }}
      onPointerDown={(e) => {
        if (!longPress || e.pointerType === "mouse") return;
        pressStartRef.current = { x: e.clientX, y: e.clientY };
        // Reset here too: a press that armed the menu but never produced a click
        // (the finger scrolled away) must not fire on the NEXT tap.
        menuPendingRef.current = false;
        cancelPress();
        pressTimerRef.current = setTimeout(() => {
          menuPendingRef.current = true;
          navigator.vibrate?.(12);
        }, 420);
      }}
      onPointerMove={(e) => {
        if (!pressTimerRef.current) return;
        const moved =
          Math.abs(e.clientX - pressStartRef.current.x) + Math.abs(e.clientY - pressStartRef.current.y);
        if (moved > 10) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      className={`group cursor-pointer select-none rounded-lg border bg-card p-[0.55em] text-[1em] shadow-card transition duration-150 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated active:translate-y-0 active:shadow-card ${
        isDragging ? "opacity-40 shadow-elevated" : ""
      }`}
    >
      {/* Title line carries the badge and the faces too — they used to cost a row
          each, which is why four cards filled a phone screen. */}
      <div className="flex items-start gap-[0.5em]">
        {/* Complete circle — click to move to/from done (Trello-style). */}
        <button
          type="button"
          aria-label={t(tasksDict, locale, isDone ? "undoDoneAria" : "markDoneAria")}
          title={t(tasksDict, locale, isDone ? "undoDoneTitle" : "markDoneTitleBoard")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone(task.id, !isDone);
          }}
          className="mt-[0.15em] shrink-0 text-muted-foreground transition duration-150 hover:text-success group-hover:scale-110"
        >
          {isDone ? (
            <SuccessIcon className="h-[1.15em] w-[1.15em] text-success" />
          ) : (
            <UncheckedIcon className="h-[1.15em] w-[1.15em]" />
          )}
        </button>
        <div className={`min-w-0 flex-1 font-medium leading-snug ${isDone ? "text-muted-foreground line-through" : ""}`}>
          {displaySubject}
        </div>
        {!overview && task.priority && SHOWN_PRIORITIES.has(task.priority) ? (
          <StatusBadge value={task.priority} type="priority" className="shrink-0 text-[0.72em]" locale={locale} />
        ) : null}
        {!overview && task.members.length > 0 ? (
          <div className="flex shrink-0 -space-x-1.5">
            {task.members.slice(0, 3).map((member) => (
              <InitialsAvatar key={member.id} name={member.name} color={member.color} colorKey={member.id} colorIndex={colorIndexById.get(member.id)} size="xs" className="ring-2 ring-background" />
            ))}
            {extraMembers > 0 ? (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-medium ring-2 ring-background">
                +{extraMembers}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* One wrapped meta row: what it's attached to, when it's due, and the
          indicators — instead of three separate lines. */}
      {!overview && hasMeta ? (
        <div className="mt-[0.35em] flex flex-wrap items-center gap-x-[0.5em] gap-y-[0.2em] text-[0.8em] text-muted-foreground">
          {task.due_date ? (
            <span
              className={
                dueChipClass
                  ? `inline-flex items-center gap-[0.3em] rounded-md border px-[0.4em] py-[0.1em] font-medium ${dueChipClass}`
                  : ""
              }
            >
              {dueChipClass ? <ClockIcon className="h-[1.1em] w-[1.1em]" /> : null}
              {formatShortDate(task.due_date)}
              {task.due_time ? ` ${task.due_time}` : ""}
            </span>
          ) : null}
          {task.project_name ? (
            <span className="inline-flex max-w-full items-center gap-[0.25em]">
              <ProjectIcon className="h-[1.1em] w-[1.1em] shrink-0" />
              <span className="min-w-0 break-words">{task.project_name}</span>
            </span>
          ) : null}
          {task.property_name ? (
            <span className="inline-flex max-w-full items-center gap-[0.25em]">
              <BuildingIcon className="h-[1.1em] w-[1.1em] shrink-0" />
              <span className="min-w-0 break-words">{task.property_name}</span>
            </span>
          ) : null}
          {task.customer_name ? (
            <span className="inline-flex max-w-full items-center gap-[0.25em]">
              <UserIcon className="h-[1.1em] w-[1.1em] shrink-0" />
              <span className="min-w-0 break-words">
                {task.customer_name}
                {task.customer_phone ? <span dir="ltr"> · {task.customer_phone}</span> : null}
              </span>
            </span>
          ) : null}
          {task.city ? (
            <AddressLink address={task.city} className="inline-flex items-center gap-[0.2em]">
              <WazeIcon className="h-[1.1em] w-[1.1em]" />
              {task.city}
            </AddressLink>
          ) : null}
          {task.is_private ? (
            <span title={t(tasksDict, locale, "privateTaskCardTitle")}>
              <LockIcon className="h-[1.15em] w-[1.15em]" />
            </span>
          ) : null}
          {task.has_open_reminder ? <NotificationIcon className="h-[1.15em] w-[1.15em] text-warning-strong" /> : null}
          {task.attachment_count > 0 ? (
            <span
              className="inline-flex items-center gap-[0.2em]"
              title={
                task.attachment_count === 1
                  ? t(tasksDict, locale, "attachmentOneTitle")
                  : `${task.attachment_count} ${t(tasksDict, locale, "attachmentCountSuffix")}`
              }
            >
              <AttachIcon className="h-[1.15em] w-[1.15em]" />
              {task.attachment_count}
            </span>
          ) : null}
          {task.comment_count > 0 ? (
            <span className="inline-flex items-center gap-[0.2em]">
              <CommentIcon className="h-[1.15em] w-[1.15em]" />
              {task.comment_count}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Column ─────────────────────────────────────────────────────────────────────
function BoardColumn({
  status,
  tasks,
  onOpen,
  onToggleDone,
  onContextMenu,
  onQuickAdd,
  colorIndexById,
  onColumnRef,
  longPress,
  overview,
  locale,
}: {
  status: string;
  tasks: TaskBoardItem[];
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  /** One title per line — the box doubles as a list. */
  onQuickAdd: (status: string, titles: string[]) => Promise<void>;
  colorIndexById: Map<string, number>;
  /** Lets the board find this column's box so it can centre it on screen. */
  onColumnRef: (status: string, node: HTMLElement | null) => void;
  longPress: boolean;
  overview: boolean;
  locale: Locale;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: columnSortableId(status) });
  const [adding, setAdding] = useState<null | "top" | "bottom">(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const style = { transform: CSS.Translate.toString(transform), transition };

  async function submitQuickAdd() {
    const titles = parseTaskLines(title);
    if (titles.length === 0 || busy) return;
    setBusy(true);
    try {
      await onQuickAdd(status, titles);
      setTitle("");
      setAdding(null);
    } finally {
      setBusy(false);
    }
  }

  // Same rule as the full dialog: the title doubles as a list — paste or dictate
  // several and each line becomes its own card. A textarea (not an Input) so the
  // newlines survive at all.
  const addLines = parseTaskLines(title);
  const addBox = (
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <Textarea
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t(tasksDict, locale, "quickAddPlaceholder")}
        rows={Math.min(Math.max(addLines.length, 1), 6)}
        className="min-h-0 resize-none py-2 text-sm"
        onKeyDown={(e) => {
          // Enter adds; Shift+Enter starts another line.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submitQuickAdd();
          }
          if (e.key === "Escape") {
            setAdding(null);
            setTitle("");
          }
        }}
      />
      <div className="flex items-center gap-1.5">
        <Button type="button" size="sm" disabled={addLines.length === 0 || busy} onClick={() => void submitQuickAdd()}>
          {busy
            ? t(tasksDict, locale, "addingEllipsis")
            : addLines.length > 1
              ? `${t(tasksDict, locale, "addCountPrefix")} ${addLines.length}`
              : t(commonDict, locale, "add")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => { setAdding(null); setTitle(""); }}>
          {t(commonDict, locale, "cancel")}
        </Button>
        <DictateButton
          onTranscript={(text) => setTitle((prev) => appendDictatedLines(prev, text))}
          disabled={busy}
          title={t(tasksDict, locale, "dictateQuickAddTitle")}
          className="ms-auto"
        />
      </div>
      {addLines.length > 1 ? (
        <p className="text-[11px] text-muted-foreground">
          {addLines.length} {t(tasksDict, locale, "linesCountMid")} {addLines.length} {t(tasksDict, locale, "tasksWord")}
        </p>
      ) : null}
    </div>
  );

  // The list is a fixed-height column: a pinned header, a scrolling middle, and a
  // pinned "add a card" foot. Scrolling a list scrolls THAT list — not the page —
  // which is the whole reason the board fits a phone screen at all.
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        onColumnRef(status, node);
      }}
      style={style}
      data-column={status}
      className={`flex h-full min-h-0 w-[90vw] shrink-0 snap-center flex-col rounded-xl bg-muted lg:w-auto lg:shrink lg:snap-align-none ${
        isDragging ? "z-10 opacity-70" : ""
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-t-xl border-b border-border/60 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {/* Reordering lists is a desktop affordance: on a phone the grip was
              mostly grabbed by accident, and it cost header width. */}
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={t(tasksDict, locale, "dragListAria")}
            className="hidden shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing md:block"
          >
            <DragIcon className="h-4 w-4" />
          </button>
          {getTaskStatusLabel(status, locale)}
          <span className="shrink-0 rounded-full bg-background px-1.5 text-xs font-normal text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        {/* Always-visible add at the top of the list. */}
        <button
          type="button"
          onClick={() => setAdding("top")}
          aria-label={t(tasksDict, locale, "addCardLabel")}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <AddIcon className="h-4 w-4" />
        </button>
      </div>

      {/* overscroll-Y-contain, not overscroll-contain: reaching the end of a
          list must not hand the VERTICAL scroll to the page behind it, but
          `contain` locks BOTH axes — which is what stopped a sideways swipe over
          the cards from reaching the board and paging to the next list. The
          horizontal axis has to keep chaining outward.
          The gap between cards is `em` like the cards themselves, so the
          magnifier shrinks the spacing too — otherwise "fit the whole list on
          screen" stops fitting after a dozen cards. */}
      <div data-cards className="min-h-0 flex-1 space-y-[0.4em] overflow-y-auto overscroll-y-contain px-1.5 py-1.5">
        {adding === "top" ? addBox : null}

        {/* Vertical sortable list — lets a card be dragged up/down within this
            list (persisted via sort_order) in addition to across columns. */}
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onOpen={onOpen}
              onToggleDone={onToggleDone}
              onContextMenu={onContextMenu}
              colorIndexById={colorIndexById}
              longPress={longPress}
              overview={overview}
              locale={locale}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && adding === null ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{t(tasksDict, locale, "emptyColumnText")}</p>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border/60 px-1.5 py-1">
        {adding === "bottom" ? (
          addBox
        ) : (
          <button
            type="button"
            onClick={() => setAdding("bottom")}
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-start text-sm text-muted-foreground transition-colors hover:bg-background"
          >
            <AddIcon className="h-4 w-4" />
            {t(tasksDict, locale, "addCardLabel")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function TasksPageClient(props: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canSeeAll = props.canSeeAll ?? false;

  const urlQ = searchParams.get("q") ?? "";
  const urlPriority = searchParams.get("priority") ?? "";
  const urlDomain = searchParams.get("domain") ?? "";
  const urlLinkedId = searchParams.get("linked_id") ?? "";
  // Deep link to a single task (e.g. /tasks?task=<id>) opens its card. This is
  // what the old /tasks/[id] detail page redirects to now.
  const urlTask = searchParams.get("task") ?? "";
  const urlScope: "mine" | "all" = !canSeeAll ? "mine" : searchParams.get("scope") === "all" ? "all" : "mine";

  const [tasks, setTasks] = useState<TaskBoardItem[]>(props.tasks);
  // Re-sync when the server re-renders (e.g. after a save → router.refresh()).
  useEffect(() => setTasks(props.tasks), [props.tasks]);

  // Per-user column order, drag-reorderable, persisted per device in localStorage.
  const storageKey = `tasks-board-order:${props.currentUserId}`;
  const [columnOrder, setColumnOrder] = useState<string[]>([...BOARD_STATUSES]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter(
        (s): s is string => typeof s === "string" && (BOARD_STATUSES as readonly string[]).includes(s)
      );
      const missing = BOARD_STATUSES.filter((s) => !valid.includes(s));
      if (valid.length > 0) setColumnOrder([...valid, ...missing]);
    } catch {
      // ignore malformed storage
    }
  }, [storageKey]);

  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const justDraggedRef = useRef(false);

  const [qInput, setQInput] = useState(urlQ);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setQInput(urlQ), [urlQ]);

  // ── Phone chrome ────────────────────────────────────────────────────────────
  // The filter card used to fill the whole phone screen before you saw a single
  // task. Search + filters now live in the dark header; the filters drop down
  // over the board when asked for.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasActiveFilter = Boolean(urlPriority || urlDomain || urlLinkedId) || urlScope === "all";
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtersOpen]);

  // Magnifier — one button, two states. Normal (1) shows the minus glyph; press
  // it and the list shrinks to fit the screen and the glyph flips to a plus to
  // come back. Always starts normal — a zoomed-out board isn't a resting state.
  const [zoom, setZoom] = useState(1);
  const isOverview = zoom < 1;

  // The board fills from wherever it starts down to the bottom of the screen, so
  // the PAGE never scrolls — the lists do. Measured rather than a fixed calc()
  // because what sits above it varies (alert bar, tabs, toolbar).
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  useEffect(() => {
    // Closed loop, not a formula: look at where the board's content ACTUALLY
    // ends on screen, compare it with where it should end, and correct by the
    // difference. Every formula tried here (innerHeight minus a nav height,
    // then 100dvh minus a measured top) left a strip of white page under the
    // board on some screen — each depends on the browser and the CSS agreeing
    // about where the viewport ends, and they don't always. This asks the
    // rendered box instead, so it converges whatever the cause. It settles in a
    // frame or two: the correction resizes the board, the observer below fires,
    // the next pass finds a delta of ~0 and stops.
    const measure = () => {
      const el = boardRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Phones stop at the bottom bar; otherwise the bottom of the viewport.
      // documentElement.clientHeight, not innerHeight: it excludes scrollbars.
      const nav = document.querySelector<HTMLElement>("[data-bottom-nav]");
      const targetBottom =
        nav && nav.offsetWidth > 0
          ? nav.getBoundingClientRect().top
          : document.documentElement.clientHeight;
      // The bleed below the content is pure paint — don't count it as content.
      const contentBottom = rect.bottom - BOARD_BLEED + window.scrollY;
      const delta = targetBottom - contentBottom;
      if (Math.abs(delta) < 1) return;
      setBoardHeight((prev) => {
        const current = prev ?? rect.height - BOARD_BLEED;
        return Math.max(320, Math.round(current + delta));
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    // Anything above the board changing height (an alert dismissed, the tabs
    // gone) moves its top edge. Watching document.body is useless here — the
    // shell is min-h-screen, so the body never changes size no matter what the
    // page does — so watch every ancestor between the board and the body: one of
    // them is the box that actually shrank.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (observer) {
      let node = boardRef.current?.parentElement ?? null;
      while (node && node !== document.body) {
        observer.observe(node);
        node = node.parentElement;
      }
    }
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      observer?.disconnect();
    };
  }, []);

  // ── One list on screen at a time (phones) ───────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const columnNodes = useRef(new Map<string, HTMLElement>());
  const userScrolledRef = useRef(false);
  const [centeredStatus, setCenteredStatus] = useState<string>("todo");

  const registerColumn = useCallback((status: string, node: HTMLElement | null) => {
    if (node) columnNodes.current.set(status, node);
    else columnNodes.current.delete(status);
  }, []);

  const centerColumn = useCallback((status: string, behavior: ScrollBehavior = "smooth") => {
    const scroller = scrollerRef.current;
    const node = columnNodes.current.get(status);
    if (!scroller || !node) return;
    const scrollerBox = scroller.getBoundingClientRect();
    const nodeBox = node.getBoundingClientRect();
    // scrollBy with a delta, not scrollLeft: RTL scroll origins differ between
    // engines, a relative move doesn't care which convention we're in.
    const delta = nodeBox.left + nodeBox.width / 2 - (scrollerBox.left + scrollerBox.width / 2);
    if (Math.abs(delta) < 1) return;
    scroller.scrollBy({ left: delta, behavior });
  }, []);

  // "לביצוע" is what you came to look at, so it's the list you land on.
  useEffect(() => {
    if (userScrolledRef.current) return;
    if (window.matchMedia("(min-width: 1024px)").matches) return;
    // Next frame: the columns need their widths before we can centre one.
    const frame = requestAnimationFrame(() => centerColumn("todo", "auto"));
    return () => cancelAnimationFrame(frame);
  }, [centerColumn, columnOrder, boardHeight]);

  /** The list currently nearest the middle of the screen. */
  const nearestColumn = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return "";
    const scrollerBox = scroller.getBoundingClientRect();
    const middle = scrollerBox.left + scrollerBox.width / 2;
    let best = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    columnNodes.current.forEach((node, status) => {
      const box = node.getBoundingClientRect();
      const distance = Math.abs(box.left + box.width / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = status;
      }
    });
    return best;
  }, []);

  // Track the list on screen, and hold the board to ONE list per swipe: snap
  // alone lets a flick skip two or three, so once the scroll settles we walk
  // back to the neighbour of wherever the swipe started.
  const swipeFromIndexRef = useRef(0);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          const status = nearestColumn();
          if (status) setCenteredStatus(status);
        });
      }
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        const landed = columnOrder.indexOf(nearestColumn());
        const from = swipeFromIndexRef.current;
        if (landed < 0 || from < 0 || from >= columnOrder.length) return;
        const step = landed - from;
        if (Math.abs(step) > 1) {
          const nextIndex = from + Math.sign(step);
          swipeFromIndexRef.current = nextIndex;
          centerColumn(columnOrder[nextIndex]);
          return;
        }
        swipeFromIndexRef.current = landed;
      }, 140);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (settle) clearTimeout(settle);
    };
  }, [centerColumn, columnOrder, nearestColumn]);

  // Shrink the list you're looking at until all of it is on screen — then back.
  const toggleOverview = useCallback(() => {
    if (isOverview) {
      setZoom(1);
      return;
    }
    const cards = columnNodes.current.get(centeredStatus)?.querySelector<HTMLElement>("[data-cards]");
    if (!cards || cards.scrollHeight <= cards.clientHeight) {
      // Nothing overflowing to measure against — just go small.
      setZoom(OVERVIEW_FALLBACK_ZOOM);
      return;
    }
    // 0.95 for the bits that don't scale (borders, the column's own chrome).
    const fit = (cards.clientHeight / cards.scrollHeight) * 0.95;
    setZoom(Math.max(MIN_OVERVIEW_ZOOM, Math.min(OVERVIEW_FALLBACK_ZOOM, fit)));
  }, [centeredStatus, isOverview]);

  // Open the card for a deep-linked ?task=<id>.
  useEffect(() => {
    if (urlTask) setEditId(urlTask);
  }, [urlTask]);

  // Strip ?task= from the URL after closing the card so it doesn't reopen.
  function clearTaskParam() {
    if (!urlTask) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    const qs = params.toString();
    router.replace(qs ? `/tasks?${qs}` : "/tasks");
  }

  // Touch dragging is for tablets up. On a phone only one list is on screen, so
  // dragging a card to another one never really worked — holding a card opens a
  // menu with "העברה ל…" instead, and the two gestures can't both own the hold.
  const [touchDrag, setTouchDrag] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const apply = () => setTouchDrag(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  // Mouse for desktop (drag after 8px so plain clicks open the card); touch with a
  // short press-delay so a tap opens the card and the board still scrolls.
  const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } });
  const sensors = useSensors(mouseSensor, touchDrag ? touchSensor : null);

  // Unique, stable color slot per user — shared by the card avatars (and matches
  // the dialog, which builds the same map from the same user list).
  const colorIndexById = useMemo(
    () => buildColorIndexMap(props.users.map((u) => u.id)),
    [props.users]
  );

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, TaskBoardItem[]>();
    for (const status of BOARD_STATUSES) map.set(status, []);
    for (const task of tasks) {
      const status = task.status && map.has(task.status) ? task.status : "todo";
      map.get(status)!.push(task);
    }
    // Display order = sort_order (drag-reorder persists there), not insertion
    // order — otherwise a freshly-dragged card wouldn't visibly move.
    for (const list of map.values()) {
      list.sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER));
    }
    return map;
  }, [tasks]);

  const isColumnDrag = activeDragId?.startsWith(COLUMN_PREFIX) ?? false;
  const activeColumnStatus = isColumnDrag && activeDragId ? activeDragId.slice(COLUMN_PREFIX.length) : null;
  const activeTask = activeDragId && !isColumnDrag ? tasks.find((t) => t.id === activeDragId) ?? null : null;

  function pushFilters(filters: UrlFilters) {
    emitNavigationStart();
    router.push(buildTasksUrl(filters));
  }

  function handleQChange(value: string) {
    setQInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      pushFilters({ q: value, priority: urlPriority, domain: urlDomain, linkedId: urlLinkedId, scope: urlScope });
    }, 400);
  }

  const linkedTarget =
    urlDomain === "logistics_projects" ? "project" : urlDomain === "property_management" ? "property" : "";
  const linkedOptions = linkedTarget === "project" ? props.projects : linkedTarget === "property" ? props.properties : [];

  const moveTask = useCallback(
    // No message, no toast: dragging a card to another list IS the feedback, and
    // a toast for something you just watched happen is noise. Callers that move
    // a card you can't see (the tick, the card menu) pass what to say. Always
    // lands at the TOP of the target column ("order added" = newest on top;
    // there's no drop position to honor here — see handleDragEnd for the
    // position-aware drag path).
    async (taskId: string, targetStatus: string, successMessage?: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || (task.status ?? "todo") === targetStatus) return;
      const targetList = (tasksByStatus.get(targetStatus) ?? []).filter((t) => t.id !== taskId);
      const newSortOrder = computeInsertSortOrder(null, targetList[0]?.sort_order ?? null);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: targetStatus, sort_order: newSortOrder, is_overdue: targetStatus === "done" ? false : t.is_overdue }
            : t
        )
      );
      emitProgressActivityStart();
      try {
        const result = await offlineFetch(
          "/api/tasks/update-status",
          { id: taskId, status: targetStatus, sort_order: newSortOrder },
          t(tasksDict, props.locale, "updateStatusOfflineLabel")
        );
        if (!result.queued && !result.ok) {
          toast.error(t(tasksDict, props.locale, "toastErrorUpdateStatus"), { description: toHebrewError(result.error, "") });
          setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: task.status, sort_order: task.sort_order } : t)));
          return;
        }
        if (!result.queued && successMessage) toast.success(successMessage);
      } catch (error: unknown) {
        toast.error(t(tasksDict, props.locale, "toastErrorUpdateStatus"), { description: toHebrewError(error, "") });
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: task.status, sort_order: task.sort_order } : t)));
      } finally {
        emitProgressActivityEnd();
      }
    },
    [tasks, tasksByStatus, props.locale]
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    justDraggedRef.current = true;
    // Allow the synthetic click after a drag to be ignored, then re-enable opening.
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
    const activeId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : "";
    if (!overId) return;

    // Column reorder (persisted per user).
    if (activeId.startsWith(COLUMN_PREFIX)) {
      if (!overId.startsWith(COLUMN_PREFIX) || activeId === overId) return;
      setColumnOrder((prev) => {
        const from = prev.indexOf(activeId.slice(COLUMN_PREFIX.length));
        const to = prev.indexOf(overId.slice(COLUMN_PREFIX.length));
        if (from === -1 || to === -1) return prev;
        const next = arrayMove(prev, from, to);
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      return;
    }

    // Card drag: reorder within a column, or move to another column at a
    // specific spot — persisted via sort_order (fractional indexing between
    // whichever two cards it lands between), not just an append.
    if (overId === activeId) return;
    const draggedTask = tasks.find((task) => task.id === activeId);
    if (!draggedTask) return;
    const sourceStatus = draggedTask.status && tasksByStatus.has(draggedTask.status) ? draggedTask.status : "todo";
    const targetStatus = overId.startsWith(COLUMN_PREFIX)
      ? overId.slice(COLUMN_PREFIX.length)
      : tasks.find((task) => task.id === overId)?.status || sourceStatus;
    if (!tasksByStatus.has(targetStatus)) return;

    // The target column's current order, excluding the dragged card itself.
    const targetList = (tasksByStatus.get(targetStatus) ?? []).filter((task) => task.id !== activeId);
    let targetIndex = targetList.length; // default: dropped on the column itself → append
    if (!overId.startsWith(COLUMN_PREFIX)) {
      const overIndex = targetList.findIndex((task) => task.id === overId);
      if (overIndex >= 0) {
        // Landed on the lower half of the over-card → after it, not before it.
        const overRect = event.over?.rect;
        const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
        const insertAfter =
          overRect && activeRect ? activeRect.top + activeRect.height / 2 > overRect.top + overRect.height / 2 : false;
        targetIndex = insertAfter ? overIndex + 1 : overIndex;
      }
    }

    const newSortOrder = computeInsertSortOrder(
      targetList[targetIndex - 1]?.sort_order ?? null,
      targetList[targetIndex]?.sort_order ?? null
    );
    if (targetStatus === sourceStatus && draggedTask.sort_order === newSortOrder) return;

    const previousTasks = tasks;
    setTasks((prev) =>
      prev.map((task) =>
        task.id === activeId
          ? {
              ...task,
              status: targetStatus,
              sort_order: newSortOrder,
              is_overdue: targetStatus === "done" ? false : task.is_overdue,
            }
          : task
      )
    );
    // No progress bar for this one — the card sliding into place IS the
    // feedback, and a loading bar flashing on every single drag reads as
    // sluggish rather than reassuring.
    void (async () => {
      try {
        const result = await offlineFetch(
          "/api/tasks/update-status",
          { id: activeId, status: targetStatus, sort_order: newSortOrder },
          t(tasksDict, props.locale, "updateStatusOfflineLabel")
        );
        if (!result.queued && !result.ok) {
          toast.error(t(tasksDict, props.locale, "toastErrorUpdateStatus"), { description: toHebrewError(result.error, "") });
          setTasks(previousTasks);
        }
      } catch (error: unknown) {
        toast.error(t(tasksDict, props.locale, "toastErrorUpdateStatus"), { description: toHebrewError(error, "") });
        setTasks(previousTasks);
      }
    })();
  }

  function openCard(id: string) {
    if (justDraggedRef.current) return;
    setEditId(id);
  }

  function toggleDone(id: string, done: boolean) {
    const found = tasks.find((t) => t.id === id);
    const subject = found ? preferHe(found.subject, found.subject_he, props.locale, found.subject_ar) : t(tasksDict, props.locale, "taskFallbackWord");
    void moveTask(
      id,
      done ? "done" : "todo",
      done
        ? `"${subject}" ${t(tasksDict, props.locale, "markedDoneSuffix")}`
        : `"${subject}" ${t(tasksDict, props.locale, "markedUndoneSuffix")}`
    );
  }

  function openMenu(id: string, x: number, y: number) {
    setMenu({ id, x, y });
  }

  async function performDeleteTask() {
    const id = deleteTaskId;
    if (!id) return;
    setDeletingTask(true);
    const previous = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    emitProgressActivityStart();
    try {
      const result = await offlineFetch("/api/tasks/delete", { id }, t(tasksDict, props.locale, "deleteTaskLabel"));
      if (!result.queued && !result.ok) {
        toast.error(t(tasksDict, props.locale, "toastErrorDeleteTask"), { description: toHebrewError(result.error, "") });
        setTasks(previous);
        return;
      }
      if (!result.queued) toast.success(t(tasksDict, props.locale, "toastTaskDeleted"));
      setDeleteTaskId(null);
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorDeleteTask"), { description: toHebrewError(error, "") });
      setTasks(previous);
    } finally {
      emitProgressActivityEnd();
      setDeletingTask(false);
    }
  }

  // Quick-add creates the card immediately from just the typed name (Trello-style):
  // it lands in the column's status, owned by the creator so it stays visible, and
  // the rest of the details can be filled in later by opening the card.
  // One card per line: pasting or dictating a list into the column's add box
  // creates them all, rather than one card with a paragraph for a name.
  async function quickAdd(status: string, titles: string[]) {
    if (titles.length === 0) return;
    emitProgressActivityStart();
    try {
      let created = 0;
      let queued = 0;
      const failed: string[] = [];
      // "Order added" = newest at the top — each line lands above whatever is
      // currently topmost (including the previous line in this same batch, so
      // the last line typed ends up highest).
      let runningTop = (tasksByStatus.get(status) ?? [])[0]?.sort_order ?? null;
      for (const subject of titles) {
        const tempId = `temp-${crypto.randomUUID()}`;
        const sortOrder = computeInsertSortOrder(null, runningTop);
        runningTop = sortOrder;
        // Shows the card immediately — no toast, no waiting on the request to
        // resolve; the card appearing IS the feedback.
        setTasks((prev) => [
          ...prev,
          buildOptimisticTask({
            id: tempId,
            subject,
            status,
            priority: "medium",
            business_domain: "general_business",
            assigned_user_id: props.currentUserId,
            sort_order: sortOrder,
          }),
        ]);
        try {
          const result = await offlineFetch(
            "/api/tasks/create",
            {
              subject,
              status,
              business_domain: "general_business",
              priority: "medium",
              assigned_user_id: props.currentUserId,
            },
            t(tasksDict, props.locale, "newTaskLabel"),
            { idempotent: true }
          );
          if (result.queued) queued += 1;
          else if (result.ok) created += 1;
          else {
            failed.push(subject);
            setTasks((prev) => prev.filter((task) => task.id !== tempId));
          }
        } catch {
          failed.push(subject);
          setTasks((prev) => prev.filter((task) => task.id !== tempId));
        }
      }
      // Failures still get a toast — there's nothing on screen for those to see.
      if (failed.length > 0) {
        toast.error(`${failed.length} ${t(tasksDict, props.locale, "tasksNotCreatedSuffix")}`, { description: failed.join(", ") });
      }
      // Silently reconciles the optimistic rows with the real server ones (ids,
      // joined names, server-computed sort_order) — no toast for the happy path.
      if (created > 0 || queued > 0) router.refresh();
    } catch (error: unknown) {
      toast.error(t(tasksDict, props.locale, "toastErrorCreateTask"), { description: toHebrewError(error, "") });
    } finally {
      emitProgressActivityEnd();
    }
  }

  // Phones have no sidebar to say where you are — the dark header says it. The
  // subtitle counts what's still TO DO: the total includes everything already
  // done, which is the one number nobody needs at a glance.
  const todoCount = (tasksByStatus.get("todo") ?? []).length;
  useSetPageTitle(t(tasksDict, props.locale, "pageTitle"), `${todoCount} ${t(tasksDict, props.locale, "todoSuffix")}`);

  // One definition of the filter controls, used by both the desktop toolbar and
  // the phone drop-down, so the two can't drift apart.
  const filterFields = (
    <>
      {canSeeAll ? (
        <div className="w-full space-y-1">
          <div className="text-[11px] text-muted-foreground">{t(tasksDict, props.locale, "scopeLabel")}</div>
          <div className="flex rounded-xl border bg-secondary/10 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => pushFilters({ q: urlQ, priority: urlPriority, domain: urlDomain, linkedId: urlLinkedId, scope: "mine" })}
              className={`flex-1 rounded-lg px-3 py-1.5 transition-colors ${urlScope === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {t(tasksDict, props.locale, "scopeMine")}
            </button>
            <button
              type="button"
              onClick={() => pushFilters({ q: urlQ, priority: urlPriority, domain: urlDomain, linkedId: urlLinkedId, scope: "all" })}
              className={`flex-1 rounded-lg px-3 py-1.5 transition-colors ${urlScope === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              {t(tasksDict, props.locale, "allWord")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="w-full space-y-1">
        <div className="text-[11px] text-muted-foreground">{t(tasksDict, props.locale, "priorityLabel")}</div>
        <NativeSelect dense
          value={urlPriority}
          onChange={(e) => pushFilters({ q: urlQ, priority: e.target.value, domain: urlDomain, linkedId: urlLinkedId, scope: urlScope })}
        >
          <option value="">{t(tasksDict, props.locale, "allWord")}</option>
          {PRIORITY_OPTIONS.map((priority) => (
            <option key={priority} value={priority}>
              {getTaskPriorityLabel(priority, props.locale)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="w-full space-y-1">
        <div className="text-[11px] text-muted-foreground">{t(tasksDict, props.locale, "domainLabel")}</div>
        <DomainSelect
          value={urlDomain}
          emptyLabel={t(tasksDict, props.locale, "allWord")}
          onChange={(value) => pushFilters({ q: urlQ, priority: urlPriority, domain: value, linkedId: "", scope: urlScope })}
        />
      </div>
      {linkedTarget ? (
        <div className="col-span-2 w-full space-y-1">
          <div className="text-[11px] text-muted-foreground">
            {linkedTarget === "project"
              ? t(tasksDict, props.locale, "linkedProjectLabel")
              : t(tasksDict, props.locale, "linkedPropertyLabel")}
          </div>
          {linkedTarget === "project" ? (
            <ProjectPicker
              className="h-9"
              value={urlLinkedId}
              onChange={(linkedId) => pushFilters({ q: urlQ, priority: urlPriority, domain: urlDomain, linkedId, scope: urlScope })}
              emptyLabel={t(tasksDict, props.locale, "allProjectsLabel")}
              searchPlaceholder={t(tasksDict, props.locale, "searchProjectPlaceholder")}
              projects={linkedOptions.map((option) => ({ id: option.id, label: option.label }))}
            />
          ) : (
            <SearchableSelect
              className="h-9"
              value={urlLinkedId}
              onChange={(linkedId) => pushFilters({ q: urlQ, priority: urlPriority, domain: urlDomain, linkedId, scope: urlScope })}
              ariaLabel={t(tasksDict, props.locale, "filterByPropertyAria")}
              emptyOptionLabel={t(tasksDict, props.locale, "allPropertiesLabel")}
              searchPlaceholder={t(tasksDict, props.locale, "searchPropertyPlaceholder")}
              options={linkedOptions.map((option) => ({ value: option.id, label: option.label }))}
            />
          )}
        </div>
      ) : null}
    </>
  );

  // Desktop controls — they live at the end of the tab row (see below). Search
  // stays a field (you type into it); everything else is a button, with the
  // number of live filters on the מסננים one so a hidden filter can't be
  // forgotten about.
  const activeFilterCount =
    (urlPriority ? 1 : 0) + (urlDomain ? 1 : 0) + (urlLinkedId ? 1 : 0) + (urlScope === "all" ? 1 : 0);
  // Sized and coloured for the navy strip they sit on — the same recessed
  // white/10 treatment the phone header uses, so the two read as one bar.
  const desktopSearch = (
    <div className="relative w-64">
      <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={qInput}
        onChange={(e) => handleQChange(e.target.value)}
        placeholder={t(tasksDict, props.locale, "searchPlaceholder")}
        className="h-8 rounded-lg ps-9"
      />
    </div>
  );
  const desktopActions = (
    <>
      <Button
        type="button"
        size="sm"
        className="h-8 gap-1.5 rounded-lg px-2.5"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen((x) => !x)}
      >
        <FilterIcon className="h-4 w-4" />
        {t(tasksDict, props.locale, "filtersLabel")}
        {activeFilterCount > 0 ? (
          <span className="rounded-full bg-white/25 px-1.5 text-[11px] leading-5">{activeFilterCount}</span>
        ) : null}
      </Button>
      {/* No "משימה" + here — the app's one quick-create + carries it. Each board
          list keeps its own inline "הוספת כרטיס", which files the card straight
          into that list; the global + can't do that. */}
      {/* Recurring tasks is a button here too, like the phone header — it was a
          whole tab bar for a link used once a month, and the board wants the
          room. (The recurring page keeps its tabs, so there's a way back.) */}
      {canSeeAll ? (
        <Button
          asChild
          size="icon"
          className="h-8 w-8 shrink-0 rounded-lg "
          aria-label={t(tasksDict, props.locale, "recurringTasksLabel")}
          title={t(tasksDict, props.locale, "recurringTasksLabel")}
        >
          <Link href="/tasks/recurring" onClick={() => emitNavigationStart()}>
            <RecurringIcon className="h-4 w-4" />
          </Link>
        </Button>
      ) : null}
    </>
  );

  return (
    // Cancel the shell's padding around the board at every size: the board is a
    // full-bleed surface that runs from under the tabs to the bottom of the
    // screen (a phone stops at the nav), and the page itself doesn't scroll.
    // No space-y here — the few things above the board carry their own margin,
    // so the board can sit flush under them.
    // overflow-clip + a clip margin: the board's colour bleeds past its box (see
    // BOARD_BLEED) and this contains the overspill without turning it into
    // scrollable page. The margin has to clear the board's own -mx bleed too,
    // which is why it's 3rem and not 0.
    <div className="-mb-24 -mt-4 overflow-clip [overflow-clip-margin:4rem] md:-mb-6 md:-mt-6 lg:-mb-8 lg:-mt-8">
      {/* Phone toolbar lives INSIDE the dark header (see PageHeaderToolbar), so
          the board starts at the top of the page instead of below a screenful of
          filter fields. */}
      <PageHeaderToolbar>
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-1.5">
          {/* No "משימה" + here — see desktopActions above. */}
          {/* Same navy treatment as every other page's header strip (orders,
              customers): a recessed white/10 field on the bar, not a light one. */}
          <div className="relative w-full min-w-0">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={qInput}
              onChange={(e) => handleQChange(e.target.value)}
              placeholder={t(tasksDict, props.locale, "searchPlaceholder")}
              className="h-10 w-full rounded-xl ps-9"
            />
          </div>
          {/* Reads as ON (sky fill) while the panel is open or a filter is set. */}
          <Button
            type="button"
            size="icon"
            aria-label={t(tasksDict, props.locale, filtersOpen ? "hideFiltersAria" : "showFiltersAria")}
            className={
              filtersOpen || hasActiveFilter
                ? "h-10 w-10 shrink-0 rounded-xl"
                : "h-10 w-10 shrink-0 rounded-xl "
            }
            onClick={() => setFiltersOpen((x) => !x)}
          >
            <FilterIcon className="h-4 w-4" />
          </Button>
          {/* "משימות קבועות" as a button, not a tab row: the tab strip cost the
              board a whole line for a link used once a month. The tabs are still
              there from tablet up (and on the recurring page itself, so there's
              always a way back). */}
          {canSeeAll ? (
            <Button
              asChild
              size="icon"
              className="h-10 w-10 shrink-0 rounded-xl "
              aria-label={t(tasksDict, props.locale, "recurringTasksLabel")}
              title={t(tasksDict, props.locale, "recurringTasksLabel")}
            >
              <Link href="/tasks/recurring" onClick={() => emitNavigationStart()}>
                <RecurringIcon className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </PageHeaderToolbar>

      {/* Phone: the filters drop DOWN OVER the board, pinned under the sticky
          header (60px top bar + 52px toolbar) — where you're already looking. */}
      {filtersOpen ? (
        <>
          <button
            type="button"
            aria-label={t(tasksDict, props.locale, "closeFiltersAria")}
            className="fixed inset-0 top-[112px] z-20 bg-black/30 md:hidden"
            onClick={() => setFiltersOpen(false)}
          />
          <div className="fixed inset-x-0 top-[112px] z-20 border-b border-border bg-card p-3 shadow-lg md:hidden">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{t(tasksDict, props.locale, "filtersLabel")}</span>
              <button
                type="button"
                aria-label={t(tasksDict, props.locale, "closeFiltersAria")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
                onClick={() => setFiltersOpen(false)}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">{filterFields}</div>
          </div>
        </>
      ) : null}

      {/* Tablet and up: the tab row carries the controls at its end, and the
          filters drop out of it — a toolbar CARD above the board cost a third of
          the screen for four fields that are usually left alone. */}
      {/* Desktop: ONE narrow navy row — add, search, filters, recurring — that
          continues the top bar, with the board owning everything under it. Same
          shape as the phone header; the tab bar is gone from this page entirely
          (see the recurring button above). Full-bleed like the board, so the
          dark runs edge to edge. */}
      <div className="-mx-3 hidden items-center gap-2 bg-sidebar px-3 py-1.5 md:-mx-6 md:flex md:px-6 lg:-mx-8 lg:px-8">
        {/* Equal flex-1 flanks put the search dead centre; the actions ride the
            end of the row (the left, in RTL). */}
        <div className="flex-1" />
        {desktopSearch}
        <div className="flex flex-1 items-center justify-end gap-2">{desktopActions}</div>
      </div>

      {/* Desktop filters: a card floating OVER the board, hung under the מסננים
          button (fixed, so the board's overflow-clip can't cut it off). Inline
          it pushed the board down every time it opened. */}
      {filtersOpen ? (
        <div className="hidden md:block">
          <button
            type="button"
            aria-label={t(tasksDict, props.locale, "closeFiltersAria")}
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setFiltersOpen(false)}
          />
          <div className="fixed left-6 top-[7rem] z-50 w-[28rem] max-w-[calc(100vw-3rem)] rounded-xl border bg-card p-3 shadow-xl lg:left-8">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{t(tasksDict, props.locale, "filtersLabel")}</span>
              <button
                type="button"
                aria-label={t(tasksDict, props.locale, "closeFiltersAria")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                onClick={() => setFiltersOpen(false)}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">{filterFields}</div>
          </div>
        </div>
      ) : null}

      {/* key remounts the whole subtree when the sensor SET changes shape (mouse-only
          vs mouse+touch) — @dnd-kit's internal bookkeeping assumes a fixed-length
          sensor list for the lifetime of one DndContext instance; toggling touchDrag
          mid-lifecycle (the matchMedia listener firing after a resize) otherwise trips
          React's "final argument to useEffect changed size" error inside dnd-kit's own
          hooks. A resize across the 768px breakpoint is rare enough that a remount
          here is unnoticeable, and it's not expected to happen mid-drag. */}
      <DndContext key={touchDrag ? "touch" : "mouse"} sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {/* The board is a dark surface (like Trello's): it's what makes the light
            lists and white cards pop, and it marks where the page stops and the
            board begins. Flat navy — the same primary as the chrome above it, so
            the header and the board read as one surface. Full-bleed at every
            size; the -mx values match the shell's gutters. */}
        <div
          ref={boardRef}
          // The bleed is always applied so the geometry the loop measures stays
          // the same before and after the first correction.
          style={{
            height: boardHeight === null ? undefined : boardHeight + BOARD_BLEED,
            paddingBottom: BOARD_BLEED,
            marginBottom: -BOARD_BLEED,
          }}
          className="relative -mx-3 flex min-h-[20rem] flex-col overflow-hidden bg-primary md:-mx-6 lg:-mx-8"
        >
          <SortableContext items={columnOrder.map(columnSortableId)} strategy={horizontalListSortingStrategy}>
            {/* snap-mandatory + snap-center on each list: one swipe steps to the
                next list and parks it in the middle of the screen.
                px-[5vw] with 90vw lists: the first and last list can sit in the
                MIDDLE of the screen too (without it the browser clamps them to
                the edge), and the gutter is exactly the peek of the next list. */}
            <div
              ref={scrollerRef}
              onPointerDown={() => {
                userScrolledRef.current = true;
                // Where this swipe started from — the one-list-per-swipe clamp
                // measures against it.
                swipeFromIndexRef.current = columnOrder.indexOf(centeredStatus);
              }}
              style={{ fontSize: `${CARD_BASE_REM * zoom}rem` }}
              className="flex min-h-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-[5vw] py-2 lg:grid lg:grid-cols-4 lg:gap-3 lg:overflow-x-visible lg:px-3"
            >
              {columnOrder.map((status) => (
                <BoardColumn
                  key={status}
                  status={status}
                  tasks={tasksByStatus.get(status) ?? []}
                  onOpen={openCard}
                  onToggleDone={toggleDone}
                  onContextMenu={openMenu}
                  onQuickAdd={quickAdd}
                  colorIndexById={colorIndexById}
                  onColumnRef={registerColumn}
                  longPress={!touchDrag}
                  overview={isOverview}
                  locale={props.locale}
                />
              ))}
            </div>
          </SortableContext>

          {/* The magnifier floats in the corner instead of owning a whole bar —
              one button, two states: minus shrinks the list until all of it is
              on screen, plus puts it back. Sits above the "הוספת כרטיס" foot so
              the two never fight for the same corner. */}
          <button
            type="button"
            onClick={toggleOverview}
            aria-pressed={isOverview}
            aria-label={t(tasksDict, props.locale, isOverview ? "overviewBackAria" : "overviewShowAllAria")}
            title={t(tasksDict, props.locale, isOverview ? "overviewBackAria" : "overviewShowAllAria")}
            className="absolute bottom-16 right-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-sidebar/90 text-sidebar-foreground shadow-lg ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-sidebar"
          >
            {isOverview ? <ZoomInIcon className="h-5 w-5" /> : <ZoomOutIcon className="h-5 w-5" />}
          </button>
        </div>

        <DragOverlay>
          {activeColumnStatus ? (
            <div className="rounded-xl bg-muted px-3 py-2.5 text-sm font-semibold shadow-lg">
              {getTaskStatusLabel(activeColumnStatus, props.locale)}
            </div>
          ) : activeTask ? (
            <div className="rounded-lg border bg-card p-2.5 text-sm shadow-lg">
              <div className="font-medium leading-snug">
                {preferHe(activeTask.subject, activeTask.subject_he, props.locale, activeTask.subject_ar)}
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Card menu — right-click on desktop, hold a card on a phone. "העברה ל…"
          is how a card changes list where there's no dragging. */}
      {menu ? (
        (() => {
          const menuTask = tasks.find((t) => t.id === menu.id) ?? null;
          const menuStatus = menuTask?.status ?? "todo";
          const moveTargets = columnOrder.filter((s) => s !== menuStatus);
          const open = () => {
            const id = menu.id;
            setMenu(null);
            setEditId(id);
          };
          const remove = () => {
            const id = menu.id;
            setMenu(null);
            setDeleteTaskId(id);
          };
          const move = (target: string) => {
            const id = menu.id;
            setMenu(null);
            // Silent, like a drag: you chose the list by name a moment ago, so a
            // toast repeating it back is noise. Only failures speak.
            void moveTask(id, target);
          };
          return (
            <>
              {/* z above the bottom nav (z-50), or the sheet lands under it. */}
              <div
                className="fixed inset-0 z-[55] bg-black/20 md:bg-transparent"
                onClick={() => setMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu(null);
                }}
              />
              {/* Phone: a sheet at the bottom, in reach of the thumb that just
                  held the card — not a popover under the fingertip. It clears the
                  bottom nav the same way the nav's own spacer does. */}
              <div className="fixed inset-x-2 bottom-[calc(58px+env(safe-area-inset-bottom)+0.5rem)] z-[60] rounded-2xl border bg-popover p-2 shadow-xl md:hidden">
                <div className="px-1 pb-2 pt-1 text-sm font-medium leading-snug">
                  {menuTask ? preferHe(menuTask.subject, menuTask.subject_he, props.locale, menuTask.subject_ar) : t(tasksDict, props.locale, "taskWord")}
                </div>
                {/* Say what the row DOES — three status words on their own read
                    as a filter or a label, not as "move it there". Always
                    exactly three (the four lists minus the one it's in), so they
                    fit one row. */}
                <div className="px-1 pb-1 text-[11px] text-muted-foreground">{t(tasksDict, props.locale, "moveToListLabel")}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {moveTargets.map((target) => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => move(target)}
                      className="rounded-xl border bg-muted/40 px-1 py-2.5 text-center text-sm font-medium transition-colors active:bg-muted"
                    >
                      {getTaskStatusLabel(target, props.locale)}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    onClick={open}
                    className="flex-1 rounded-xl bg-secondary px-3 py-2.5 text-sm font-medium text-secondary-foreground"
                  >
                    {t(tasksDict, props.locale, "openLabel")}
                  </button>
                  <DeleteButton label={t(tasksDict, props.locale, "deleteTheTaskButtonLabel")} size="default" onClick={remove} />
                </div>
              </div>
              {/* Desktop: at the cursor, where the right-click happened. */}
              <div
                className="fixed z-[60] hidden min-w-40 overflow-hidden rounded-md border bg-popover py-1 text-sm shadow-md md:block"
                style={{ top: menu.y, left: menu.x }}
              >
                <button type="button" onClick={open} className="block w-full px-3 py-1.5 text-start hover:bg-muted/50">
                  {t(tasksDict, props.locale, "openLabel")}
                </button>
                <div className="my-1 border-t" />
                <div className="px-3 pb-0.5 text-[11px] text-muted-foreground">{t(tasksDict, props.locale, "moveToEllipsisLabel")}</div>
                {moveTargets.map((target) => (
                  <button
                    key={target}
                    type="button"
                    onClick={() => move(target)}
                    className="block w-full px-3 py-1.5 text-start hover:bg-muted/50"
                  >
                    {getTaskStatusLabel(target, props.locale)}
                  </button>
                ))}
                <div className="my-1 border-t" />
                <button
                  type="button"
                  onClick={remove}
                  className="block w-full px-3 py-1.5 text-start text-destructive hover:bg-destructive/10"
                >
                  {t(commonDict, props.locale, "delete")}
                </button>
              </div>
            </>
          );
        })()
      ) : null}

      {/* No create dialog on this page — a full new task comes from the app's one
          quick-create +, and a quick card comes from a list's inline composer. */}

      <TaskUpsertDialog
        open={editId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditId(null);
            clearTaskParam();
          }
        }}
        mode="edit"
        taskId={editId}
        locale={props.locale}
        users={props.users}
        projects={props.projects}
        properties={props.properties}
        customers={props.customers}
        currentUserId={props.currentUserId}
        onSaved={(created) => {
          // A just-created task appears the instant the request resolves —
          // router.refresh() below silently reconciles it with the full,
          // joined server row a moment later (no toast either way).
          if (created && typeof created.id === "string") {
            const id = created.id;
            setTasks((prev) => {
              if (prev.some((task) => task.id === id)) return prev;
              const status = typeof created.status === "string" ? created.status : "todo";
              const assignedUserId = typeof created.assigned_user_id === "string" ? created.assigned_user_id : null;
              return [
                ...prev,
                buildOptimisticTask({
                  id,
                  subject: typeof created.subject === "string" ? created.subject : "משימה",
                  status,
                  priority: typeof created.priority === "string" ? created.priority : "medium",
                  due_date: typeof created.due_date === "string" ? created.due_date : null,
                  due_time: typeof created.due_time === "string" ? created.due_time : null,
                  city: typeof created.city === "string" ? created.city : null,
                  business_domain: typeof created.business_domain === "string" ? created.business_domain : null,
                  project_id: typeof created.project_id === "string" ? created.project_id : null,
                  property_id: typeof created.property_id === "string" ? created.property_id : null,
                  customer_id: typeof created.customer_id === "string" ? created.customer_id : null,
                  assigned_user_id: assignedUserId,
                  assigned_user_name: assignedUserId ? props.users.find((u) => u.id === assignedUserId)?.label ?? null : null,
                  is_private: created.is_private === true,
                  sort_order: typeof created.sort_order === "number" ? created.sort_order : Date.now(),
                }),
              ];
            });
          }
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={deleteTaskId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTaskId(null);
        }}
        title={t(tasksDict, props.locale, "deleteTaskLabel")}
        description={
          (() => {
            const target = tasks.find((t) => t.id === deleteTaskId);
            const displaySubject = target ? preferHe(target.subject, target.subject_he, props.locale, target.subject_ar) : "";
            return (
              <>
                {t(tasksDict, props.locale, "confirmDeleteTaskPrefix")}{" "}
                <span className="font-medium">&quot;{displaySubject}&quot;</span>
                {t(tasksDict, props.locale, "confirmDeleteTaskSuffix")}
              </>
            );
          })()
        }
        confirmLabel={t(commonDict, props.locale, "delete")}
        destructive
        loading={deletingTask}
        onConfirm={() => void performDeleteTask()}
      />
    </div>
  );
}
