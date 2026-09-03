"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, BuildingIcon } from "@/components/ui/icons";
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
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { createProperty, updateProperty, deleteProperty } from "./actions";
import { EMPTY_PROPERTY_FORM, propertyToForm, PropertyFormFields, type PropertyInput } from "./PropertyFormFields";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { invalidateQuickCreateCache } from "@/components/layout/QuickCreateMenu";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit, registerReversibleCreate } from "@/lib/undo-engine";

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
function factsLine(p: PropertyWithLease): string {
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
  ]
    .filter(Boolean)
    .join(" · ");
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

export default function PropertiesClient({ properties: propertiesProp }: { properties: PropertyWithLease[] }) {
  const router = useRouter();
  const properties = useUndoOverlay(propertiesProp, (p) => p.id, "property");
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PropertyInput>(EMPTY_PROPERTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<PropertyWithLease | null>(null);

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
          router.refresh();
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
        router.refresh();
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

      {properties.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            עדיין אין נכסים. הוסיפו נכס כדי להתחיל לעקוב אחרי חוזי השכירות וההכנסות/הוצאות שלו.
          </CardContent>
        </Card>
      ) : (
        <AdaptiveGrid variant="customerStats">
          {properties.map((p) => {
            const net = p.rollup.totalIncomeAmount - p.rollup.paidExpenseAmount;
            return (
              <Card key={p.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/properties/${p.id}`} className="min-w-0 flex-1">
                      <div className="truncate text-lg font-semibold hover:underline">{propertyDisplayName(p)}</div>
                      {p.name ? <div className="truncate text-sm text-muted-foreground">{p.address}</div> : null}
                      {p.assetDescription ? (
                        <div className="truncate text-sm text-muted-foreground">{p.assetDescription}</div>
                      ) : null}
                      {factsLine(p) ? <div className="text-xs text-muted-foreground">{factsLine(p)}</div> : null}
                    </Link>
                    <div className="flex shrink-0 gap-1">
                      <AddReminderButton entityType="property" entityId={p.id} label={propertyDisplayName(p)} className="h-9 w-9 p-0" iconOnly />
                      <EditButton onClick={() => openEdit(p)} label="עריכה" />
                      <DeleteButton onClick={() => setDeleteTarget(p)} label="מחיקת נכס" />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {p.currentLease ? (
                      <Badge variant="success">
                        {p.currentLease.customerName ?? "שוכר"} · {formatCurrency(p.currentLease.monthlyRentAmount)}/חודש
                      </Badge>
                    ) : (
                      <Badge variant="neutral">פנוי</Badge>
                    )}
                    {!p.isActive ? <Badge variant="neutral">לא פעיל</Badge> : null}
                    {amenityBadges(p).map((label) => (
                      <Badge key={label} variant="outline">
                        {label}
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-auto grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">הוצאות</div>
                      <div className="whitespace-nowrap text-xs font-semibold tabular-nums text-destructive">
                        {formatCurrency(p.rollup.paidExpenseAmount)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">הכנסות</div>
                      <div className="whitespace-nowrap text-xs font-semibold tabular-nums text-emerald-600">
                        {formatCurrency(p.rollup.totalIncomeAmount)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">נטו</div>
                      <div
                        className={`whitespace-nowrap text-xs font-semibold tabular-nums ${net >= 0 ? "text-emerald-600" : "text-destructive"}`}
                      >
                        {formatCurrency(net)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </AdaptiveGrid>
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
