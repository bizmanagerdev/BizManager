"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDateTime } from "@/lib/date";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Row = Record<string, unknown>;

type InventoryItem = {
  productId: string;
  productName: string;
  sku: string | null;
  quantityOnHand: number;
  quantityReserved: number;
  available: number;
};

type AdjustmentType =
  | "purchase_in"
  | "customer_return_in"
  | "return_supplier_out"
  | "damage_out"
  | "manual_in"
  | "manual_out";

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function productName(row: Row) {
  return (
    getString(row, "name") ??
    getString(row, "product_name") ??
    getString(row, "title") ??
    getString(row, "sku") ??
    "מוצר"
  );
}

function getAdjustmentMeta(adjustmentType: AdjustmentType) {
  switch (adjustmentType) {
    case "purchase_in":
      return { direction: "in" as const, label: "רכישה" };
    case "customer_return_in":
      return { direction: "in" as const, label: "החזרת לקוח" };
    case "return_supplier_out":
      return { direction: "out" as const, label: "החזרה לספק" };
    case "damage_out":
      return { direction: "out" as const, label: "נזק/פחת" };
    case "manual_out":
      return { direction: "out" as const, label: "התאמה ידנית" };
    case "manual_in":
    default:
      return { direction: "in" as const, label: "התאמה ידנית" };
  }
}

function formatMovementType(value: string | null) {
  switch ((value ?? "").toLowerCase()) {
    case "in":
      return "כניסה";
    case "out":
      return "יציאה";
    default:
      return value ?? "-";
  }
}

function formatSourceType(value: string | null) {
  switch ((value ?? "").toLowerCase()) {
    case "order":
      return "הזמנה";
    case "manual_adjustment":
      return "התאמת מלאי";
    case "manual_product":
      return "יצירת מוצר";
    default:
      return value ?? "-";
  }
}

function formatMovementNotes(value: string | null) {
  if (!value) return "-";

  const trimmed = value.trim();
  const updatedMatch = /^Sales order item ([a-f0-9-]+) updated$/i.exec(trimmed);
  if (updatedMatch) {
    return `פריט הזמנה ${updatedMatch[1]} עודכן`;
  }

  const orderItemMatch = /^Sales order item ([a-f0-9-]+)$/i.exec(trimmed);
  if (orderItemMatch) {
    return `פריט הזמנה ${orderItemMatch[1]}`;
  }

  return value;
}

function formatDateTime(value: string | null) {
  return formatShortDateTime(value);
}

