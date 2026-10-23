"use client";

import { useDeferredValue, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DragIcon } from "@/components/ui/icons";
import { SearchTermsProvider } from "@/components/search/Painted";
import { searchList, type SearchRecord } from "@/lib/search/listSearch";
import { Card, CardContent } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageStack, AdaptiveGrid } from "@/components/layout/page-layout";
import {
  propertyDisplayName,
  propertyHasRoomLayout,
  propertyTypeLabel,
  type PropertyWithLease,
} from "@/lib/properties";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { createProperty, updateProperty, deleteProperty, setPropertyOrder } from "./actions";
import { cn } from "@/lib/utils";
import { EMPTY_PROPERTY_FORM, propertyToForm, PropertyFormFields, type PropertyInput } from "./PropertyFormFields";
import { invalidateQuickCreateCache } from "@/components/layout/QuickCreateMenu";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit, registerReversibleCreate } from "@/lib/undo-engine";
import { ListSearch, SearchEverywhereLink } from "@/components/ui/list-search";
import PropertyListCard from "./PropertyListCard";
import { cachedPropertyPhotos, loadPropertyPhotos } from "./propertyPhotos";

function numOrNullFromForm(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function buildPropertyPatch(input: PropertyInput) {
  return {
    name: input.name.trim() || null,
    address: input.address.trim(),
    addr: input.addr,
    assetDescription: input.asset_description.trim() || null,
    isActive: input.is_active,
    propertyType: input.property_type || null,
    apartmentsCount: numOrNullFromForm(input.apartments_count),
    rooms: numOrNullFromForm(input.rooms),
    squareMeters: numOrNullFromForm(input.square_meters),
    floor: numOrNullFromForm(input.floor),
    bathrooms: numOrNullFromForm(input.bathrooms),
    mezuzahCount: numOrNullFromForm(input.mezuzah_count),
    lightBulbCount: numOrNullFromForm(input.light_bulb_count),
    hasPrivateEntrance: input.has_private_entrance,
    hasStorageRoom: input.has_storage_room,
    hasParking: input.has_parking,
    hasElevator: input.has_elevator,
    isFurnished: input.is_furnished,
    rentManagedByCompany: input.rent_managed_by_company,
    managementCompanyName: input.management_company_name.trim() || null,
  };
}

/** "3 חדרים · קומה 2 · 65 מ״ר · 2 חדרי רחצה" — only the parts that are set. */
function factsLine(p: PropertyWithLease): (string | null)[] {
  // A building has apartments, not a room count; a מחסן has neither — just area.
  const hasRoomLayout = propertyHasRoomLayout(p.propertyType);
  return [
    p.propertyType === "building"
      ? p.apartmentsCount != null
        ? `${p.apartmentsCount} דירות`
        : null
      : hasRoomLayout && p.rooms != null
        ? `${p.rooms} חדרים`
        : null,
    p.floor != null ? `קומה ${p.floor}` : null,
    p.squareMeters != null ? `${p.squareMeters} מ״ר` : null,
    hasRoomLayout && p.bathrooms != null ? `${p.bathrooms} חדרי רחצה` : null,
    hasRoomLayout && p.mezuzahCount != null ? `${p.mezuzahCount} מזוזות` : null,
    p.lightBulbCount != null ? `${p.lightBulbCount} נורות` : null,
  ];
}

// The page's search (owner, 2026-10-19: "properties … no search"), by the
// global search's rules: everything on the card — its name and address, what
// it is, the tenant and the rent, its figures — painted where it matched.
function propertySearchRecord(p: PropertyWithLease): SearchRecord {
  return {
    text: [
      [null, propertyDisplayName(p)],
      [null, p.address],
      [null, p.assetDescription],
      [null, p.currentLease?.customerName],
      [null, factsLine(p).filter(Boolean).join(" · ")],
      [null, amenityBadges(p).join(" ")],
      [null, p.currentLease || p.renters?.count ? null : "פנוי"],
    ],
    amounts: [
      [null, p.currentLease?.monthlyRentAmount],
      [null, p.rollup.paidExpenseAmount],
      [null, p.rollup.totalIncomeAmount],
    ],
  };
}

function amenityBadges(p: PropertyWithLease) {
  const items: string[] = [];
  if (p.propertyType) items.push(propertyTypeLabel(p.propertyType));
  if (p.hasPrivateEntrance) items.push("כניסה פרטית");
  if (p.hasStorageRoom) items.push("מחסן");
  if (p.hasParking) items.push("חניה");
  if (p.hasElevator) items.push("מעלית");
  if (p.isFurnished) items.push("מרוהט");
  return items;
}

/**
 * A card that can be dragged into the owner's own order (the ניהול נכסים card)
 * by its handle — only the handle, so a tap on the card still opens it, and a
 * phone scrolls past it (the touch waits a moment before it drags).
 */
function SortableCard({
  id,
  name,
  disabled,
  children,
}: {
  id: string;
  name: string;
  disabled: boolean;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const handle = disabled ? null : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="flex h-7 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing"
      aria-label={`גרירה לשינוי הסדר — ${name}`}
      title="גרירה לשינוי הסדר"
      {...attributes}
      {...listeners}
    >
      <DragIcon className="h-4 w-4" />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("flex flex-col", isDragging && "relative z-10 opacity-90 shadow-lg")}
    >
      {children(handle)}
    </div>
  );
}

