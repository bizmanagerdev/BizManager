"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DocumentIcon, EditIcon, DeleteIcon, ExpenseIcon, MoreIcon, NotificationIcon, TaskIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageStack, AdaptiveGrid } from "@/components/layout/page-layout";
import { formatCurrency } from "@/lib/payroll";
import {
  EMPTY_VEHICLE_FORM,
  vehicleToForm,
  buildVehiclePatch,
  formatMileage,
  type VehicleInput,
  type VehicleWithRollup,
} from "@/lib/vehicles";
import VehicleFormFields from "@/components/vehicles/VehicleFormFields";
import VehiclePhotoAvatar from "@/components/vehicles/VehiclePhotoAvatar";
import { VehicleExpiryRow, type VehicleExpiryKind } from "@/components/vehicles/VehicleExpiryRow";
import { VehicleExpiryQuickEditDialog } from "@/components/vehicles/VehicleExpiryQuickEditDialog";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { createVehicle, updateVehicle, deleteVehicle } from "./actions";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit, registerReversibleCreate } from "@/lib/undo-engine";

export default function VehiclesClient({ vehicles: vehiclesProp }: { vehicles: VehicleWithRollup[] }) {
  const router = useRouter();
  const vehicles = useUndoOverlay(vehiclesProp, (v) => v.tagId, "vehicle");
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTagId, setEditTagId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleInput>(EMPTY_VEHICLE_FORM);
  const [deleteTarget, setDeleteTarget] = useState<VehicleWithRollup | null>(null);
  const [reminderTarget, setReminderTarget] = useState<VehicleWithRollup | null>(null);
  const [quickEdit, setQuickEdit] = useState<{ vehicle: VehicleWithRollup; kind: VehicleExpiryKind } | null>(null);

  function set<K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditTagId(null);
    setForm(EMPTY_VEHICLE_FORM);
    setDialogOpen(true);
  }

  // The + menu's own "רכב" tile (only shown on this route — see
  // QuickCreateMenu.tsx) opens THIS dialog rather than a generic one, via the
  // same window-event bridge the calendar's "add to this day" uses.
  useEffect(() => {
    function onQuickCreate() {
      openCreate();
    }
    window.addEventListener("bizh:vehicle-quick-create", onQuickCreate);
    return () => window.removeEventListener("bizh:vehicle-quick-create", onQuickCreate);
  }, []);

  function openEdit(v: VehicleWithRollup) {
    setEditTagId(v.tagId);
    setForm(vehicleToForm(v));
    setDialogOpen(true);
  }

  function submit() {
    if (!form.name.trim() && !form.make_model.trim() && !form.license_plate.trim()) {
      toast.error("יש להזין לפחות שם, דגם או מספר רישוי.");
      return;
    }
    if (editTagId) {
      const id = editTagId;
      const snapshotForm = form;
      setDialogOpen(false);
      scheduleDeferredEdit({
        scope: "vehicle",
        id,
        message: "הרכב עודכן.",
        patch: buildVehiclePatch(snapshotForm),
        onCommit: async () => {
          const result = await updateVehicle(id, snapshotForm);
          if (result.ok) {
            // The write already landed — don't let a refresh hiccup read as a failed edit.
            try {
              router.refresh();
            } catch {
              // best-effort; the next real navigation picks up the fresh data
            }
            return { ok: true };
          }
          return { ok: false, error: result.error };
        },
      });
      return;
    }
    startTransition(async () => {
      const result = await createVehicle(form);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDialogOpen(false);
      router.refresh();
      const newTagId = result.tagId;
      if (!newTagId) return; // defensive — createVehicle always returns a tagId on success
      registerReversibleCreate({
        scope: "vehicle",
        id: newTagId,
        message: "הרכב נוסף.",
        onUndo: async () => {
          const del = await deleteVehicle(newTagId);
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
      scope: "vehicle",
      id: target.tagId,
      message: "הרכב נמחק.",
      onCommit: async () => {
        const result = await deleteVehicle(target.tagId);
        if (result.ok) {
          // The delete already landed — don't let a refresh hiccup read as a failed delete.
          try {
            router.refresh();
          } catch {
            // best-effort; the next real navigation picks up the fresh data
          }
          return { ok: true };
        }
        return { ok: false, error: result.error };
      },
    });
  }

  return (
    <PageStack>
      {vehicles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            עדיין אין רכבים. הוסיפו רכב כדי להתחיל לעקוב אחרי העלויות שלו.
          </CardContent>
        </Card>
      ) : (
        <AdaptiveGrid variant="customerStats">
          {vehicles.map((v) => {
            return (
              <Card
                key={v.tagId}
                className="flex cursor-pointer flex-col transition-colors hover:bg-muted/20"
                {...rowNavigateProps(router, `/vehicles/${v.tagId}`)}
              >
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <VehiclePhotoAvatar tagId={v.tagId} name={v.name} photoUrl={v.photoUrl} size="sm" />
                      <div className="min-w-0 break-words">
                        <div className="text-lg font-semibold">{v.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {[v.makeModel, v.licensePlate, v.year, formatMileage(v.mileage)].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                          title="פעולות"
                          aria-label="פעולות"
                        >
                          <MoreIcon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => setReminderTarget(v)}>
                          <NotificationIcon className="me-2 h-4 w-4 text-warning" />
                          תזכורת
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(v)}>
                          <EditIcon className="me-2 h-4 w-4" />
                          עריכה
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(v)}
                          className="text-destructive focus:text-destructive"
                        >
                          <DeleteIcon className="me-2 h-4 w-4" />
                          מחיקה
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="space-y-2">
                    <VehicleExpiryRow kind="test" label="טסט" date={v.testDueDate} onEdit={() => setQuickEdit({ vehicle: v, kind: "test" })} />
                    <VehicleExpiryRow kind="insurance" label="ביטוח" date={v.insuranceDueDate} onEdit={() => setQuickEdit({ vehicle: v, kind: "insurance" })} />
                    <VehicleExpiryRow kind="license" label="רישוי" date={v.licenseDueDate} onEdit={() => setQuickEdit({ vehicle: v, kind: "license" })} />
                  </div>

                  <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 font-semibold text-foreground">
                      <ExpenseIcon className="h-3.5 w-3.5" />
                      {formatCurrency(v.rollup.paidExpenseAmount)}
                    </span>
                    <span className="flex items-center gap-1">
                      <TaskIcon className="h-3.5 w-3.5" />
                      {v.rollup.openTaskCount}/{v.rollup.taskCount} משימות
                    </span>
                    <span className="flex items-center gap-1">
                      <DocumentIcon className="h-3.5 w-3.5" />
                      {v.rollup.documentCount} מסמכים
                    </span>
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
        title={editTagId ? "עריכת רכב" : "הוספת רכב"}
        description="פרטי הרכב משמשים לתיוג הוצאות, משימות ומסמכים."
        size="form2xl"
        onSubmit={submit}
        submitLabel={editTagId ? "שמירה" : "הוספה"}
        busy={pending}
      >
        <VehicleFormFields form={form} set={set} />
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="מחיקת רכב"
        description="הרכב יימחק והתיוג שלו יוסר מההוצאות, ההכנסות, המשימות והמסמכים — אך הם עצמם לא יימחקו."
        confirmLabel="מחיקה"
        destructive
        loading={pending}
        onConfirm={confirmDelete}
      />

      <AddReminderButton
        entityType="vehicle"
        entityId={reminderTarget?.tagId ?? ""}
        label={reminderTarget?.name}
        hideTrigger
        open={Boolean(reminderTarget)}
        onOpenChange={(open) => !open && setReminderTarget(null)}
      />

      <VehicleExpiryQuickEditDialog
        vehicle={quickEdit?.vehicle ?? null}
        kind={quickEdit?.kind ?? null}
        open={Boolean(quickEdit)}
        onOpenChange={(open) => !open && setQuickEdit(null)}
      />
    </PageStack>
  );
}
