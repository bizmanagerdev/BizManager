"use client";

import { useState } from "react";
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
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DragIcon, FilterIcon, HideIcon, RefreshIcon, ShowIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth/requireProfile";
import {
  catalogForRole,
  orderedCatalog,
  type DashboardPrefs,
  type WidgetId,
  type WidgetMeta,
} from "@/lib/dashboard/widgets";

function SortableWidgetRow({
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
        "flex items-center gap-3 rounded-xl border border-border/60 bg-background p-3",
        isDragging && "opacity-70 shadow-lg",
        hidden && "opacity-60"
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="גרור לשינוי הסדר"
        {...attributes}
        {...listeners}
      >
        <DragIcon className="h-5 w-5" />
      </button>

      <span className={cn("flex-1 text-sm font-medium", hidden && "text-muted-foreground")}>{widget.label}</span>

      <Button
        type="button"
        size="sm"
        variant={hidden ? "outline" : "secondary"}
        onClick={() => onToggle(widget.id)}
      >
        {hidden ? <HideIcon className="h-4 w-4" /> : <ShowIcon className="h-4 w-4" />}
        {hidden ? "מוסתר" : "מוצג"}
      </Button>
    </div>
  );
}

/**
 * "התאמת לוח" — lets the viewer toggle dashboard widgets on/off and reorder them
 * by dragging. Role bounds the catalog (only widgets the role is allowed to see
 * appear here), so this can never reveal forbidden data. Saving persists the
 * choice to the account and refreshes the server-rendered dashboard.
 */
export default function DashboardCustomizer({
  role,
  initialPrefs,
}: {
  role: UserRole;
  initialPrefs: DashboardPrefs | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WidgetMeta[]>(() => orderedCatalog(role, initialPrefs));
  const [hidden, setHidden] = useState<Set<WidgetId>>(() => new Set(initialPrefs?.hidden ?? []));
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((w) => w.id === active.id);
      const to = prev.findIndex((w) => w.id === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function toggle(id: WidgetId) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function persist(prefs: DashboardPrefs | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/dashboard-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs }),
      });
      const data = (await res.json().catch(() => ({}))) as { synced?: boolean };
      if (!res.ok) throw new Error("save failed");
      if (data.synced === false) {
        toast.warning("השינויים נשמרו מקומית אך טרם סונכרנו לחשבון");
      } else {
        toast.success("הלוח עודכן");
      }
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("שמירת ההגדרות נכשלה, נסו שוב");
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    void persist({ order: items.map((w) => w.id), hidden: [...hidden] });
  }

  function handleReset() {
    setItems(catalogForRole(role));
    setHidden(new Set());
    void persist(null);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {/* Icon-only on phones so the greeting beside it keeps the full width;
            the label comes back once there's room for it. */}
        <Button variant="outline" size="sm" aria-label="התאמת לוח" className="px-2.5 sm:px-3">
          <FilterIcon className="h-4 w-4" />
          <span className="hidden sm:inline">התאמת לוח</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="text-right">
          <SheetTitle>התאמת לוח</SheetTitle>
          <SheetDescription>בחרו אילו כרטיסים להציג וגררו לשינוי הסדר.</SheetDescription>
        </SheetHeader>

        <div className="-mx-2 mt-4 flex-1 space-y-2 overflow-y-auto px-2">
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              {items.map((w) => (
                <SortableWidgetRow key={w.id} widget={w} hidden={hidden.has(w.id)} onToggle={toggle} />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
          <Button type="button" variant="outline" size="sm" onClick={handleReset} disabled={saving}>
            <RefreshIcon className="h-4 w-4" />
            ברירת מחדל
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "שומר..." : "שמירה"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