export default function PropertiesClient({ properties: propertiesProp }: { properties: PropertyWithLease[] }) {
  const router = useRouter();
  const properties = useUndoOverlay(propertiesProp, (p) => p.id, "property");
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PropertyInput>(EMPTY_PROPERTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<PropertyWithLease | null>(null);
  // A reminder from a card's ⋮.
  const [reminderTarget, setReminderTarget] = useState<PropertyWithLease | null>(null);
  const [photos, setPhotos] = useState<Record<string, string>>(() => cachedPropertyPhotos() ?? {});
  useEffect(() => {
    let live = true;
    void loadPropertyPhotos().then((loaded) => {
      if (live) setPhotos(loaded);
    });
    return () => {
      live = false;
    };
  }, []);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  // The order just dragged, until the list comes back from the server in it.
  const [order, setOrder] = useState<string[] | null>(null);
  const [orderFor, setOrderFor] = useState(propertiesProp);
  if (propertiesProp !== orderFor) {
    setOrderFor(propertiesProp);
    setOrder(null);
  }
  const ordered = useMemo(() => {
    if (!order) return properties;
    const place = new Map(order.map((id, index) => [id, index]));
    return [...properties].sort((a, b) => (place.get(a.id) ?? Infinity) - (place.get(b.id) ?? Infinity));
  }, [properties, order]);
  const found = useMemo(() => searchList(ordered, propertySearchRecord, deferredSearch), [ordered, deferredSearch]);
  const shown = found ? found.items : ordered;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function dragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((p) => p.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    setPropertyOrder(next)
      .then((result) => {
        if (result.ok) return startTransition(() => router.refresh());
        toast.error(result.error);
        setOrder(null);
      })
      .catch(() => {
        // It never reached the server (no signal): back as it was.
        toast.error("שמירת הסדר נכשלה — בדקו את החיבור.");
        setOrder(null);
      });
  }

  function set<K extends keyof PropertyInput>(key: K, value: PropertyInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditId(null);
    setForm(EMPTY_PROPERTY_FORM);
    setDialogOpen(true);
  }

  // The + menu's own "נכס" tile (on this page instead of קליטת תשלום — see
  // QuickCreateMenu.tsx) opens this dialog, as the cars page does.
  useEffect(() => {
    const onQuickCreate = () => openCreate();
    window.addEventListener("bizh:property-quick-create", onQuickCreate);
    return () => window.removeEventListener("bizh:property-quick-create", onQuickCreate);
  }, []);

  function openEdit(p: PropertyWithLease) {
    setEditId(p.id);
    setForm(propertyToForm(p));
    setDialogOpen(true);
  }

  function submit() {
    if (!form.address.trim()) {
      toast.error("יש להזין כתובת.");
      return;
    }
    if (editId) {
      const id = editId;
      const snapshotForm = form;
      setDialogOpen(false);
      scheduleDeferredEdit({
        scope: "property",
        id,
        message: "הנכס עודכן.",
        patch: buildPropertyPatch(snapshotForm),
        onCommit: async () => {
          const result = await updateProperty(id, snapshotForm);
          if (!result.ok) return { ok: false, error: result.error };
          invalidateQuickCreateCache();
          startTransition(() => { router.refresh(); });
          return { ok: true };
        },
      });
      return;
    }
    startTransition(async () => {
      const result = await createProperty(form);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDialogOpen(false);
      invalidateQuickCreateCache();
      router.refresh();
      const newId = result.id;
      if (!newId) return; // defensive — createProperty always returns an id on success
      registerReversibleCreate({
        scope: "property",
        id: newId,
        message: "הנכס נוסף.",
        onUndo: async () => {
          const del = await deleteProperty(newId);
          invalidateQuickCreateCache();
          router.refresh();
          return del;
        },
      });
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    scheduleDeferredDelete({
      scope: "property",
      id: target.id,
      message: "הנכס נמחק.",
      onCommit: async () => {
        const result = await deleteProperty(target.id);
        if (!result.ok) return { ok: false, error: result.error };
        invalidateQuickCreateCache();
        startTransition(() => { router.refresh(); });
        return { ok: true };
      },
    });
  }

  return (
    <PageStack>
      {properties.length > 0 ? (
        <ListSearch value={search} onChange={setSearch} placeholder="חיפוש בנכסים — כתובת, שוכר, סכום…" label="חיפוש בנכסים" />
      ) : null}

      {found && shown.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-10 text-center text-muted-foreground">
            <div>לא נמצאו נכסים לחיפוש הזה.</div>
            <SearchEverywhereLink query={search} />
          </CardContent>
        </Card>
      ) : properties.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            עדיין אין נכסים. הוסיפו נכס מה-+ כדי להתחיל לעקוב אחרי חוזי השכירות וההכנסות/הוצאות שלו.
          </CardContent>
        </Card>
      ) : (
        <SearchTermsProvider terms={found?.search.terms ?? null}>
        {/* Dragged into the owner's order; while searching, the order stays put. */}
        <DndContext id="properties-order-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
        <SortableContext items={shown.map((p) => p.id)} strategy={rectSortingStrategy} disabled={Boolean(found)}>
        <AdaptiveGrid variant="entityCards">
          {shown.map((p) => (
            <SortableCard key={p.id} id={p.id} name={propertyDisplayName(p)} disabled={Boolean(found) || shown.length < 2}>
              {(handle) => (
                <PropertyListCard
                  property={p}
                  photoUrl={photos[p.id] ?? null}
                  handle={handle}
                  onEdit={() => openEdit(p)}
                  onReminder={() => setReminderTarget(p)}
                  onDelete={() => setDeleteTarget(p)}
                />
              )}
            </SortableCard>
          ))}
        </AdaptiveGrid>
        </SortableContext>
        </DndContext>
        </SearchTermsProvider>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editId ? "עריכת נכס" : "הוספת נכס"}
        description="פרטי הנכס משמשים לתיוג חוזי שכירות, הוצאות והכנסות."
        size="formLg"
        onSubmit={submit}
        submitLabel={editId ? "שמירה" : "הוספה"}
        busy={pending}
      >
        <PropertyFormFields form={form} set={set} />
      </FormDialog>

      {reminderTarget ? (
        <AddReminderButton
          entityType="property"
          entityId={reminderTarget.id}
          label={propertyDisplayName(reminderTarget)}
          hideTrigger
          open
          onOpenChange={(open) => (open ? undefined : setReminderTarget(null))}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="מחיקת נכס"
        description="ניתן למחוק רק נכס ללא היסטוריה (חוזים, הוצאות, הכנסות או משימות). לנכסים עם היסטוריה — יש להשבית במקום למחוק."
        confirmLabel="מחיקה"
        destructive
        loading={pending}
        onConfirm={confirmDelete}
      />
    </PageStack>
  );
}
