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
import { propertyHasRoomLayout, propertyTypeLabel, type Property } from "@/lib/properties";
import { scheduleDeferredAction } from "@/lib/undo-engine";

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
  "mezuzah_count",
  "light_bulb_count",
  "key_count",
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

function numOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Mirrors actions.ts's propertyFields() parsing, so the optimistic patch shown
 *  during the undo grace window matches what the server will end up saving. */
function buildDetailsPatch(input: PropertyInput): Partial<Property> {
  return {
    name: input.name.trim() || null,
    address: input.address.trim(),
    assetDescription: input.asset_description.trim() || null,
    isActive: input.is_active,
    propertyType: input.property_type.trim() || null,
    apartmentsCount: numOrNull(input.apartments_count),
    rooms: numOrNull(input.rooms),
    squareMeters: numOrNull(input.square_meters),
    floor: numOrNull(input.floor),
    bathrooms: numOrNull(input.bathrooms),
    mezuzahCount: numOrNull(input.mezuzah_count),
    lightBulbCount: numOrNull(input.light_bulb_count),
    keyCount: numOrNull(input.key_count),
    hasPrivateEntrance: input.has_private_entrance,
    hasStorageRoom: input.has_storage_room,
    hasParking: input.has_parking,
    hasElevator: input.has_elevator,
  };
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
  const [override, setOverride] = useState<Partial<Property> | null>(null);
  const displayProperty: Property = override ? { ...property, ...override } : property;
  const [draft, setDraft] = useState<PropertyInput>(() => propertyToForm(property));

  function setField<K extends keyof PropertyInput>(key: K, value: PropertyInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function openEdit() {
    setDraft(propertyToForm(displayProperty));
    setEditing(true);
  }

  function save() {
    if (!draft.address.trim()) {
      toast.error("יש להזין כתובת.");
      return;
    }
    if (!draft.name.trim()) {
      toast.error("יש להזין שם לנכס.");
      return;
    }
    const snapshotDraft = draft;
    const patch = buildDetailsPatch(snapshotDraft);
    setEditing(false);
    scheduleDeferredAction({
      key: `property-details:${propertyId}`,
      message: "הנכס עודכן.",
      onApplyOptimistic: () => setOverride(patch),
      onRevert: () => setOverride(null),
      onCommit: async () => {
        const result = await updateProperty(propertyId, { ...propertyToForm(property), ...pick(snapshotDraft, BASIC_KEYS) });
        if (!result.ok) return { ok: false, error: result.error };
        invalidateQuickCreateCache();
        router.refresh();
        return { ok: true };
      },
    });
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
            <Button type="button" size="sm" onClick={save}>
              שמירה
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(propertyToForm(displayProperty));
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

  // A building has apartments, not a room count; a מחסן has neither — it is just
  // floor area. Everything else keeps showing rooms exactly as before (including
  // an unset type, unchanged behavior).
  const hasRoomLayout = propertyHasRoomLayout(displayProperty.propertyType);
  const facts = [
    displayProperty.propertyType === "building"
      ? displayProperty.apartmentsCount != null
        ? `${displayProperty.apartmentsCount} דירות`
        : null
      : hasRoomLayout && displayProperty.rooms != null
        ? `${displayProperty.rooms} חדרים`
        : null,
    displayProperty.floor != null ? `קומה ${displayProperty.floor}` : null,
    displayProperty.squareMeters != null ? `${displayProperty.squareMeters} מ״ר` : null,
    hasRoomLayout && displayProperty.bathrooms != null ? `${displayProperty.bathrooms} חדרי רחצה` : null,
    hasRoomLayout && displayProperty.mezuzahCount != null ? `${displayProperty.mezuzahCount} מזוזות` : null,
    displayProperty.lightBulbCount != null ? `${displayProperty.lightBulbCount} נורות` : null,
    displayProperty.keyCount != null ? `${displayProperty.keyCount} מפתחות` : null,
  ].filter(Boolean);
  const badges = [
    displayProperty.propertyType
      ? { label: propertyTypeLabel(displayProperty.propertyType), variant: "outline" as const }
      : null,
    !displayProperty.isActive ? { label: "לא פעיל", variant: "neutral" as const } : null,
    displayProperty.hasPrivateEntrance ? { label: "כניסה פרטית", variant: "outline" as const } : null,
    displayProperty.hasStorageRoom ? { label: "מחסן", variant: "outline" as const } : null,
    displayProperty.hasParking ? { label: "חניה", variant: "outline" as const } : null,
    displayProperty.hasElevator ? { label: "מעלית", variant: "outline" as const } : null,
    displayProperty.isFurnished ? { label: "מרוהט", variant: "outline" as const } : null,
  ].filter((b): b is { label: string; variant: "neutral" | "outline" } => Boolean(b));
  const hasDetails = Boolean(displayProperty.assetDescription) || facts.length > 0 || badges.length > 0;

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
            {displayProperty.assetDescription ? <p className="text-sm">{displayProperty.assetDescription}</p> : null}
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
