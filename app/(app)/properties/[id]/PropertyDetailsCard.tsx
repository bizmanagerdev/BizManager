"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditButton } from "@/components/ui/icon-button";
import { invalidateQuickCreateCache } from "@/components/layout/QuickCreateMenu";
import { updateProperty } from "../actions";
import { PropertyBasicFields, propertyToForm, type PropertyInput } from "../PropertyFormFields";
import { propertyTypeLabel, type Property } from "@/lib/properties";

const BASIC_KEYS = [
  "name",
  "address",
  "asset_description",
  "is_active",
  "property_type",
  "apartments_count",
  "rooms",
  "square_meters",
  "floor",
  "bathrooms",
  "has_private_entrance",
  "has_storage_room",
  "has_parking",
  "has_elevator",
] as const satisfies readonly (keyof PropertyInput)[];

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

/**
 * "פרטי הנכס" — name/address/description/physical facts/amenities, edited IN
 * PLACE (no popup). The header above still carries the name+address as the
 * page's identity, so the read view here starts from description/facts/
 * badges; edit mode exposes the full set (name/address included) since this
 * is now the only place those are editable at all.
 *
 * The draft holds a FULL PropertyInput (not just this card's fields) so it can
 * be handed straight to the shared `PropertyBasicFields`, but on save only
 * this card's own keys are taken from it — merged onto a FRESH
 * `propertyToForm(property)` snapshot, not the draft's own (possibly stale)
 * copy of the other cards' fields. That's what keeps three independent inline
 * editors on the same row from clobbering each other's already-saved edits.
 */
export default function PropertyDetailsCard({ propertyId, property }: { propertyId: string; property: Property }) {
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
    if (!draft.address.trim()) {
      toast.error("יש להזין כתובת.");
      return;
    }
    if (!draft.name.trim()) {
      toast.error("יש להזין שם לנכס.");
      return;
    }
    setBusy(true);
    try {
      const result = await updateProperty(propertyId, { ...propertyToForm(property), ...pick(draft, BASIC_KEYS) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("הנכס עודכן.");
      setEditing(false);
      invalidateQuickCreateCache();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">פרטי הנכס</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PropertyBasicFields form={draft} set={setField} />
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
        </CardContent>
      </Card>
    );
  }

  const facts = [
    // A building has apartments, not a room count — everything else keeps
    // showing rooms exactly as before (including an unset type, unchanged behavior).
    property.propertyType === "building"
      ? property.apartmentsCount != null
        ? `${property.apartmentsCount} דירות`
        : null
      : property.rooms != null
        ? `${property.rooms} חדרים`
        : null,
    property.floor != null ? `קומה ${property.floor}` : null,
    property.squareMeters != null ? `${property.squareMeters} מ״ר` : null,
    property.bathrooms != null ? `${property.bathrooms} חדרי רחצה` : null,
  ].filter(Boolean);
  const badges = [
    property.propertyType ? { label: propertyTypeLabel(property.propertyType), variant: "outline" as const } : null,
    !property.isActive ? { label: "לא פעיל", variant: "neutral" as const } : null,
    property.hasPrivateEntrance ? { label: "כניסה פרטית", variant: "outline" as const } : null,
    property.hasStorageRoom ? { label: "מחסן", variant: "outline" as const } : null,
    property.hasParking ? { label: "חניה", variant: "outline" as const } : null,
    property.hasElevator ? { label: "מעלית", variant: "outline" as const } : null,
    property.isFurnished ? { label: "מרוהט", variant: "outline" as const } : null,
  ].filter((b): b is { label: string; variant: "neutral" | "outline" } => Boolean(b));
  const hasDetails = Boolean(property.assetDescription) || facts.length > 0 || badges.length > 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">פרטי הנכס</CardTitle>
        <EditButton onClick={openEdit} label="עריכת פרטי הנכס" />
      </CardHeader>
      <CardContent className="space-y-2">
        {!hasDetails ? (
          <p className="text-sm text-muted-foreground">לא הוזנו פרטים נוספים לנכס זה.</p>
        ) : (
          <>
            {property.assetDescription ? <p className="text-sm">{property.assetDescription}</p> : null}
            {facts.length > 0 ? <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p> : null}
            {badges.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {badges.map((b) => (
                  <Badge key={b.label} variant={b.variant}>
                    {b.label}
                  </Badge>
                ))}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
