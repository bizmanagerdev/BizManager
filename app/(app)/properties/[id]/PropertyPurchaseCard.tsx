"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AddIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { updateProperty } from "../actions";
import { PropertyPurchaseFields, propertyToForm, type PropertyInput } from "../PropertyFormFields";
import { formatCurrency } from "@/lib/payroll";
import type { Property, PropertyDocument } from "@/lib/properties";

const PURCHASE_KEYS = [
  "purchased_from",
  "purchase_date",
  "purchase_price",
  "purchase_tax",
  "land_block",
  "land_parcel",
  "land_sub_parcel",
] as const satisfies readonly (keyof PropertyInput)[];

function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

function fmtDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
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
      const result = await updateProperty(propertyId, { ...propertyToForm(property), ...pick(draft, PURCHASE_KEYS) });
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

  const hasPurchaseInfo = Boolean(
    property.purchasedFrom ||
      property.purchaseDate ||
      property.purchasePrice != null ||
      property.purchaseTax != null ||
      property.landBlock ||
      property.landParcel ||
      property.landSubParcel
  );

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">רכישת הנכס</CardTitle>
        {editing ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="secondary" onClick={onAddDocument}>
              <AddIcon className="h-4 w-4" />
              מסמך
            </Button>
            <EditButton onClick={openEdit} label="עריכת פרטי רכישה" />
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <>
            <PropertyPurchaseFields form={draft} set={setField} />
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
          </>
        ) : !hasPurchaseInfo ? (
          <p className="text-sm text-muted-foreground">לא הוזנו פרטי רכישה.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {property.purchasedFrom ? (
              <div>
                <span className="text-muted-foreground">נרכש מ-: </span>
                {property.purchasedFrom}
              </div>
            ) : null}
            {property.purchaseDate ? (
              <div>
                <span className="text-muted-foreground">תאריך רכישה: </span>
                {fmtDate(property.purchaseDate)}
              </div>
            ) : null}
            {property.purchasePrice != null ? (
              <div>
                <span className="text-muted-foreground">מחיר רכישה: </span>
                {formatCurrency(property.purchasePrice)}
              </div>
            ) : null}
            {property.purchaseTax != null ? (
              <div>
                <span className="text-muted-foreground">מס רכישה: </span>
                {formatCurrency(property.purchaseTax)}
              </div>
            ) : null}
            {property.landBlock || property.landParcel || property.landSubParcel ? (
              <div className="col-span-2">
                <span className="text-muted-foreground">גוש/חלקה/תת-חלקה: </span>
                {[property.landBlock, property.landParcel, property.landSubParcel].filter(Boolean).join(" / ")}
              </div>
            ) : null}
          </div>
        )}

        {!editing && documents.length > 0 ? (
          <div className="space-y-2 border-t pt-2">
            {documents.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                <div className="min-w-0 text-sm">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="truncate font-medium text-primary hover:underline">
                      {d.title || d.fileName || "מסמך"}
                    </a>
                  ) : (
                    <div className="truncate font-medium">{d.title || d.fileName || "מסמך"}</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {[d.documentType, fmtDate(d.uploadedAt)].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <DeleteButton onClick={() => onDeleteDocument(d.id, d.title || "מסמך")} label="מחיקת מסמך" />
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
