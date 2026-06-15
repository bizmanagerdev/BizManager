"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bell, CheckCircle2, Circle, GripVertical, MapPin, MessageSquare, Plus } from "lucide-react";
import { toast } from "sonner";
import { offlineFetch } from "@/lib/offline-queue";
import { BOARD_STATUSES, type TaskBoardItem } from "@/app/tasks/loadTasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { formatShortDate } from "@/lib/date";
import { TaskUpsertDialog, type TaskOption, type TaskStatus, type UserOption } from "@/components/tasks/TaskUpsertDialog";
import { emitNavigationStart, emitProgressActivityEnd, emitProgressActivityStart } from "@/components/layout/TopNavigationProgress";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel } from "@/lib/expenses";
import { getTaskPriorityLabel, getTaskStatusLabel } from "@/lib/ui/status-colors";

type Props = {
  tasks: TaskBoardItem[];
  projects: TaskOption[];
  properties: TaskOption[];
  users: UserOption[];
  canSeeAll?: boolean;
  currentUserId: string;
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
  // "all" is the default for admin/office, so only persist the opt-in "mine".
  if (filters.scope === "mine") params.set("scope", "mine");
  const qs = params.toString();
  return qs ? `/tasks?${qs}` : "/tasks";
}

function columnSortableId(status: string) {
  return `${COLUMN_PREFIX}${status}`;
}

