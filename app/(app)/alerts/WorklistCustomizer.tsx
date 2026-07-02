"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, RotateCcw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { WORKLIST_SECTIONS, orderedWorklistSections, type WorklistPrefs } from "@/lib/reminders/worklist";

type Section = { id: string; label: string };

function SortableSectionRow({ section, hidden, onToggle }: { section: Section; hidden: boolean; onToggle: (id: string) => void }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: section.id });
  const style = { transform: CSS.Translate.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex items-center gap-3 rounded-xl border border-border/60 bg-background p-3", isDragging && "opacity-70 shadow-lg", hidden && "opacity-60")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="גרור לשינוי הסדר"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <span className={cn("flex-1 text-sm font-medium", hidden && "text-muted-foreground")}>{section.label}</span>
      <Button type="button" size="sm" variant={hidden ? "outline" : "secondary"} onClick={() => onToggle(section.id)}>
        {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {hidden ? "מוסתר" : "מוצג"}
      </Button>
    </div>
  );
}

/** "התאמה" — choose which worklist reminder-type sections to show, and their order. */
export default function WorklistCustomizer({ initialPrefs }: { initialPrefs: WorklistPrefs | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Section[]>(() => orderedWorklistSections(initialPrefs));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initialPrefs?.hidden ?? []));
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((s) => s.id === active.id);
      const to = prev.findIndex((s) => s.id === over.id);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }

  function toggle(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function persist(prefs: WorklistPrefs | null) {
    setSaving(true);
    try {
      const res = await fetch("/api/profile/worklist-prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs }),
      });
      const data = (await res.json().catch(() => ({}))) as { synced?: boolean };
      if (!res.ok) throw new Error("save failed");
      toast[data.synced === false ? "warning" : "success"](
        data.synced === false ? "השינויים נשמרו מקומית אך טרם סונכרנו לחשבון" : "העדפות עודכנו"
      );
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("שמירת ההגדרות נכשלה, נסו שוב");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="h-4 w-4" />
          התאמה
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="text-right">
          <SheetTitle>התאמת מה דורש טיפול</SheetTitle>
          <SheetDescription>בחרו אילו סוגי תזכורות להציג וגררו לשינוי הסדר.</SheetDescription>
        </SheetHeader>

        <div className="-mx-2 mt-4 flex-1 space-y-2 overflow-y-auto px-2">
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {items.map((s) => (
                <SortableSectionRow key={s.id} section={s} hidden={hidden.has(s.id)} onToggle={toggle} />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setItems([...WORKLIST_SECTIONS]);
              setHidden(new Set());
              void persist(null);
            }}
            disabled={saving}
          >
            <RotateCcw className="h-4 w-4" />
            ברירת מחדל
          </Button>
          <Button type="button" onClick={() => void persist({ order: items.map((s) => s.id), hidden: [...hidden] })} disabled={saving}>
            {saving ? "שומר..." : "שמירה"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
