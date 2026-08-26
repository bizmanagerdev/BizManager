"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditButton } from "@/components/ui/icon-button";
import { updateProperty } from "../actions";
import {
  PropertyUtilityFields,
  UTILITY_ACCOUNT_FIELDS,
  propertyToForm,
  type PropertyInput,
} from "../PropertyFormFields";
import type { Property } from "@/lib/properties";

const UTILITY_KEYS = UTILITY_ACCOUNT_FIELDS.map((f) => f.key) as readonly (keyof PropertyInput)[];

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

/**
 * "מספרי חוזה" — the account number this apartment has with each utility
 * (חשמל / מים / גז / ארנונה), edited in place like the other detail cards.
 *
 * Always rendered, even when nothing is filled in yet: the number is needed
 * exactly at the moments the office is NOT next to the paperwork — a tenant
 * swap, a meter reading, a bill query — so an empty card that says which four
 * are missing is worth more than a card that hides until someone finds them.
 */
export default function PropertyUtilitiesCard({
  propertyId,
  property,
}: {
  propertyId: string;
  property: Property;
}) {
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
      const result = await updateProperty(propertyId, {
        ...propertyToForm(property),
        ...pick(draft, UTILITY_KEYS),
      });
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

  const filled = UTILITY_ACCOUNT_FIELDS.filter((f) => property[f.propertyKey]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">מספרי חוזה</CardTitle>
        {editing ? null : <EditButton onClick={openEdit} label="עריכת מספרי חוזה" />}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <PropertyUtilityFields form={draft} set={setField} />
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
        ) : filled.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא הוזנו מספרי חוזה (חשמל, מים, גז, ארנונה).</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {UTILITY_ACCOUNT_FIELDS.map((field) => (
              <div key={field.key}>
                <span className="text-muted-foreground">{`${field.label}: `}</span>
                <span className="tabular-nums">{property[field.propertyKey] || "—"}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
