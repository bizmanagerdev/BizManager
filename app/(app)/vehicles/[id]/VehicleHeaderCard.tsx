"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import {
  EMPTY_VEHICLE_FORM,
  vehicleToForm,
  buildVehiclePatch,
  type Vehicle,
  type VehicleInput,
} from "@/lib/vehicles";
import VehicleFormFields from "@/components/vehicles/VehicleFormFields";
import VehiclePhotoAvatar from "@/components/vehicles/VehiclePhotoAvatar";
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

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <VehiclePhotoAvatar tagId={vehicle.tagId} name={display.name} photoUrl={display.photoUrl} size="lg" editable />
        <div className="min-w-0 break-words">
          <h1 className="text-2xl font-semibold">{display.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[display.makeModel, display.licensePlate, display.year].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <AddReminderButton entityType="vehicle" entityId={vehicle.tagId} label={display.name} className="h-9 w-9 p-0" iconOnly />
        <EditButton onClick={openEdit} label="עריכת רכב" />
        <DeleteButton onClick={() => setDeleteOpen(true)} label="מחיקת רכב" />
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
    </div>
  );
}
