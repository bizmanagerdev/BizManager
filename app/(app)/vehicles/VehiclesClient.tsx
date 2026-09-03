"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, DocumentIcon, TaskIcon, VehicleIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { DateInput } from "@/components/ui/date-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageStack, AdaptiveGrid } from "@/components/layout/page-layout";
import { formatCurrency } from "@/lib/payroll";
import { expiryStatus, type VehicleWithRollup } from "@/lib/vehicles";
import AddReminderButton from "@/components/reminders/AddReminderButton";
import { createVehicle, updateVehicle, deleteVehicle, type VehicleInput } from "./actions";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete, scheduleDeferredEdit, registerReversibleCreate } from "@/lib/undo-engine";

const EMPTY_FORM: VehicleInput = {
  name: "",
  license_plate: "",
  make_model: "",
  year: "",
  test_due_date: "",
  insurance_due_date: "",
  license_due_date: "",
  owner_name: "",
  color: "",
  notes: "",
};

function toForm(v: VehicleWithRollup): VehicleInput {
  return {
    name: v.name ?? "",
    license_plate: v.licensePlate ?? "",
    make_model: v.makeModel ?? "",
    year: v.year ? String(v.year) : "",
    test_due_date: v.testDueDate ?? "",
    insurance_due_date: v.insuranceDueDate ?? "",
    license_due_date: v.licenseDueDate ?? "",
    owner_name: v.ownerName ?? "",
    color: v.color ?? "",
    notes: v.notes ?? "",
  };
}

/** Mirrors actions.ts's server-side deriveName, so the optimistic patch shown
 *  during the undo grace window matches what the server will end up saving. */
function deriveDisplayName(input: VehicleInput): string {
  const explicit = input.name.trim();
  if (explicit) return explicit;
  const parts = [input.make_model.trim(), input.license_plate.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : "רכב";
}

function buildVehiclePatch(input: VehicleInput) {
  const yearNum = Number(input.year);
  return {
    name: deriveDisplayName(input),
    licensePlate: input.license_plate.trim() || null,
    makeModel: input.make_model.trim() || null,
    year: Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2100 ? yearNum : null,
    testDueDate: input.test_due_date.trim() || null,
    insuranceDueDate: input.insurance_due_date.trim() || null,
    licenseDueDate: input.license_due_date.trim() || null,
    ownerName: input.owner_name.trim() || null,
    notes: input.notes.trim() || null,
  };
}

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
  const [form, setForm] = useState<VehicleInput>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<VehicleWithRollup | null>(null);

  function set<K extends keyof VehicleInput>(key: K, value: VehicleInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openCreate() {
    setEditTagId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(v: VehicleWithRollup) {
    setEditTagId(v.tagId);
    setForm(toForm(v));
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
            router.refresh();
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
          router.refresh();
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
            תייגו הוצאות, הכנסות, משימות ומסמכים לרכב כדי לראות את כל הפעילות והעלויות שלו במקום אחד.
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
            עדיין אין רכבים. הוסיפו רכב כדי להתחיל לעקוב אחרי העלויות וההכנסות שלו.
          </CardContent>
        </Card>
      ) : (
        <AdaptiveGrid variant="customerStats">
          {vehicles.map((v) => {
            const net = v.rollup.totalIncomeAmount - v.rollup.paidExpenseAmount;
            return (
              <Card key={v.tagId} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/vehicles/${v.tagId}`} className="min-w-0 flex-1">
                      <div className="truncate text-lg font-semibold hover:underline">{v.name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {[v.makeModel, v.licensePlate, v.year].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {v.ownerName ? (
                        <div className="truncate text-xs text-muted-foreground">רשום על שם: {v.ownerName}</div>
                      ) : null}
                    </Link>
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

                  <div className="mt-auto grid grid-cols-3 gap-2 text-center text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">הוצאות</div>
                      <div className="font-semibold text-destructive">
                        {formatCurrency(v.rollup.paidExpenseAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">הכנסות</div>
                      <div className="font-semibold text-emerald-600">
                        {formatCurrency(v.rollup.totalIncomeAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">נטו</div>
                      <div className={`font-semibold ${net >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                        {formatCurrency(net)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">שם הרכב</span>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">יצרן / דגם</span>
                <Input value={form.make_model} onChange={(e) => set("make_model", e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">מספר רישוי</span>
                <Input value={form.license_plate} onChange={(e) => set("license_plate", e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">שנת ייצור</span>
                <Input
                  inputMode="numeric"
                  value={form.year}
                  onChange={(e) => set("year", e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">טסט הבא</span>
                <DateInput value={form.test_due_date} onChange={(e) => set("test_due_date", e.target.value)} />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">ביטוח עד</span>
                <DateInput
                  value={form.insurance_due_date}
                  onChange={(e) => set("insurance_due_date", e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">רישוי עד</span>
                <DateInput
                  value={form.license_due_date}
                  onChange={(e) => set("license_due_date", e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">רשום על שם</span>
                <Input value={form.owner_name} onChange={(e) => set("owner_name", e.target.value)} />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">הערות</span>
              <div className="relative">
                <Textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  className="pe-11"
                />
                <DictateButton
                  onTranscript={(text) => set("notes", appendDictatedText(form.notes, text))}
                  className="absolute bottom-1 end-1 h-8 w-8"
                />
              </div>
            </label>
          </div>
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