// ─── Card ──────────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  onOpen,
  onToggleDone,
  onContextMenu,
}: {
  task: TaskBoardItem;
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  const extraMembers = task.members.length > 3 ? task.members.length - 3 : 0;
  const isDone = task.status === "done";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(task.id, e.clientX, e.clientY);
      }}
      className={`cursor-pointer select-none rounded-lg border bg-muted/30 p-2.5 text-sm shadow-sm transition hover:border-primary/40 ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Complete circle — click to move to/from done (Trello-style). */}
        <button
          type="button"
          aria-label={isDone ? "החזרה ללביצוע" : "סימון כבוצע"}
          title={isDone ? "החזרה ל'לביצוע'" : "סימון כבוצע — העברה ל'בוצע'"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleDone(task.id, !isDone);
          }}
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-success"
        >
          {isDone ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4" />}
        </button>
        <div className={`min-w-0 flex-1 font-medium leading-snug ${isDone ? "text-muted-foreground line-through" : ""}`}>
          {task.subject}
        </div>
        {task.priority ? <StatusBadge value={task.priority} type="priority" className="shrink-0 text-[10px]" /> : null}
      </div>

      {/* Date (start/right) + assignees/indicators (end/left), one row. */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {task.due_date ? (
            <span className={task.is_overdue ? "font-medium text-destructive" : ""}>
              {formatShortDate(task.due_date)}
              {task.due_time ? ` ${task.due_time}` : ""}
            </span>
          ) : null}
          {task.city ? (
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="h-3 w-3" />
              {task.city}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {task.has_open_reminder ? <Bell className="h-3.5 w-3.5 text-warning-strong" /> : null}
          {task.comment_count > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" />
              {task.comment_count}
            </span>
          ) : null}
          {task.members.length > 0 ? (
            <div className="flex -space-x-2">
              {task.members.slice(0, 3).map((member) => (
                <InitialsAvatar key={member.id} name={member.name} size="sm" className="ring-2 ring-background" />
              ))}
              {extraMembers > 0 ? (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-medium ring-2 ring-background">
                  +{extraMembers}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
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
}: {
  status: string;
  tasks: TaskBoardItem[];
  onOpen: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onQuickAdd: (status: string, title: string) => Promise<void>;
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
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onQuickAdd(status, trimmed);
      setTitle("");
      setAdding(null);
    } finally {
      setBusy(false);
    }
  }

  const addBox = (
    <div className="space-y-1.5 rounded-lg border bg-card p-2">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="כותרת המשימה"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submitQuickAdd();
          }
          if (e.key === "Escape") {
            setAdding(null);
            setTitle("");
          }
        }}
      />
      <div className="flex gap-1.5">
        <Button type="button" size="sm" disabled={!title.trim() || busy} onClick={() => void submitQuickAdd()}>
          {busy ? "מוסיף..." : "הוספה"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => { setAdding(null); setTitle(""); }}>
          ביטול
        </Button>
      </div>
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex min-w-[78vw] snap-start flex-col rounded-xl bg-muted/70 lg:min-w-0 ${
        isDragging ? "z-10 opacity-70" : ""
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label="גרירת רשימה"
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          {getTaskStatusLabel(status)}
          <span className="rounded-full bg-background px-1.5 text-xs font-normal text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        {/* Always-visible add at the top of the list. */}
        <button
          type="button"
          onClick={() => setAdding("top")}
          aria-label="הוספת כרטיס"
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-2 px-2 pb-2">
        {adding === "top" ? addBox : null}

        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onOpen={onOpen}
            onToggleDone={onToggleDone}
            onContextMenu={onContextMenu}
          />
        ))}

        {adding === "bottom" ? (
          addBox
        ) : (
          <button
            type="button"
            onClick={() => setAdding("bottom")}
            className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-start text-sm text-muted-foreground transition-colors hover:bg-background"
          >
            <Plus className="h-4 w-4" />
            הוספת כרטיס
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
  const urlScope: "mine" | "all" = !canSeeAll ? "mine" : searchParams.get("scope") === "mine" ? "mine" : "all";

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

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubject, setCreateSubject] = useState("");
  const [createStatus, setCreateStatus] = useState<TaskStatus>("todo");
  const [editId, setEditId] = useState<string | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const justDraggedRef = useRef(false);

  const [qInput, setQInput] = useState(urlQ);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setQInput(urlQ), [urlQ]);

  // Mouse for desktop (drag after 8px so plain clicks open the card); touch with a
  // short press-delay for mobile so a tap opens the card and the board still scrolls.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

  const tasksByStatus = useMemo(() => {
    const map = new Map<string, TaskBoardItem[]>();
    for (const status of BOARD_STATUSES) map.set(status, []);
    for (const task of tasks) {
      const status = task.status && map.has(task.status) ? task.status : "todo";
      map.get(status)!.push(task);
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
    async (taskId: string, targetStatus: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || (task.status ?? "todo") === targetStatus) return;
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: targetStatus, is_overdue: targetStatus === "done" ? false : t.is_overdue }
            : t
        )
      );
      emitProgressActivityStart();
      try {
        const result = await offlineFetch(
          "/api/tasks/update-status",
          { id: taskId, status: targetStatus },
          "עדכון סטטוס משימה"
        );
        if (!result.queued && !result.ok) {
          toast.error("שגיאה בעדכון סטטוס", { description: result.error || "" });
          setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)));
          return;
        }
        if (!result.queued) toast.success("הסטטוס עודכן");
      } catch (error: unknown) {
        toast.error("שגיאה בעדכון סטטוס", { description: error instanceof Error ? error.message : "" });
        setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)));
      } finally {
        emitProgressActivityEnd();
      }
    },
    [tasks]
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

    // Card moved to another column.
    if (!overId.startsWith(COLUMN_PREFIX)) return;
    void moveTask(activeId, overId.slice(COLUMN_PREFIX.length));
  }

  function openCard(id: string) {
    if (justDraggedRef.current) return;
    setEditId(id);
  }

  function toggleDone(id: string, done: boolean) {
    void moveTask(id, done ? "done" : "todo");
  }

  function openMenu(id: string, x: number, y: number) {
    setMenu({ id, x, y });
  }

  async function deleteTask(id: string) {
    const task = tasks.find((t) => t.id === id);
    if (!window.confirm(`למחוק את המשימה "${task?.subject ?? ""}"?`)) return;
    const previous = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    emitProgressActivityStart();
    try {
      const result = await offlineFetch("/api/tasks/delete", { id }, "מחיקת משימה");
      if (!result.queued && !result.ok) {
        toast.error("שגיאה במחיקת משימה", { description: result.error || "" });
        setTasks(previous);
        return;
      }
      if (!result.queued) toast.success("המשימה נמחקה");
    } catch (error: unknown) {
      toast.error("שגיאה במחיקת משימה", { description: error instanceof Error ? error.message : "" });
      setTasks(previous);
    } finally {
      emitProgressActivityEnd();
    }
  }

  // Quick-add opens the guided create stepper prefilled with the typed title +
  // the column's status (the task is created only when the user saves).
  async function quickAdd(status: string, title: string) {
    setCreateSubject(title);
    setCreateStatus(status as TaskStatus);
    setCreateOpen(true);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 pt-4 text-sm">
          <div className="min-w-[220px] space-y-1">
            <div className="text-[11px] text-muted-foreground">חיפוש</div>
            <Input value={qInput} onChange={(e) => handleQChange(e.target.value)} placeholder="חיפוש..." />
          </div>
          {canSeeAll ? (
            <div className="flex rounded-xl border bg-secondary/40 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => pushFilters({ q: urlQ, priority: urlPriority, domain: urlDomain, linkedId: urlLinkedId, scope: "mine" })}
                className={`rounded-lg px-3 py-1.5 transition-colors ${urlScope === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                שלי
              </button>
              <button
                type="button"
                onClick={() => pushFilters({ q: urlQ, priority: urlPriority, domain: urlDomain, linkedId: urlLinkedId, scope: "all" })}
                className={`rounded-lg px-3 py-1.5 transition-colors ${urlScope === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                הכל
              </button>
            </div>
          ) : null}
          <div className="w-[120px] space-y-1">
            <div className="text-[11px] text-muted-foreground">עדיפות</div>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={urlPriority}
              onChange={(e) => pushFilters({ q: urlQ, priority: e.target.value, domain: urlDomain, linkedId: urlLinkedId, scope: urlScope })}
            >
              <option value="">הכל</option>
              {PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {getTaskPriorityLabel(priority)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-[160px] space-y-1">
            <div className="text-[11px] text-muted-foreground">דומיין</div>
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={urlDomain}
              onChange={(e) => pushFilters({ q: urlQ, priority: urlPriority, domain: e.target.value, linkedId: "", scope: urlScope })}
            >
              <option value="">הכל</option>
              {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                <option key={domain} value={domain}>
                  {getBusinessDomainLabel(domain)}
                </option>
              ))}
            </select>
          </div>
          {linkedTarget ? (
            <div className="w-[200px] space-y-1">
              <div className="text-[11px] text-muted-foreground">{linkedTarget === "project" ? "פרויקט" : "נכס"}</div>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={urlLinkedId}
                onChange={(e) => pushFilters({ q: urlQ, priority: urlPriority, domain: urlDomain, linkedId: e.target.value, scope: urlScope })}
              >
                <option value="">{linkedTarget === "project" ? "כל הפרויקטים" : "כל הנכסים"}</option>
                {linkedOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Button
            type="button"
            className="ms-auto"
            onClick={() => {
              setCreateSubject("");
              setCreateStatus("todo");
              setCreateOpen(true);
            }}
          >
            <Plus className="ms-1 h-4 w-4" />
            משימה
          </Button>
        </CardContent>
      </Card>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <SortableContext items={columnOrder.map(columnSortableId)} strategy={horizontalListSortingStrategy}>
          <div className="flex snap-x gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
            {columnOrder.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                tasks={tasksByStatus.get(status) ?? []}
                onOpen={openCard}
                onToggleDone={toggleDone}
                onContextMenu={openMenu}
                onQuickAdd={quickAdd}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeColumnStatus ? (
            <div className="rounded-xl bg-muted px-3 py-2.5 text-sm font-semibold shadow-lg">
              {getTaskStatusLabel(activeColumnStatus)}
            </div>
          ) : activeTask ? (
            <div className="rounded-lg border bg-card p-2.5 text-sm shadow-lg">
              <div className="font-medium leading-snug">{activeTask.subject}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Right-click card menu */}
      {menu ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 min-w-36 overflow-hidden rounded-md border bg-popover py-1 text-sm shadow-md"
            style={{ top: menu.y, left: menu.x }}
          >
            <button
              type="button"
              onClick={() => {
                const id = menu.id;
                setMenu(null);
                setEditId(id);
              }}
              className="block w-full px-3 py-1.5 text-start hover:bg-muted/50"
            >
              פתיחה
            </button>
            <button
              type="button"
              onClick={() => {
                const id = menu.id;
                setMenu(null);
                void deleteTask(id);
              }}
              className="block w-full px-3 py-1.5 text-start text-destructive hover:bg-destructive/10"
            >
              מחיקה
            </button>
          </div>
        </>
      ) : null}

      <TaskUpsertDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateSubject("");
        }}
        mode="create"
        users={props.users}
        projects={props.projects}
        properties={props.properties}
        currentUserId={props.currentUserId}
        wizard
        defaultSubject={createSubject}
        defaultStatus={createStatus}
        onSaved={() => router.refresh()}
      />

      <TaskUpsertDialog
        open={editId !== null}
        onOpenChange={(open) => {
          if (!open) setEditId(null);
        }}
        mode="edit"
        taskId={editId}
        users={props.users}
        projects={props.projects}
        properties={props.properties}
        currentUserId={props.currentUserId}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
