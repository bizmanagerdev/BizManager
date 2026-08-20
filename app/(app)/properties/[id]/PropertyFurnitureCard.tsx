"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditButton } from "@/components/ui/icon-button";
import { updateProperty } from "../actions";
import { PropertyFurnitureFields, propertyToForm, type PropertyInput } from "../PropertyFormFields";
import type { Property } from "@/lib/properties";

const FURNITURE_KEYS = ["is_furnished", "furniture_items"] as const satisfies readonly (keyof PropertyInput)[];

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

/**
 * "ריהוט" — furnished toggle + item checklist, edited in place (no popup).
 * Always rendered, even for a property with no furniture yet: that's the only
 * way to turn furnishing ON, since the toggle itself lives in the edit view.
 */
export default function PropertyFurnitureCard({ propertyId, property }: { propertyId: string; property: Property }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PropertyInput>(() => propertyToForm(property));
  const [busy, setBusy] = useState(false);

  function setField<K extends keyof PropertyInput>(key: K, value: PropertyInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function openEdit() {
    setDraft(propertyToForm(property));
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    try {
      const result = await updateProperty(propertyId, { ...propertyToForm(property), ...pick(draft, FURNITURE_KEYS) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("הנכס עודכן.");
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">ריהוט</CardTitle>
        {editing ? null : <EditButton onClick={openEdit} label="עריכת ריהוט" />}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <PropertyFurnitureFields form={draft} set={setField} />
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
                {busy ? "שומר..." : "שמירה"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDraft(propertyToForm(property));
                  setEditing(false);
                }}
              >
                ביטול
              </Button>
            </div>
          </div>
        ) : !property.isFurnished ? (
          <p className="text-sm text-muted-foreground">הנכס אינו מרוהט.</p>
        ) : property.furnitureItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא הוזנו פריטי ריהוט.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {property.furnitureItems.map((item) => (
              <span key={item} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                {item}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
