"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { FormDialog } from "@/components/ui/form-dialog";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { AddressLink } from "@/components/ui/address-link";
import { BuildingIcon, WazeIcon } from "@/components/ui/icons";
import { structuredPoint } from "@/lib/address/columns";
import { invalidateQuickCreateCache } from "@/components/layout/QuickCreateMenu";
import { updateProperty } from "../actions";
import { PropertyBasicFields, propertyToForm, type PropertyInput } from "../PropertyFormFields";
import { propertyHasRoomLayout, propertyTypeLabel, type Property } from "@/lib/properties";
import { scheduleDeferredAction } from "@/lib/undo-engine";

const BASIC_KEYS = [
  "name",
  "address",
  "addr",
  "addr_not_found",
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
    addr: input.addr,
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
 * "נכס" — the first of the property page's three head cards, like the
 * project page's (owner, 2026-10-20): where it is (Waze), what it is (rooms,
 * floor, m²…, moved here from the list's card) and its amenities. Edited as
 * one form, opened from the heading's pencil.
 *
 * The draft holds a FULL PropertyInput (not just this card's fields) so it can
 * be handed straight to the shared `PropertyBasicFields`, but on save only
 * this card's own keys are taken from it — merged onto a FRESH
 * `propertyToForm(property)` snapshot, not the draft's own (possibly stale)
 * copy of the other cards' fields. That's what keeps the page's independent
 * editors from clobbering each other's already-saved edits.
 */
export default function PropertyDetailsCard({
  propertyId,
  property,
  editOpen,
  onEditOpenChange,
}: {
  propertyId: string;
  property: Property;
  editOpen: boolean;
  onEditOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [override, setOverride] = useState<Partial<Property> | null>(null);
  const displayProperty: Property = override ? { ...property, ...override } : property;
  const [draft, setDraft] = useState<PropertyInput>(() => propertyToForm(property));
  const [wasOpen, setWasOpen] = useState(false);
  // Each opening starts from what's saved now.
  if (editOpen !== wasOpen) {
    setWasOpen(editOpen);
    if (editOpen) setDraft(propertyToForm(displayProperty));
  }

  function setField<K extends keyof PropertyInput>(key: K, value: PropertyInput[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
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
    onEditOpenChange(false);
    scheduleDeferredAction({
      key: `property-details:${propertyId}`,
      message: "הנכס עודכן.",
      onApplyOptimistic: () => setOverride(patch),
      onRevert: () => setOverride(null),
      onCommit: async () => {
        const result = await updateProperty(propertyId, { ...propertyToForm(property), ...pick(snapshotDraft, BASIC_KEYS) });
        if (!result.ok) return { ok: false, error: result.error };
        invalidateQuickCreateCache();
        startTransition(() => { router.refresh(); });
        return { ok: true };
      },
    });
  }

  // A building has apartments, not a room count; a מחסן has neither — it is just
  // floor area.
  const p = displayProperty;
  const hasRoomLayout = propertyHasRoomLayout(p.propertyType);
  const details = [
    p.propertyType === "building" && p.apartmentsCount != null ? { label: "דירות", value: String(p.apartmentsCount) } : null,
    p.propertyType !== "building" && hasRoomLayout && p.rooms != null ? { label: "חדרים", value: String(p.rooms) } : null,
    p.floor != null ? { label: "קומה", value: String(p.floor) } : null,
    p.squareMeters != null ? { label: "שטח", value: `${p.squareMeters} מ״ר` } : null,
    hasRoomLayout && p.bathrooms != null ? { label: "חדרי רחצה", value: String(p.bathrooms) } : null,
    hasRoomLayout && p.mezuzahCount != null ? { label: "מזוזות", value: String(p.mezuzahCount) } : null,
    p.lightBulbCount != null ? { label: "נורות", value: String(p.lightBulbCount) } : null,
    p.keyCount != null ? { label: "מפתחות", value: String(p.keyCount) } : null,
  ].filter((d): d is { label: string; value: string } => Boolean(d));
  const amenities = [
    !p.isActive ? "לא פעיל" : null,
    p.hasPrivateEntrance ? "כניסה פרטית" : null,
    p.hasStorageRoom ? "מחסן" : null,
    p.hasParking ? "חניה" : null,
    p.hasElevator ? "מעלית" : null,
    p.isFurnished ? "מרוהט" : null,
  ].filter((label): label is string => Boolean(label));

  return (
    <>
      <StatActionCard
        icon={<BuildingIcon className="h-5 w-5" />}
        label={p.propertyType ? `נכס · ${propertyTypeLabel(p.propertyType)}` : "נכס"}
        value={
          // The Waze mark says "tapping this navigates", as every address in the app.
          <AddressLink
            address={p.address}
            pin={structuredPoint(p.addr)}
            notFound={p.addrNotFound}
            className="inline-flex min-w-0 items-center gap-1.5 text-base font-bold leading-snug hover:text-secondary"
          >
            <WazeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 break-words">{p.address || "אין כתובת"}</span>
          </AddressLink>
        }
        subtitles={[p.assetDescription]}
        details={details}
      >
        {amenities.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {amenities.map((label) => (
              <Badge key={label} variant={label === "לא פעיל" ? "neutral" : "outline"}>
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
      </StatActionCard>

      <FormDialog
        open={editOpen}
        onOpenChange={onEditOpenChange}
        title="עריכת פרטי הנכס"
        size="form2xl"
        onSubmit={save}
        submitLabel="שמירה"
      >
        <div className="mt-4 space-y-3">
          <PropertyBasicFields form={draft} set={setField} />
        </div>
      </FormDialog>
    </>
  );
}
