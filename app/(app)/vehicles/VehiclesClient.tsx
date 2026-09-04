"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, DocumentIcon, TaskIcon, TrendDownIcon, VehicleIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageStack, AdaptiveGrid } from "@/components/layout/page-layout";
import { formatCurrency } from "@/lib/payroll";
import {
  expiryStatus,
  EMPTY_VEHICLE_FORM,
  vehicleToForm,
  buildVehiclePatch,
  type VehicleInput,
  type VehicleWithRollup,
} from "@/lib/vehicles";
import VehicleFormFields from "@/components/vehicles/VehicleFormFields";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { createVehicle, updateVehicle, deleteVehicle } from "./actions";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit, registerReversibleCreate } from "@/lib/undo-engine";

function ExpiryRow({ label, date }: { label: string; date: string | null }) {
  const status = expiryStatus(date);
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {date ? (
        <span className="flex items-center gap-2">
          <span>{date}</span>
          {status ? <Badge variant={status.tone}>{status.label}</Badge> : null}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}

export default function VehiclesClient({ vehicles: vehiclesProp }: { vehicles: VehicleWithRollup[] }) {
  const router = useRouter();
  const vehicles = useUndoOverlay(vehiclesProp, (v) => v.tagId, "vehicle");
  const [pending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTagId, setEditTagId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleInput>(EMPTY_VEHICLE_FORM);
  const [deleteTarget, setDeleteTarget] = useState<VehicleWithRollup | null>(null);

  function set<K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditTagId(null);
    setForm(EMPTY_VEHICLE_FORM);
    setDialogOpen(true);
  }

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <VehicleIcon className="h-6 w-6" />
            רכבים
          </h1>
          <p className="text-sm text-muted-foreground">
            תייגו הוצאות, משימות ומסמכים לרכב כדי לראות את כל הפעילות והעלויות שלו במקום אחד.
          </p>
        </div>
        <Button onClick={openCreate}>
          <AddIcon className="h-4 w-4" />
          הוספת רכב
        </Button>
      </div>

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
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-lg font-semibold">{v.name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {[v.makeModel, v.licensePlate, v.year].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {v.ownerName ? (
                        <div className="truncate text-xs text-muted-foreground">רשום על שם: {v.ownerName}</div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <AddReminderButton entityType="vehicle" entityId={v.tagId} label={v.name} className="h-9 w-9 p-0" iconOnly />
                      <EditButton onClick={() => openEdit(v)} label="עריכה" />
                      <DeleteButton onClick={() => setDeleteTarget(v)} label="מחיקת רכב" />
                    </div>
                  </div>

                  <div className="space-y-1 rounded-md border bg-muted/20 p-2">
                    <ExpiryRow label="טסט" date={v.testDueDate} />
                    <ExpiryRow label="ביטוח" date={v.insuranceDueDate} />
                    <ExpiryRow label="רישוי" date={v.licenseDueDate} />
                  </div>

                  <div className="mt-auto flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 font-semibold text-destructive">
                      <TrendDownIcon className="h-3.5 w-3.5" />
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
    </PageStack>
  );
}
