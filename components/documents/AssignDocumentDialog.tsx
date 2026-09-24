"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OptionRow } from "@/components/ui/option-row";
import {
  ASSIGNABLE_ENTITY_LABEL,
  ASSIGNABLE_ENTITY_TYPES,
  assignDocumentsToEntity,
  type AssignableEntityType,
} from "@/lib/documents/assign";

export type AssignTargetOption = { id: string; label: string };

// "שייך ל…" — the action that empties the unfiled pile. Pick what kind of thing,
// then which one. Search is always present because a real customer list is long.

export default function AssignDocumentDialog({
  documentIds,
  documentTitle,
  open,
  onOpenChange,
  projects,
  orders = [],
  properties,
  customers,
  vehicles,
  tasks = [],
  onAssigned,
}: {
  documentIds: string[];
  documentTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: AssignTargetOption[];
  orders?: AssignTargetOption[];
  properties: AssignTargetOption[];
  customers: AssignTargetOption[];
  vehicles: AssignTargetOption[];
  tasks?: AssignTargetOption[];
  onAssigned?: () => void;
}) {
  const [entityType, setEntityType] = useState<AssignableEntityType>("project");
  useEffect(() => {
    if (!open) return;
    if (optionsByType[entityType].length === 0) {
      const firstWithOptions = ASSIGNABLE_ENTITY_TYPES.find((t) => optionsByType[t].length > 0);
      if (firstWithOptions) setEntityType(firstWithOptions);
    }
    // Only when the dialog opens — changing type mid-session is the user's call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId("");
  }, [open]);

  const optionsByType: Record<AssignableEntityType, AssignTargetOption[]> = useMemo(
    () => ({
      project: projects,
      order: orders,
      customer: customers,
      property: properties,
      vehicle: vehicles,
      task: tasks,
    }),
    [projects, orders, customers, properties, vehicles, tasks]
  );

  // Only offer a kind that has something to pick.
  const availableTypes = ASSIGNABLE_ENTITY_TYPES.filter(
    (type) => optionsByType[type].length > 0
  );

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const list = optionsByType[entityType];
    return (text ? list.filter((o) => o.label.toLowerCase().includes(text)) : list).slice(0, 40);
  }, [optionsByType, entityType, query]);

  async function save() {
    if (documentIds.length === 0 || !selectedId || busy) return;
    setBusy(true);
    try {
      const { ok, failed } = await assignDocumentsToEntity(documentIds, entityType, selectedId);
      if (ok === 0) {
        toast.error("השיוך נכשל.");
        return;
      }
      toast.success(
        failed > 0 ? `${ok} שויכו, ${failed} נכשלו` : ok === 1 ? "המסמך שויך" : `${ok} מסמכים שויכו`
      );
      onOpenChange(false);
      onAssigned?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="שיוך מסמך"
      description={documentTitle}
      size="formMd"
      onSubmit={() => void save()}
      submitLabel="שיוך"
      busyLabel="משייך..."
      busy={busy}
      submitDisabled={!selectedId}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {availableTypes.map((type) => (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={entityType === type ? "default" : "outline"}
              onClick={() => {
                setEntityType(type);
                setSelectedId("");
                setQuery("");
              }}
            >
              {ASSIGNABLE_ENTITY_LABEL[type]}
            </Button>
          ))}
        </div>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`חיפוש ${ASSIGNABLE_ENTITY_LABEL[entityType]}`}
          disabled={busy}
        />

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא נמצאו תוצאות.</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {filtered.map((option) => (
              <OptionRow
                key={option.id}
                label={option.label}
                selected={selectedId === option.id}
                onClick={() => setSelectedId(option.id)}
              />
            ))}
          </div>
        )}
      </div>
    </FormDialog>
  );
}
