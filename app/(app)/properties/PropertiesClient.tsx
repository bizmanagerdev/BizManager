"use client";

import { useDeferredValue, useMemo, useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, BuildingIcon, DragIcon, MoreIcon, SearchIcon } from "@/components/ui/icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Painted, SearchTermsProvider } from "@/components/search/Painted";
import { searchList, type SearchRecord } from "@/lib/search/listSearch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageStack, AdaptiveGrid } from "@/components/layout/page-layout";
import { formatCurrency } from "@/lib/payroll";
import {
  propertyDisplayName,
  propertyHasRoomLayout,
  propertyTypeLabel,
  type PropertyWithLease,
} from "@/lib/properties";
import { RENT_STATE } from "@/lib/property-rent";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { createProperty, updateProperty, deleteProperty, setPropertyOrder } from "./actions";
import { cn } from "@/lib/utils";
import { EMPTY_PROPERTY_FORM, propertyToForm, PropertyFormFields, type PropertyInput } from "./PropertyFormFields";
import { invalidateQuickCreateCache } from "@/components/layout/QuickCreateMenu";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit, registerReversibleCreate } from "@/lib/undo-engine";

const ExpenseDialog = dynamic(() => import("@/components/expenses/ExpenseDialog").then((m) => m.ExpenseDialog), {
  ssr: false,
});
const IncomeDialog = dynamic(() => import("@/components/financial/IncomeDialog").then((m) => m.IncomeDialog), {
  ssr: false,
});

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
      className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground active:cursor-grabbing"
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
  // Adding money straight from a property's card (owner's card, note 1:
  // "הוצאה והכנסה להוסיף בחוץ"), and a reminder from its ⋮.
  const [moneyTarget, setMoneyTarget] = useState<{ kind: "income" | "expense"; property: PropertyWithLease } | null>(null);
  const [reminderTarget, setReminderTarget] = useState<PropertyWithLease | null>(null);
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BuildingIcon className="h-6 w-6" />
            ניהול נכסים
          </h1>
          <p className="text-sm text-muted-foreground">
            נכסים להשכרה, חוזי שכירות, והוצאות/הכנסות לכל נכס במקום אחד.
          </p>
        </div>
        <Button onClick={openCreate}>
          <AddIcon className="h-4 w-4" />
          הוספת נכס
        </Button>
      </div>

      {properties.length > 0 ? (
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש נכס — כתובת, שוכר, סכום..."
            aria-label="חיפוש נכס"
            className="h-10 ps-9"
          />
        </div>
      ) : null}

      {found && shown.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">לא נמצאו נכסים לחיפוש הזה.</CardContent>
        </Card>
      ) : properties.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            עדיין אין נכסים. הוסיפו נכס כדי להתחיל לעקוב אחרי חוזי השכירות וההכנסות/הוצאות שלו.
          </CardContent>
        </Card>
      ) : (
        <SearchTermsProvider terms={found?.search.terms ?? null}>
        {/* Dragged into the owner's order; while searching, the order stays put. */}
        <DndContext id="properties-order-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
        <SortableContext items={shown.map((p) => p.id)} strategy={rectSortingStrategy} disabled={Boolean(found)}>
        <AdaptiveGrid variant="entityCards">
          {shown.map((p) => {
            const net = p.rollup.totalIncomeAmount - p.rollup.paidExpenseAmount;
            const lease = p.currentLease?.status === "active" ? p.currentLease : null;
            const rent = RENT_STATE[p.rentThisMonth.state];
            const name = propertyDisplayName(p);
            return (
              <SortableCard key={p.id} id={p.id} name={name} disabled={Boolean(found) || shown.length < 2}>
              {(handle) => (
              <Card className="flex flex-1 flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  {/* What it is and where (owner's card, note 2: the facts and the
                      amenities moved onto the property's own page). */}
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/properties/${p.id}`} className="min-w-0 flex-1">
                      <div className="text-lg font-semibold hover:underline">
                        <Painted text={name} />
                      </div>
                      {p.name ? (
                        <div className="text-sm text-muted-foreground">
                          <Painted text={p.address} />
                        </div>
                      ) : null}
                    </Link>
                    {handle}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="sm" className="h-9 w-9 shrink-0 p-0" aria-label={`פעולות ל${name}`}>
                          <MoreIcon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => openEdit(p)}>עריכה</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setReminderTarget(p)}>תזכורת</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTarget(p)} className="text-destructive focus:text-destructive">
                          מחיקה
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* Who rents it, and whether this month's rent is in (note 17). */}
                  <div className="flex flex-wrap items-center gap-2">
                    {p.renters && p.renters.count > 0 ? (
                      // A storage property: its renters together (the ניהול נכסים card).
                      <>
                        <Badge variant="outline">
                          {p.renters.count === 1 ? "שוכר אחד" : `${p.renters.count} שוכרים`}
                          {p.renters.monthly > 0 ? ` · ${formatCurrency(p.renters.monthly)}/חודש` : ""}
                          {p.renters.yearly > 0 ? ` · ${formatCurrency(p.renters.yearly)}/שנה` : ""}
                        </Badge>
                        <Badge variant={p.renters.paid >= p.renters.count ? "success" : "warning"}>
                          {p.renters.paid >= p.renters.count ? "שכירות: כולם שילמו" : `שכירות: ${p.renters.paid} מתוך ${p.renters.count} שילמו`}
                        </Badge>
                      </>
                    ) : lease ? (
                      <>
                        <Badge variant="outline">
                          <Link href={`/customers/${lease.customerId}`} className="hover:underline">
                            <Painted text={lease.customerName ?? "שוכר"} />
                          </Link>
                          {" · "}
                          <Painted text={formatCurrency(lease.monthlyRentAmount)} />
                          {lease.periodMonths === 12 ? "/שנה" : "/חודש"}
                        </Badge>
                        <Badge variant={rent.badge}>
                          שכירות {p.rentThisMonth.periodLabel ?? "החודש"}: {rent.label}
                        </Badge>
                      </>
                    ) : (
                      <Badge variant="neutral">פנוי</Badge>
                    )}
                    {!p.isActive ? <Badge variant="neutral">לא פעיל</Badge> : null}
                  </div>

                  {/* Three across where they fit, fewer where a figure wouldn't (5.5rem
                      each — rem, so it follows the text size): "₪-416,275.23" ran out of
                      its third of the card. */}
                  <div className="mt-auto grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-2 text-center text-sm">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">הכנסות</div>
                      <div className="whitespace-nowrap text-xs font-semibold tabular-nums text-success">
                        <Painted text={formatCurrency(p.rollup.totalIncomeAmount)} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">הוצאות</div>
                      <div className="whitespace-nowrap text-xs font-semibold tabular-nums text-destructive">
                        <Painted text={formatCurrency(p.rollup.paidExpenseAmount)} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">נטו</div>
                      <div
                        className={`whitespace-nowrap text-xs font-semibold tabular-nums ${net >= 0 ? "text-success" : "text-destructive"}`}
                      >
                        {formatCurrency(net)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setMoneyTarget({ kind: "income", property: p })}>
                      <AddIcon className="h-4 w-4" />
                      הכנסה
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setMoneyTarget({ kind: "expense", property: p })}>
                      <AddIcon className="h-4 w-4" />
                      הוצאה
                    </Button>
                  </div>
                </CardContent>
              </Card>
              )}
              </SortableCard>
            );
          })}
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

      {moneyTarget?.kind === "income" ? (
        <IncomeDialog
          open
          onOpenChange={(open) => (open ? undefined : setMoneyTarget(null))}
          projects={[]}
          orders={[]}
          properties={[]}
          lockedPropertyId={moneyTarget.property.id}
          onSaved={() => {
            setMoneyTarget(null);
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
      {moneyTarget?.kind === "expense" ? (
        <ExpenseDialog
          open
          onOpenChange={(open) => (open ? undefined : setMoneyTarget(null))}
          lockedPropertyId={moneyTarget.property.id}
          editingSourceLabel={propertyDisplayName(moneyTarget.property)}
          showAttachments
          onSaved={() => startTransition(() => router.refresh())}
        />
      ) : null}
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
