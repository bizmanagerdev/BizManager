"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DragIcon, HideIcon, RefreshIcon, ShowIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth/requireProfile";
import {
  catalogForRole,
  orderedCatalog,
  type DashboardPrefs,
  type WidgetId,
  type WidgetMeta,
} from "@/lib/dashboard/widgets";

/** Long enough to fold a burst of clicks into one request, short enough to feel instant. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * One widget as a CHIP, not a full-width row (user, 2026-08-18: "it's too fat and
 * long, put it in a row or something"). Seven stacked rows of drag handle + label
 * + a worded button ran most of a screen for a preference you set once; as chips
 * they wrap into two lines. Same three parts, shrunk: grab, name, show/hide.
 *
 * The eye is icon-only — an icon-only control is the one thing exempt from
 * "every button gets a fill" — and its title/aria carries the Hebrew word.
 */
function SortableWidgetChip({
  widget,
  hidden,
  onToggle,
}: {
  widget: WidgetMeta;
  hidden: boolean;
  onToggle: (id: WidgetId) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: widget.id });

  const style = { transform: CSS.Translate.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border py-1 pe-1.5 ps-2.5 transition-colors",
        hidden
          ? "border-dashed border-border bg-background text-muted-foreground"
          : "border-secondary/40 bg-secondary/10 text-foreground",
        isDragging && "shadow-lg"
      )}
    >
      {/* Its own activator, so dragging never fights the toggle beside it. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label={`גרור לשינוי הסדר — ${widget.label}`}
        title="גרור לשינוי הסדר"
        {...attributes}
        {...listeners}
      >
        <DragIcon className="h-4 w-4" />
      </button>

      <span className="text-sm font-medium">{widget.label}</span>

      <button
        type="button"
        onClick={() => onToggle(widget.id)}
        aria-pressed={!hidden}
        aria-label={hidden ? `הצגת ${widget.label}` : `הסתרת ${widget.label}`}
        title={hidden ? "מוסתר — לחצו להצגה" : "מוצג — לחצו להסתרה"}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
          hidden ? "text-muted-foreground hover:bg-muted" : "text-secondary hover:bg-secondary/20"
        )}
      >
        {hidden ? <HideIcon className="h-4 w-4" /> : <ShowIcon className="h-4 w-4" />}
      </button>
    </div>
  );
}

/**
 * "התאמת לוח" — lets the viewer toggle dashboard widgets on/off and reorder them
 * by dragging. Role bounds the catalog (only widgets the role is allowed to see
 * appear here), so this can never reveal forbidden data. Saving persists the
 * choice to the account and refreshes the server-rendered dashboard.
 *
 * Renders INLINE, as the body of a /profile section (user, 2026-08-18: "not to
 * open as a side overlay ... just open, like the other sections"). It used to be
 * a button that slid a Sheet in from the left, which made a preference sitting
 * among other preferences feel like a different kind of thing — and hid the list
 * behind a click for no gain now that it lives on a settings page.
 *
 * It SAVES ITSELF (user: "I don't want to need to hit save here"). Every toggle
 * and every drop persists, debounced, so a burst of changes is one request.
 * There's no Save button to forget, and no success toast either — a toast per
 * click is noise; the line under the chips says what's happening, and only a
 * FAILURE is worth interrupting for.
 */
export default function DashboardCustomizer({
  role,
  initialPrefs,
}: {
  role: UserRole;
  initialPrefs: DashboardPrefs | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState<WidgetMeta[]>(() => orderedCatalog(role, initialPrefs));
  const [hidden, setHidden] = useState<Set<WidgetId>>(() => new Set(initialPrefs?.hidden ?? []));
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  const persist = useCallback(
    async (prefs: DashboardPrefs | null) => {
      setSaving(true);
      try {
        const res = await fetch("/api/profile/dashboard-prefs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefs }),
          // The save can still be in flight when the page unmounts (toggle, then
          // navigate) — keepalive lets the browser finish it anyway.
          keepalive: true,
        });
        if (!res.ok) throw new Error("save failed");
        const data = (await res.json().catch(() => ({}))) as { synced?: boolean };
        if (data.synced === false) {
          toast.warning("השינויים נשמרו מקומית אך טרם סונכרנו לחשבון");
        }
        router.refresh();
      } catch {
        toast.error("שמירת ההגדרות נכשלה, נסו שוב");
      } finally {
        setSaving(false);
      }
    },
    [router]
  );

  // Dragging a chip across four slots is four drops; hiding three widgets is
  // three clicks. Each schedules a save and cancels the one before it, so the
  // account gets the settled state in a single request.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback(
    (prefs: DashboardPrefs) => {
      if (pending.current) clearTimeout(pending.current);
      pending.current = setTimeout(() => {
        pending.current = null;
        void persist(prefs);
      }, SAVE_DEBOUNCE_MS);
    },
    [persist]
  );

  // Leaving the page with a save still queued must not lose it. The ref holds the
  // CURRENT state, so the unmount effect can stay [] and still flush what's live.
  const flush = useRef<() => void>(() => {});
  flush.current = () => {
    if (!pending.current) return;
    clearTimeout(pending.current);
    pending.current = null;
    void persist({ order: items.map((w) => w.id), hidden: [...hidden] });
  };
  useEffect(() => () => flush.current(), []);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((w) => w.id === active.id);
    const to = items.findIndex((w) => w.id === over.id);
    if (from === -1 || to === -1) return;
    const next = arrayMove(items, from, to);
    setItems(next);
    schedule({ order: next.map((w) => w.id), hidden: [...hidden] });
  }

  function toggle(id: WidgetId) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    schedule({ order: items.map((w) => w.id), hidden: [...next] });
  }

  function handleReset() {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    setItems(catalogForRole(role));
    setHidden(new Set());
    void persist(null);
  }

  return (
    <div className="space-y-3">
      {/* rectSortingStrategy, not the vertical one: the chips wrap, so a strategy
          that only knows about a single column would compute the drop target from
          the wrong axis. */}
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className="flex flex-wrap gap-2">
            {items.map((w) => (
              <SortableWidgetChip key={w.id} widget={w} hidden={hidden.has(w.id)} onToggle={toggle} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <Button type="button" variant="outline" size="sm" onClick={handleReset} disabled={saving}>
          <RefreshIcon className="h-4 w-4" />
          ברירת מחדל
        </Button>
        <span className="text-xs text-muted-foreground">
          {saving ? "שומר..." : "השינויים נשמרים אוטומטית"}
        </span>
      </div>
    </div>
  );
}
