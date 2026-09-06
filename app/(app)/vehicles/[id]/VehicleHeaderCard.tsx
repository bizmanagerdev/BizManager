"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { DeleteIcon, EditIcon, NotificationIcon } from "@/components/ui/icons";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { HeaderActionsMenu } from "@/components/layout/HeaderActionsMenu";
import { useSetHeaderAction } from "@/components/layout/page-title-context";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import {
  EMPTY_VEHICLE_FORM,
  vehicleToForm,
  buildVehiclePatch,
  formatMileage,
  type Vehicle,
  type VehicleInput,
} from "@/lib/vehicles";
import VehicleFormFields from "@/components/vehicles/VehicleFormFields";
import VehiclePhotoAvatar from "@/components/vehicles/VehiclePhotoAvatar";
import { VehicleExpiryRow, type VehicleExpiryKind } from "@/components/vehicles/VehicleExpiryRow";
import { VehicleExpiryQuickEditDialog } from "@/components/vehicles/VehicleExpiryQuickEditDialog";
import { deleteVehicle, updateVehicle } from "../actions";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit } from "@/lib/undo-engine";

/** The vehicle detail page's own header — lets you edit the car right here, not only from the /vehicles list. */
export default function VehicleHeaderCard({ vehicle }: { vehicle: Vehicle }) {
  const router = useRouter();
  const [display] = useUndoOverlay([vehicle], (v) => v.tagId, "vehicle");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<VehicleInput>(EMPTY_VEHICLE_FORM);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [quickEditKind, setQuickEditKind] = useState<VehicleExpiryKind | null>(null);

  function set<K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openEdit() {
    setForm(vehicleToForm(display));
    setOpen(true);
  }

  function submit() {
    if (!form.name.trim() && !form.make_model.trim() && !form.license_plate.trim()) {
      toast.error("יש להזין לפחות שם, דגם או מספר רישוי.");
      return;
    }
    setOpen(false);
    scheduleDeferredEdit({
      scope: "vehicle",
      id: vehicle.tagId,
      message: "הרכב עודכן.",
      patch: buildVehiclePatch(form),
      onCommit: async () => {
        const result = await updateVehicle(vehicle.tagId, form);
        if (result.ok) {
          router.refresh();
          return { ok: true };
        }
        return { ok: false, error: result.error };
      },
    });
  }

  function confirmDelete() {
    setDeleteOpen(false);
    emitNavigationStart();
    router.push("/vehicles");
    scheduleDeferredDelete({
      scope: "vehicle",
      id: vehicle.tagId,
      message: "הרכב נמחק.",
      onCommit: async () => {
        const result = await deleteVehicle(vehicle.tagId);
        if (result.ok) return { ok: true };
        return { ok: false, error: result.error };
      },
    });
  }

  // Phone: same actions, but as the top bar's ⋮ — this card has no room for a
  // button row above the fold there. Desktop keeps the inline row below.
  const headerMenu = useMemo(
    () => (
      <HeaderActionsMenu>
        <DropdownMenuItem className="gap-2" onSelect={() => setReminderOpen(true)}>
          <NotificationIcon className="h-4 w-4 text-warning" />
          <span>תזכורת</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2"
          onSelect={() => {
            setForm(vehicleToForm(display));
            setOpen(true);
          }}
        >
          <EditIcon className="h-4 w-4" />
          <span>עריכה</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={() => setDeleteOpen(true)}
        >
          <DeleteIcon className="h-4 w-4" />
          <span>מחיקת רכב</span>
        </DropdownMenuItem>
      </HeaderActionsMenu>
    ),
    [display]
  );
  useSetHeaderAction(headerMenu);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <VehiclePhotoAvatar tagId={vehicle.tagId} name={display.name} photoUrl={display.photoUrl} size="lg" editable />
          <div className="min-w-0 break-words">
            <h1 className="text-2xl font-semibold">{display.name}</h1>
            <p className="text-sm text-muted-foreground">
              {[display.makeModel, display.licensePlate, display.year, formatMileage(display.mileage)]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
        </div>
        <div className="hidden shrink-0 gap-1 lg:flex">
          <AddReminderButton
            entityType="vehicle"
            entityId={vehicle.tagId}
            label={display.name}
            className="h-9 w-9 p-0"
            iconOnly
            open={reminderOpen}
            onOpenChange={setReminderOpen}
          />
          <EditButton onClick={openEdit} label="עריכת רכב" />
          <DeleteButton onClick={() => setDeleteOpen(true)} label="מחיקת רכב" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <VehicleExpiryRow kind="test" label="טסט" date={display.testDueDate} onEdit={() => setQuickEditKind("test")} />
        <VehicleExpiryRow kind="insurance" label="ביטוח" date={display.insuranceDueDate} onEdit={() => setQuickEditKind("insurance")} />
        <VehicleExpiryRow kind="license" label="רישוי" date={display.licenseDueDate} onEdit={() => setQuickEditKind("license")} />
      </div>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="עריכת רכב"
        description="פרטי הרכב משמשים לתיוג הוצאות, משימות ומסמכים."
        size="form2xl"
        onSubmit={submit}
        submitLabel="שמירה"
      >
        <VehicleFormFields form={form} set={set} />
      </FormDialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="מחיקת רכב"
        description="הרכב יימחק והתיוג שלו יוסר מההוצאות, ההכנסות, המשימות והמסמכים — אך הם עצמם לא יימחקו."
        confirmLabel="מחיקה"
        destructive
        onConfirm={confirmDelete}
      />

      <VehicleExpiryQuickEditDialog
        vehicle={display}
        kind={quickEditKind}
        open={quickEditKind !== null}
        onOpenChange={(open) => !open && setQuickEditKind(null)}
      />
    </div>
  );
}