export default function SalesInventoryClient({
  products,
  inventoryRows,
  movements,
}: {
  products: Row[];
  inventoryRows: Row[];
  movements: Row[];
}) {
  const [items, setItems] = useState<InventoryItem[]>(() => {
    const movementNetByProduct = new Map<string, number>();
    movements.forEach((row) => {
      const productId = getString(row, "product_id");
      if (!productId) return;
      const qty = getNumber(row, "quantity") ?? 0;
      if (!Number.isFinite(qty) || qty <= 0) return;
      const movementType = (getString(row, "movement_type") ?? "").toLowerCase();
      const signed = movementType === "out" ? -qty : qty;
      movementNetByProduct.set(productId, (movementNetByProduct.get(productId) ?? 0) + signed);
    });

    const productById = new Map<string, Row>();
    products.forEach((p) => {
      const id = getString(p, "id");
      if (id) productById.set(id, p);
    });

    const byProductId = new Map<string, InventoryItem>();

    productById.forEach((p, id) => {
      const productStockFallback =
        getNumber(p, "stock") ??
        getNumber(p, "quantity") ??
        getNumber(p, "available_quantity") ??
        getNumber(p, "in_stock") ??
        0;
      const movementFallback = movementNetByProduct.get(id) ?? 0;
      const quantityOnHand = productStockFallback !== 0 ? productStockFallback : movementFallback;

      byProductId.set(id, {
        productId: id,
        productName: productName(p),
        sku: getString(p, "sku"),
        quantityOnHand,
        quantityReserved: 0,
        available: quantityOnHand,
      });
    });

    inventoryRows.forEach((row) => {
      const productId = getString(row, "product_id");
      if (!productId) return;
      const p = productById.get(productId);
      const quantityOnHand = getNumber(row, "quantity_on_hand") ?? 0;
      const quantityReserved = getNumber(row, "quantity_reserved") ?? 0;
      byProductId.set(productId, {
        productId,
        productName: p ? productName(p) : productId,
        sku: p ? getString(p, "sku") : null,
        quantityOnHand,
        quantityReserved,
        available: quantityOnHand - quantityReserved,
      });
    });

    return Array.from(byProductId.values()).sort((a, b) =>
      a.productName.localeCompare(b.productName, "he")
    );
  });

  const [movementRows, setMovementRows] = useState<Row[]>(movements);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("purchase_in");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const quantityInputRef = useRef<HTMLInputElement | null>(null);

  const lowStockThreshold = 10;
  const lowStockItems = useMemo(
    () => items.filter((item) => item.available < lowStockThreshold),
    [items]
  );

  const productOptions = useMemo(
    () =>
      products
        .map((p) => {
          const id = getString(p, "id");
          if (!id) return null;
          return {
            id,
            label: productName(p),
            sku: getString(p, "sku"),
          };
        })
        .filter((x): x is { id: string; label: string; sku: string | null } => x !== null)
        .sort((a, b) => a.label.localeCompare(b.label, "he")),
    [products]
  );

  const productNameById = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((row) => {
      const id = getString(row, "id");
      if (id) map.set(id, productName(row));
    });
    return map;
  }, [products]);

  useEffect(() => {
    if (!adjustmentOpen) return;
    const timeout = setTimeout(() => quantityInputRef.current?.focus(), 120);
    return () => clearTimeout(timeout);
  }, [adjustmentOpen]);

  function resetAdjustmentForm(nextProductId = "") {
    setProductId(nextProductId);
    setAdjustmentType("purchase_in");
    setQuantity("");
    setNotes("");
    setError("");
  }

  function openAdjustmentDialog(nextProductId: string) {
    setSuccess("");
    resetAdjustmentForm(nextProductId);
    setAdjustmentOpen(true);
  }

  async function adjustInventory() {
    if (submitting) return;
    setError("");
    setSuccess("");

    const qty = Number(quantity);
    if (!productId) return setError("יש לבחור מוצר.");
    if (!Number.isFinite(qty) || qty <= 0) return setError("יש להזין כמות תקינה.");

    const adjustment = getAdjustmentMeta(adjustmentType);
    const finalNotes = notes.trim() || adjustment.label;

    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_id: productId,
          direction: adjustment.direction,
          quantity: qty,
          notes: finalNotes,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        movement?: Row;
        inventory?: Row;
      };
      if (!res.ok || !json.inventory) {
        setError(json.error ?? "עדכון מלאי נכשל.");
        return;
      }

      const nextOnHand = getNumber(json.inventory, "quantity_on_hand") ?? 0;
      const nextReserved = getNumber(json.inventory, "quantity_reserved") ?? 0;

      setItems((prev) => {
        const idx = prev.findIndex((i) => i.productId === productId);
        if (idx === -1) {
          const option = productOptions.find((p) => p.id === productId);
          const next: InventoryItem = {
            productId,
            productName: option?.label ?? productId,
            sku: option?.sku ?? null,
            quantityOnHand: nextOnHand,
            quantityReserved: nextReserved,
            available: nextOnHand - nextReserved,
          };
          return [...prev, next].sort((a, b) => a.productName.localeCompare(b.productName, "he"));
        }
        const copy = [...prev];
        copy[idx] = {
          ...copy[idx],
          quantityOnHand: nextOnHand,
          quantityReserved: nextReserved,
          available: nextOnHand - nextReserved,
        };
        return copy;
      });

      if (json.movement) {
        setMovementRows((prev) => [json.movement as Row, ...prev]);
      }

      setSuccess("התאמת מלאי בוצעה בהצלחה.");
      setAdjustmentOpen(false);
      resetAdjustmentForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {lowStockItems.length > 0 ? (
        <Card className="border-red-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">התראת מלאי נמוך (פחות מ-10)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {lowStockItems.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between rounded border border-red-200 bg-red-50 p-2"
              >
                <span>{item.productName}</span>
                <span className="font-medium text-red-700">{item.available}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">רמות מלאי לפי מוצר</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין מוצרים להצגה במלאי.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium">מוצר</th>
                    <th className="px-3 py-2 text-right font-medium">מק"ט</th>
                    <th className="px-3 py-2 text-right font-medium">במלאי</th>
                    <th className="px-3 py-2 text-right font-medium">שמור</th>
                    <th className="px-3 py-2 text-right font-medium">זמין</th>
                    <th className="px-3 py-2 text-right font-medium">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => {
                    const isLow = item.available < lowStockThreshold;
                    return (
                      <tr
                        key={item.productId}
                        className={isLow ? "bg-red-50/70 hover:bg-red-50" : "hover:bg-muted/30"}
                      >
                        <td className="px-3 py-2">{item.productName}</td>
                        <td className="px-3 py-2">{item.sku ?? "-"}</td>
                        <td className="px-3 py-2">{item.quantityOnHand}</td>
                        <td className="px-3 py-2">{item.quantityReserved}</td>
                        <td className={`px-3 py-2 font-medium ${isLow ? "text-red-700" : ""}`}>
                          {item.available}
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openAdjustmentDialog(item.productId)}
                          >
                            עדכון
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <Dialog
        open={adjustmentOpen}
        onOpenChange={(open) => {
          setAdjustmentOpen(open);
          if (!open && !submitting) {
            resetAdjustmentForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>עדכון רכישות / החזרות / התאמות</DialogTitle>
            <DialogDescription>בחירת מוצר, סוג פעולה, כמות והערות לעדכון המלאי.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium">מוצר</label>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">בחרו מוצר...</option>
                  {productOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.sku ? ` (${option.sku})` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">סוג פעולה</label>
                <select
                  value={adjustmentType}
                  onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="purchase_in">רכישה (הוספה למלאי)</option>
                  <option value="customer_return_in">החזרת לקוח (הוספה)</option>
                  <option value="return_supplier_out">החזרה לספק (הפחתה)</option>
                  <option value="damage_out">נזק / פחת (הפחתה)</option>
                  <option value="manual_in">התאמה ידנית (+)</option>
                  <option value="manual_out">התאמה ידנית (-)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">כמות</label>
                <Input
                  ref={quantityInputRef}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={submitting} onClick={() => setAdjustmentOpen(false)}>
                ביטול
              </Button>
              <Button type="button" disabled={submitting} onClick={() => void adjustInventory()}>
                {submitting ? "מעדכן..." : "ביצוע התאמה"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">תנועות מלאי</CardTitle>
        </CardHeader>
        <CardContent>
          {movementRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין תנועות מלאי להצגה.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-right font-medium">מוצר</th>
                    <th className="px-3 py-2 text-right font-medium">סוג תנועה</th>
                    <th className="px-3 py-2 text-right font-medium">כמות</th>
                    <th className="px-3 py-2 text-right font-medium">מקור</th>
                    <th className="px-3 py-2 text-right font-medium">תאריך</th>
                    <th className="px-3 py-2 text-right font-medium">הערות</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {movementRows.map((row, index) => {
                    const id = getString(row, "id") ?? `movement-${index}`;
                    const movementProductId = getString(row, "product_id");
                    return (
                      <tr key={id} className="hover:bg-muted/30">
                        <td className="px-3 py-2">
                          {(movementProductId && productNameById.get(movementProductId)) ?? movementProductId ?? "-"}
                        </td>
                        <td className="px-3 py-2">{formatMovementType(getString(row, "movement_type"))}</td>
                        <td className="px-3 py-2">{getNumber(row, "quantity") ?? "-"}</td>
                        <td className="px-3 py-2">{formatSourceType(getString(row, "source_type"))}</td>
                        <td className="px-3 py-2">{formatDateTime(getString(row, "created_at"))}</td>
                        <td className="px-3 py-2">{formatMovementNotes(getString(row, "notes"))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
