"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDateTime } from "@/lib/date";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMoreInventory } from "@/app/(app)/sales/actions";
import type { InventoryItem, ProductsFilters } from "@/app/(app)/sales/loadProducts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Row = Record<string, unknown>;

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
    case "reserve":
      return "שמירה";
    case "release":
      return "שחרור";
    case "adjustment":
      return "התאמה";
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
  initialItems,
  movements,
  initialHasMore = false,
  totalCount,
  initialQuery = "",
  initialCategoryFilter = "",
}: {
  initialItems: InventoryItem[];
  movements: Row[];
  initialHasMore?: boolean;
  totalCount?: number;
  initialQuery?: string;
  initialCategoryFilter?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(initialQuery);

  const lastPushedQueryRef = useRef(initialQuery);
  useEffect(() => {
    if (searchQuery === lastPushedQueryRef.current) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("inventoryPage");
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      else params.delete("q");
      const qs = params.toString();
      router.push(qs ? `/sales?${qs}` : "/sales", { scroll: false });
      lastPushedQueryRef.current = searchQuery;
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, router, searchParams]);

  // Fetch-from-DB-as-you-scroll: accumulate inventory pages and pull the next one
  // from the server when the bottom comes into view (no "next page" button).
  const fetchFilters = useMemo<ProductsFilters>(
    () => ({ q: initialQuery, category: initialCategoryFilter }),
    [initialQuery, initialCategoryFilter]
  );
  const fetchPage = useCallback((page: number) => loadMoreInventory(page, fetchFilters), [fetchFilters]);
  const getItemId = useCallback((item: InventoryItem) => item.productId, []);
  const {
    rows: items,
    setRows: setItems,
    hasMore,
    loading: loadingMore,
    sentinelRef: itemsSentinelRef,
    mobileSentinelRef: itemsMobileSentinelRef,
    scrollRef: itemsScrollRef,
  } = useInfiniteScroll<InventoryItem>({
    initialRows: initialItems,
    initialHasMore,
    fetchPage,
    getId: getItemId,
  });

  const [movementRows, setMovementRows] = useState<Row[]>(movements);
  // Keep the movements card in sync with the page's products when filters change.
  const [prevMovements, setPrevMovements] = useState<Row[]>(movements);
  if (movements !== prevMovements) {
    setPrevMovements(movements);
    setMovementRows(movements);
  }
  // Scroll-to-load instead of a "next page" button — reveal more rows as the
  // bottom of the list comes into view.
  const movementsReveal = useRevealOnScroll(movementRows, { initial: 20, step: 20 });
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("purchase_in");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const quantityInputRef = useRef<HTMLInputElement | null>(null);

  const lowStockItems = useMemo(
    () => items.filter((item) => item.active && item.available <= item.lowStockThreshold),
    [items]
  );

  const productOptions = useMemo(
    () =>
      items
        .map((item) => ({ id: item.productId, label: item.productName, sku: item.sku }))
        .sort((a, b) => a.label.localeCompare(b.label, "he")),
    [items]
  );

  const productNameById = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => map.set(item.productId, item.productName));
    return map;
  }, [items]);

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
        setError(toHebrewError(json.error, "עדכון מלאי נכשל."));
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
            lowStockThreshold: 5,
            active: true,
            quantityOnHand: nextOnHand,
            quantityReserved: nextReserved,
            available: nextOnHand - nextReserved,
            soldAmount: 0,
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
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {lowStockItems.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">התראת מלאי נמוך</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {lowStockItems.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between rounded border border-destructive/30 bg-destructive-soft p-2"
              >
                <div>
                  <div>{item.productName}</div>
                  <div className="text-xs text-destructive/80">{`סף: ${item.lowStockThreshold}`}</div>
                </div>
                <span className="font-medium text-destructive">{item.available}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">רמות מלאי לפי מוצר</CardTitle>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="חיפוש מוצר לפי שם או מק״ט"
              className="h-10 sm:max-w-xs"
            />
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין מוצרים להצגה במלאי.</p>
          ) : (
            <>
              <div ref={itemsScrollRef} className="hidden max-h-[70vh] overflow-auto rounded-md border xl:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">מוצר</th>
                      <th className="px-3 py-2 text-right font-medium">מק״ט</th>
                      <th className="px-3 py-2 text-right font-medium">במלאי</th>
                      <th className="px-3 py-2 text-right font-medium">שמור</th>
                      <th className="px-3 py-2 text-right font-medium">זמין</th>
                      <th className="px-3 py-2 text-right font-medium">נמכר</th>
                      <th className="px-3 py-2 text-right font-medium">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item) => {
                      const isLow = item.active && item.available <= item.lowStockThreshold;
                      return (
                        <tr
                          key={item.productId}
                          className={isLow ? "bg-destructive-soft/70 hover:bg-destructive-soft" : "hover:bg-muted/30"}
                        >
                          <td className="px-3 py-2">{item.productName}</td>
                          <td className="px-3 py-2">{item.sku ?? "-"}</td>
                          <td className="px-3 py-2">{item.quantityOnHand}</td>
                          <td className="px-3 py-2">{item.quantityReserved}</td>
                          <td className={`px-3 py-2 font-medium ${isLow ? "text-destructive" : ""}`}>
                            <span className="inline-flex items-center gap-1.5">
                              {item.available}
                              {item.available < 0 ? (
                                <span className="rounded border border-destructive/40 bg-destructive-soft px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                                  חוסר
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="px-3 py-2">{item.soldAmount}</td>
                          <td className="px-3 py-2">
                            <Button
                              type="button"
                              size="sm"
                              className="h-8 w-8 p-0"
                              title="עדכון מלאי"
                              aria-label="עדכון מלאי"
                              onClick={() => openAdjustmentDialog(item.productId)}
                            >
                              <PackagePlus className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {hasMore ? <div ref={itemsSentinelRef} className="h-1" /> : null}
              </div>

              <div className="grid grid-cols-1 gap-2 xl:hidden">
                {items.map((item) => {
                  const isLow = item.active && item.available <= item.lowStockThreshold;
                  return (
                    <div
                      key={item.productId}
                      className={`min-w-0 overflow-hidden rounded-lg border ${isLow ? "border-destructive/50 bg-destructive-soft/40" : "border-border/70 bg-background"} p-3 shadow-sm`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold leading-tight">{item.productName}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {item.sku ? `מק״ט: ${item.sku}` : ""}
                            {item.sku && isLow ? " • " : ""}
                            {isLow ? <span className="font-medium text-destructive">מלאי נמוך</span> : null}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 w-8 shrink-0 rounded-lg p-0"
                          title="עדכון מלאי"
                          aria-label="עדכון מלאי"
                          onClick={() => openAdjustmentDialog(item.productId)}
                        >
                          <PackagePlus className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                        <span className="text-muted-foreground">
                          במלאי: <span className="font-medium text-foreground">{item.quantityOnHand}</span>
                        </span>
                        <span className="text-muted-foreground">
                          שמור: <span className="font-medium text-foreground">{item.quantityReserved}</span>
                        </span>
                        <span className="text-muted-foreground">
                          זמין: <span className={`font-medium ${isLow ? "text-destructive" : "text-foreground"}`}>{item.available}</span>
                          {item.available < 0 ? (
                            <span className="ms-1 rounded border border-destructive/40 bg-destructive-soft px-1 py-0.5 text-[10px] font-medium text-destructive">
                              חוסר
                            </span>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground">
                          נמכר: <span className="font-medium text-foreground">{item.soldAmount}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {hasMore ? <div ref={itemsMobileSentinelRef} className="h-1 xl:hidden" /> : null}
              <div className="pt-3 text-center text-xs text-muted-foreground">
                {loadingMore
                  ? "טוען…"
                  : `מציג ${items.length}${totalCount != null ? ` מתוך ${totalCount}` : ""} פריטי מלאי`}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {success ? <p className="text-sm text-success-soft-foreground">{success}</p> : null}

      <Dialog
        open={adjustmentOpen}
        onOpenChange={(open) => {
          if (!open && submitting) return;
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

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={submitting} onClick={() => setAdjustmentOpen(false)}>
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
            (() => {
              const paginatedMovements = movementsReveal.visibleItems;
              return (
                <>
                  <div ref={movementsReveal.scrollRef} className="hidden max-h-[70vh] overflow-auto rounded-md border xl:block">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
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
                        {paginatedMovements.map((row, index) => {
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
                    {movementsReveal.hasMore ? <div ref={movementsReveal.sentinelRef} className="h-1" /> : null}
                  </div>

                  <div className="grid grid-cols-1 gap-2 xl:hidden">
                    {paginatedMovements.map((row, index) => {
                      const id = getString(row, "id") ?? `movement-${index}`;
                      const movementProductId = getString(row, "product_id");
                      const movementType = getString(row, "movement_type");
                      const quantity = getNumber(row, "quantity");
                      const notes = formatMovementNotes(getString(row, "notes"));
                      const isOut = (movementType ?? "").toLowerCase() === "out";
                      return (
                        <div key={id} className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold leading-tight">
                                {(movementProductId && productNameById.get(movementProductId)) ?? movementProductId ?? "-"}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {formatSourceType(getString(row, "source_type"))} • {formatDateTime(getString(row, "created_at"))}
                              </div>
                            </div>
                            <div className="shrink-0 text-left">
                              <div className="text-xs text-muted-foreground">{formatMovementType(movementType)}</div>
                              <div className={`text-sm font-semibold ${isOut ? "text-destructive" : "text-success-soft-foreground"}`}>
                                {isOut ? "-" : "+"}
                                {quantity ?? "-"}
                              </div>
                            </div>
                          </div>
                          {notes && notes !== "-" ? (
                            <div className="mt-1 truncate text-xs text-muted-foreground">{notes}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {movementsReveal.hasMore ? <div ref={movementsReveal.mobileSentinelRef} className="h-1 xl:hidden" /> : null}

                  <div className="mt-3 border-t pt-3 text-center text-xs text-muted-foreground">
                    מציג {movementsReveal.visibleCount} מתוך {movementsReveal.total} תנועות
                  </div>
                </>
              );
            })()
          )}
        </CardContent>
      </Card>
    </div>
  );
}
