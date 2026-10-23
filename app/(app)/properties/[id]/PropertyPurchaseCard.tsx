"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AddIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/ui/icon-button";
import { DocumentRow } from "@/components/ui/document-tile";
import { MetaRow } from "@/components/ui/meta-row";
import { ExternalSiteLink } from "@/components/ui/external-site-link";
import { updateProperty } from "../actions";
import { PropertyPurchaseFields, propertyToForm, type PropertyInput } from "../PropertyFormFields";
import { formatCurrency } from "@/lib/payroll";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import type { Property, PropertyDocument } from "@/lib/properties";
import { scheduleDeferredAction } from "@/lib/undo-engine";
import { formatCurrencyAmount } from "@/lib/money";
import { isForeignCurrency, type CurrencyCode } from "@/lib/fx/currencies";
import { ALL_CURRENCIES, amountInEachCurrency } from "@/lib/fx/day-rates";
import { useRateTable } from "@/components/fx/useRateTable";
import { israelDateKey } from "@/lib/timezone";

const PURCHASE_KEYS = [
  "purchased_from",
  "purchase_date",
  "purchase_price",
  "purchase_tax",
  "land_block",
  "land_parcel",
  "land_sub_parcel",
  "land_registry_url",
  "land_title_url",
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

function buildPurchasePatch(input: PropertyInput): Partial<Property> {
  return {
    purchasedFrom: input.purchased_from.trim() || null,
    purchaseDate: input.purchase_date.trim() || null,
    purchasePrice: numOrNull(input.purchase_price),
    purchaseTax: numOrNull(input.purchase_tax),
    landBlock: input.land_block.trim() || null,
    landParcel: input.land_parcel.trim() || null,
    landSubParcel: input.land_sub_parcel.trim() || null,
    landRegistryUrl: input.land_registry_url.trim() || null,
    landTitleUrl: input.land_title_url.trim() || null,
  };
}

/**
 * A price in a property kept in US$ or C$: in its currency, and under it the
 * other two at the purchase day's rate (today's, with no purchase date) —
 * owner, 2026-10-23: "I need to see all three … how much did I pay there".
 */
function PriceInCurrency({ amount, currency, day }: { amount: number; currency: CurrencyCode; day: string | null }) {
  const foreign = isForeignCurrency(currency);
  const at = day ?? israelDateKey();
  const rates = useRateTable([at], foreign);
  if (!foreign) return <>{formatCurrency(amount)}</>;
  const each = amountInEachCurrency(amount, currency, at, rates);
  const others = ALL_CURRENCIES.filter((c) => c !== currency && each[c] !== null).map((c) =>
    formatCurrencyAmount(Math.round(each[c] ?? 0), c)
  );
  return (
    <>
      <span dir="ltr">{formatCurrencyAmount(amount, currency)}</span>
      {others.length > 0 ? (
        <span className="block text-xs text-muted-foreground">
          <span dir="ltr">≈ {others.join(" · ")}</span> {day ? "בשער יום הרכישה" : "בשער היום"}
        </span>
      ) : null}
    </>
  );
}

// Israel's calendar, not the device's (a date-only value through `new Date()`
// is UTC midnight — the previous day on a phone abroad).
function fmtDate(value: string | null) {
  return formatShortDate(value, "");
}

/** "רכישת הנכס" — seller/date/price/tax/land-registry, edited in place (no popup). */
export default function PropertyPurchaseCard({
  propertyId,
  property,
  documents,
  onAddDocument,
  onDeleteDocument,
}: {
  propertyId: string;
  property: Property;
  documents: PropertyDocument[];
  onAddDocument: () => void;
  onDeleteDocument: (id: string, label: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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
    const snapshotDraft = draft;
    const patch = buildPurchasePatch(snapshotDraft);
    setEditing(false);
    scheduleDeferredAction({
      key: `property-purchase:${propertyId}`,
      message: "הנכס עודכן.",
      onApplyOptimistic: () => setOverride(patch),
      onRevert: () => setOverride(null),
      onCommit: async () => {
        const result = await updateProperty(propertyId, { ...propertyToForm(property), ...pick(snapshotDraft, PURCHASE_KEYS) });
        if (!result.ok) return { ok: false, error: result.error };
        startTransition(() => { router.refresh(); });
        return { ok: true };
      },
    });
  }

  const hasPurchaseInfo = Boolean(
    displayProperty.purchasedFrom ||
      displayProperty.purchaseDate ||
      displayProperty.purchasePrice != null ||
      displayProperty.purchaseTax != null ||
      displayProperty.landBlock ||
      displayProperty.landParcel ||
      displayProperty.landSubParcel ||
      displayProperty.landRegistryUrl ||
      displayProperty.landTitleUrl
  );
  const registryLinks = [displayProperty.landRegistryUrl, displayProperty.landTitleUrl].filter(
    (url): url is string => Boolean(url)
  );

  return (
    <section className="space-y-2" aria-label="רכישת הנכס">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">רכישת הנכס</h3>
        {editing ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" onClick={onAddDocument}>
              <AddIcon className="h-4 w-4" />
              מסמך
            </Button>
            <EditButton onClick={openEdit} label="עריכת פרטי רכישה" />
          </div>
        )}
      </div>
      <div className="space-y-3">
        {editing ? (
          <>
            <PropertyPurchaseFields form={draft} set={setField} />
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
          </>
        ) : !hasPurchaseInfo ? (
          <p className="text-sm text-muted-foreground">לא הוזנו פרטי רכישה.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {displayProperty.purchasedFrom ? (
              <div>
                <span className="text-muted-foreground">נרכש מ-: </span>
                {displayProperty.purchasedFrom}
              </div>
            ) : null}
            {displayProperty.purchaseDate ? (
              <div>
                <span className="text-muted-foreground">תאריך רכישה: </span>
                {fmtDate(displayProperty.purchaseDate)}
              </div>
            ) : null}
            {displayProperty.purchasePrice != null ? (
              <div>
                <span className="text-muted-foreground">מחיר רכישה: </span>
                <PriceInCurrency
                  amount={displayProperty.purchasePrice}
                  currency={displayProperty.currency}
                  day={displayProperty.purchaseDate}
                />
              </div>
            ) : null}
            {displayProperty.purchaseTax != null ? (
              <div>
                <span className="text-muted-foreground">מס רכישה: </span>
                <PriceInCurrency
                  amount={displayProperty.purchaseTax}
                  currency={displayProperty.currency}
                  day={displayProperty.purchaseDate}
                />
              </div>
            ) : null}
            {displayProperty.landBlock || displayProperty.landParcel || displayProperty.landSubParcel ? (
              <div className="col-span-2">
                <span className="text-muted-foreground">גוש/חלקה/תת-חלקה: </span>
                {[displayProperty.landBlock, displayProperty.landParcel, displayProperty.landSubParcel]
                  .filter(Boolean)
                  .join(" / ")}
              </div>
            ) : null}
            {registryLinks.length > 0 ? (
              <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-muted-foreground">רישום המקרקעין: </span>
                {registryLinks.map((url) => (
                  <ExternalSiteLink key={url} url={url} />
                ))}
              </div>
            ) : null}
          </div>
        )}

        {!editing && documents.length > 0 ? (
          <div className="space-y-2 border-t pt-2">
            {/* The row opens the file; view and download at its end on hover, the
                delete in its quiet ⋮ (owner, 2026-10-12). */}
            {documents.map((d) => (
              <DocumentRow
                key={d.id}
                name={d.title || d.fileName || "מסמך"}
                fileName={d.fileName}
                url={d.url}
                meta={<MetaRow as="span" items={[d.documentType, formatShortDateTime(d.uploadedAt, "")]} fallback="—" />}
                onDelete={() => onDeleteDocument(d.id, d.title || "מסמך")}
                deleteLabel="מחיקת מסמך"
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
