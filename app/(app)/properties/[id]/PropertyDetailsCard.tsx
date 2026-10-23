"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { FormDialog } from "@/components/ui/form-dialog";
import { StatActionCard } from "@/components/ui/stat-action-card";
import { AddressLink } from "@/components/ui/address-link";
import { ExternalSiteLink } from "@/components/ui/external-site-link";
import { BuildingIcon, CheckIcon, WazeIcon } from "@/components/ui/icons";
import { structuredPoint } from "@/lib/address/columns";
import { invalidateQuickCreateCache } from "@/components/layout/QuickCreateMenu";
import { updateProperty } from "../actions";
import { PropertyBasicFields, propertyToForm, type PropertyInput } from "../PropertyFormFields";
import { propertyDisplayName, propertyHasRoomLayout, propertyTypeLabel, type Property } from "@/lib/properties";
import { PropertyPhotoBanner } from "../PropertyPhotoTile";
import { PropertyDescription } from "./PropertyDescription";
import { scheduleDeferredAction } from "@/lib/undo-engine";
import { cn } from "@/lib/utils";
import { CURRENCY_NAME, CURRENCY_SYMBOL, isForeignCurrency } from "@/lib/fx/currencies";

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
  "rent_managed_by_company",
  "management_company_name",
  "management_portal_url",
  "management_notes",
  "zoning",
  "region",
  "tax_account_number",
  "tax_account_url",
  "currency",
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
    rentManagedByCompany: input.rent_managed_by_company,
    managementCompanyName: input.management_company_name.trim() || null,
    managementPortalUrl: input.management_portal_url.trim() || null,
    managementNotes: input.management_notes.trim() || null,
    zoning: input.zoning.trim() || null,
    region: input.region.trim() || null,
    taxAccountNumber: input.tax_account_number.trim() || null,
    taxAccountUrl: input.tax_account_url.trim() || null,
    currency: isForeignCurrency(input.currency) ? input.currency : "ILS",
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
/** The details two to a row — the last one alone with an empty cell beside it. */
function pairsOf<T>(items: T[]): Array<[T, T | null]> {
  const rows: Array<[T, T | null]> = [];
  for (let i = 0; i < items.length; i += 2) rows.push([items[i], items[i + 1] ?? null]);
  return rows;
}

export default function PropertyDetailsCard({
  propertyId,
  property,
  photoUrl,
  photoReady,
  onPhotoChanged,
  onPhotoDelete,
  editOpen,
  onEditOpenChange,
}: {
  propertyId: string;
  property: Property;
  /** Its newest צילום — at the card's foot, with the way to add one (owner, 2026-10-22). */
  photoUrl: string | null;
  /** Its files are in (the photo's link comes with them). */
  photoReady: boolean;
  onPhotoChanged: () => void;
  /** Its photo's ×: the page's delete, with its undo. */
  onPhotoDelete?: () => void;
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
  const facts: ({ label: string; value: ReactNode } | null)[] = [
    p.propertyType === "building" && p.apartmentsCount != null ? { label: "דירות", value: String(p.apartmentsCount) } : null,
    p.zoning ? { label: "ייעוד", value: p.zoning } : null,
    p.region ? { label: "מחוז", value: p.region } : null,
    isForeignCurrency(p.currency) ? { label: "מטבע", value: `${CURRENCY_NAME[p.currency]} (${CURRENCY_SYMBOL[p.currency]})` } : null,
    p.taxAccountNumber
      ? {
          label: "חשבון מס",
          // Its number opens the account online, when there's a link.
          value: p.taxAccountUrl ? <ExternalSiteLink url={p.taxAccountUrl} label={p.taxAccountNumber} /> : p.taxAccountNumber,
        }
      : null,
    p.propertyType !== "building" && hasRoomLayout && p.rooms != null ? { label: "חדרים", value: String(p.rooms) } : null,
    p.floor != null ? { label: "קומה", value: String(p.floor) } : null,
    p.squareMeters != null ? { label: "שטח", value: `${p.squareMeters} מ״ר` } : null,
    hasRoomLayout && p.bathrooms != null ? { label: "חדרי רחצה", value: String(p.bathrooms) } : null,
    hasRoomLayout && p.mezuzahCount != null ? { label: "מזוזות", value: String(p.mezuzahCount) } : null,
    p.lightBulbCount != null ? { label: "נורות", value: String(p.lightBulbCount) } : null,
    p.keyCount != null ? { label: "מפתחות", value: String(p.keyCount) } : null,
  ];
  const details = facts.filter((d): d is { label: string; value: ReactNode } => d !== null);
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
        subtitles={[p.assetDescription ? <PropertyDescription text={p.assetDescription} /> : null]}
      >
        {/* Its details as a ruled grid, two to a row, its photo beside them as tall as they are — the photo never
            adds height of its own (owner, 2026-10-22: "toooo tall"; "maybe we can design it better, more like
            this"). Then what it has, each a chip with its tick. */}
        <div className="flex items-stretch gap-3">
          <div className="min-w-0 flex-1 divide-y divide-border/50 text-sm">
            {pairsOf(details).map((row) => (
              <div key={row[0].label} className="grid grid-cols-2 divide-x divide-border/50">
                {row.map((d, i) =>
                  d ? (
                    <div key={d.label} className={cn("flex items-center justify-between gap-2 py-2", i === 0 ? "pe-3" : "ps-3")}>
                      <span className="text-xs text-muted-foreground">{d.label}</span>
                      <span className="font-semibold tabular-nums">{d.value}</span>
                    </div>
                  ) : (
                    <div key="empty" />
                  )
                )}
              </div>
            ))}
          </div>
          <PropertyPhotoBanner
            propertyId={propertyId}
            name={propertyDisplayName(p)}
            url={photoUrl}
            ready={photoReady}
            onChanged={onPhotoChanged}
            onDelete={onPhotoDelete}
          />
        </div>
        {amenities.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {amenities.map((label) =>
              label === "לא פעיל" ? (
                <Badge key={label} variant="neutral">
                  {label}
                </Badge>
              ) : (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
                >
                  <CheckIcon className="h-3 w-3 text-secondary" />
                  {label}
                </span>
              )
            )}
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
