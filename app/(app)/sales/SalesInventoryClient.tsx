"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AddProductIcon, DeleteIcon } from "@/components/ui/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDateTime } from "@/lib/date";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMoreInventory } from "@/app/(app)/sales/actions";
import type { InventoryItem, ProductsFilters } from "@/app/(app)/sales/loadProducts";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { EditButton } from "@/components/ui/icon-button";

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

// Best-guess the adjustment subtype of an existing manual movement from its
// direction + note, so the edit dialog opens on the right option.
function inferAdjustmentType(movementType: string | null, notes: string | null): AdjustmentType {
  const dir = (movementType ?? "").toLowerCase() === "out" ? "out" : "in";
  const n = notes ?? "";
  if (/החזרת לקוח|customer return/i.test(n)) return "customer_return_in";
  if (/רכישה|purchase/i.test(n)) return "purchase_in";
  if (/החזרה לספק|supplier/i.test(n)) return "return_supplier_out";
  if (/נזק|פחת|damage/i.test(n)) return "damage_out";
  return dir === "out" ? "manual_out" : "manual_in";
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

function formatDateTime(value: string | null) {
  return formatShortDateTime(value);
}

export default function SalesInventoryClient({
  initialItems,
  movements,
  orderCustomerById = {},
  performerNameById = {},
  initialHasMore = false,
  totalCount,
  initialQuery = "",
  initialCategoryFilter = "",
}: {
  initialItems: InventoryItem[];
  movements: Row[];
  orderCustomerById?: Record<string, string>;
  performerNameById?: Record<string, string>;
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
  // Movements table filters (client-side over the loaded set).
  const [movProduct, setMovProduct] = useState("");
  const [movType, setMovType] = useState("");
  const [movSource, setMovSource] = useState("");
  const filteredMovements = useMemo(() => {
    return movementRows.filter((row) => {
      if (movProduct && getString(row, "product_id") !== movProduct) return false;
      if (movType && (getString(row, "movement_type") ?? "").toLowerCase() !== movType) return false;
      if (movSource && getString(row, "source_type") !== movSource) return false;
      return true;
    });
  }, [movementRows, movProduct, movType, movSource]);
  const movementsFiltered = movProduct !== "" || movType !== "" || movSource !== "";

  // Scroll-to-load instead of a "next page" button — reveal more rows as the
  // bottom of the list comes into view.
  const movementsReveal = useRevealOnScroll(filteredMovements, { initial: 20, step: 20 });
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  // Editing an existing manual movement row.
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState("");
  const [editProductId, setEditProductId] = useState("");
  const [editType, setEditType] = useState<AdjustmentType>("manual_in");
  const [editQty, setEditQty] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");
  // Deleting a manual movement row (confirmed).
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
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

  function openEditDialog(row: Row) {
    setEditError("");
    setEditId(getString(row, "id") ?? "");
    setEditProductId(getString(row, "product_id") ?? "");
    setEditType(inferAdjustmentType(getString(row, "movement_type"), getString(row, "notes")));
    const qty = getNumber(row, "quantity");
    setEditQty(qty != null ? String(qty) : "");
    setEditNotes(getString(row, "notes") ?? "");
    setEditOpen(true);
  }

  // Changing the type relabels the note too — otherwise the note (which is what
  // the "sold"/returns math keys off) would still read e.g. "החזרת לקוח" and the
  // fix wouldn't take. A genuinely custom note is preserved.
  function changeEditType(next: AdjustmentType) {
    const knownLabels = new Set(["רכישה", "החזרת לקוח", "החזרה לספק", "נזק/פחת", "התאמה ידנית"]);
    setEditType(next);
    setEditNotes((cur) => {
      const trimmed = cur.trim();
      return trimmed === "" || knownLabels.has(trimmed) ? getAdjustmentMeta(next).label : cur;
    });
  }

  async function saveMovementEdit() {
    if (editSubmitting) return;
    setEditError("");

    const qty = Number(editQty);
    if (!editId) return setEditError("חסר מזהה תנועה.");
    if (!Number.isFinite(qty) || qty <= 0) return setEditError("יש להזין כמות תקינה.");

    const meta = getAdjustmentMeta(editType);
    const finalNotes = editNotes.trim() || meta.label;

    setEditSubmitting(true);
    try {
      const res = await fetch("/api/inventory/movements/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editId,
          direction: meta.direction,
          quantity: qty,
          notes: finalNotes,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        movement?: Row;
        inventory?: Row | null;
      };
      if (!res.ok || !json.movement) {
        setEditError(toHebrewError(json.error, "עדכון התנועה נכשל."));
        return;
      }

      // Optimistically swap the edited row in place.
      setMovementRows((prev) =>
        prev.map((r) => (getString(r, "id") === editId ? (json.movement as Row) : r))
      );
      // Reflect the re-synced on-hand / reserved immediately.
      if (json.inventory) {
        const onHand = getNumber(json.inventory, "quantity_on_hand") ?? 0;
        const reserved = getNumber(json.inventory, "quantity_reserved") ?? 0;
        setItems((prev) =>
          prev.map((i) =>
            i.productId === editProductId
              ? { ...i, quantityOnHand: onHand, quantityReserved: reserved, available: onHand - reserved }
              : i
          )
        );
      }

      setEditOpen(false);
      setSuccess("תנועת המלאי עודכנה.");
      // Recompute the server-derived "נמכר" column (sold − returns) for the fix.
      router.refresh();
    } catch (e: unknown) {
      setEditError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setEditSubmitting(false);
    }
  }

  // Human-readable "מקור/הערות" for a movement row: order rows link to the order
  // and name the customer; manual rows show the reason + who performed it.
  function renderMovementInfo(row: Row) {
    const sourceType = getString(row, "source_type");
    const note = (getString(row, "notes") ?? "").trim();

    if (sourceType === "order") {
      const orderId = getString(row, "source_id");
      const customer = orderId ? orderCustomerById[orderId] : null;
      const updated = /updated$|עודכן$/.test(note);
      const inner = (
        <span className="inline-flex items-center gap-1">
          {customer || "הזמנה"}
          {updated ? <span className="text-[10px] text-muted-foreground">· עודכן</span> : null}
        </span>
      );
      return orderId ? (
        <Link href={`/sales/orders/${orderId}`} className="text-primary hover:underline">
          {inner}
        </Link>
      ) : (
        inner
      );
    }

    if (sourceType === "manual_product") {
      return /initial/i.test(note) ? "מלאי פתיחה" : note || "יצירת מוצר";
    }

    // manual_adjustment / anything else
    const performer = getString(row, "performed_by");
    const who = performer ? performerNameById[performer] : null;
    return (
      <span>
        {note || "-"}
        {who ? <span className="text-muted-foreground">{` · ע״י ${who}`}</span> : null}
      </span>
    );
  }

  async function confirmDeleteMovement() {
    if (deleteSubmitting || !deleteRow) return;
    const id = getString(deleteRow, "id") ?? "";
    const movementProductId = getString(deleteRow, "product_id") ?? "";
    if (!id) {
      setDeleteRow(null);
      return;
    }

    setDeleteSubmitting(true);
    try {
      const res = await fetch("/api/inventory/movements/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
        inventory?: Row | null;
      };
      if (!res.ok || !json.success) {
        setError(toHebrewError(json.error, "מחיקת התנועה נכשלה."));
        return;
      }

      setMovementRows((prev) => prev.filter((r) => getString(r, "id") !== id));
      if (json.inventory) {
        const onHand = getNumber(json.inventory, "quantity_on_hand") ?? 0;
        const reserved = getNumber(json.inventory, "quantity_reserved") ?? 0;
        setItems((prev) =>
          prev.map((i) =>
            i.productId === movementProductId
              ? { ...i, quantityOnHand: onHand, quantityReserved: reserved, available: onHand - reserved }
              : i
          )
        );
      }

      setDeleteRow(null);
      setSuccess("תנועת המלאי נמחקה.");
      router.refresh();
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setDeleteSubmitting(false);
    }
  }

  // Names the page in the mobile top bar.
  useSetPageTitle("מלאי", `${totalCount ?? initialItems.length} מוצרים`);
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
                          // Lets /inventory?focus=<productId> land on this row.
                          data-focus-id={item.productId}
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
                              <AddProductIcon className="h-4 w-4" />
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
                      data-focus-id={item.productId}
                      className={`min-w-0 overflow-hidden rounded-lg border ${isLow ? "border-destructive/50 bg-destructive-soft/40" : "border-border/70 bg-background"} p-3 shadow-sm`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold leading-snug">{item.productName}</div>
                          <div className="text-xs text-muted-foreground">
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
                          <AddProductIcon className="h-4 w-4" />
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

      <FormDialog
        open={adjustmentOpen}
        onOpenChange={(open) => {
          setAdjustmentOpen(open);
          if (!open) resetAdjustmentForm();
        }}
        title="עדכון רכישות / החזרות / התאמות"
        description="בחירת מוצר, סוג פעולה, כמות והערות לעדכון המלאי."
        size="form2xl"
        onSubmit={() => void adjustInventory()}
        submitLabel="ביצוע התאמה"
        busyLabel="מעדכן..."
        busy={submitting}
        error={error || undefined}
      >
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-sm font-medium">מוצר</label>
                <NativeSelect
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">בחרו מוצר...</option>
                  {productOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.sku ? ` (${option.sku})` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">סוג פעולה</label>
                <NativeSelect
                  value={adjustmentType}
                  onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                >
                  <option value="purchase_in">רכישה (הוספה למלאי)</option>
                  <option value="customer_return_in">החזרת לקוח (הוספה)</option>
                  <option value="return_supplier_out">החזרה לספק (הפחתה)</option>
                  <option value="damage_out">נזק / פחת (הפחתה)</option>
                  <option value="manual_in">התאמה ידנית (+)</option>
                  <option value="manual_out">התאמה ידנית (-)</option>
                </NativeSelect>
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

          </div>
      </FormDialog>

      <FormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="עריכת תנועת מלאי"
        description={`${(editProductId && productNameById.get(editProductId)) || "מוצר"} · עדכון סוג, כמות והערה. שינוי הכמות או הכיוון יעדכן את המלאי בהתאם.`}
        size="formXl"
        onSubmit={() => void saveMovementEdit()}
        submitLabel="שמירת שינויים"
        busyLabel="שומר..."
        busy={editSubmitting}
        error={editError || undefined}
      >
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">סוג פעולה</label>
                <NativeSelect
                  value={editType}
                  onChange={(e) => changeEditType(e.target.value as AdjustmentType)}
                >
                  <option value="purchase_in">רכישה (הוספה למלאי)</option>
                  <option value="customer_return_in">החזרת לקוח (הוספה)</option>
                  <option value="return_supplier_out">החזרה לספק (הפחתה)</option>
                  <option value="damage_out">נזק / פחת (הפחתה)</option>
                  <option value="manual_in">התאמה ידנית (+)</option>
                  <option value="manual_out">התאמה ידנית (-)</option>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">כמות</label>
                <Input
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} />
            </div>

          </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteRow !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteRow(null);
        }}
        title="מחיקת תנועת מלאי"
        description={
          deleteRow
            ? `${(getString(deleteRow, "product_id") && productNameById.get(getString(deleteRow, "product_id")!)) || "מוצר"} · ${formatMovementType(getString(deleteRow, "movement_type"))} ${getNumber(deleteRow, "quantity") ?? ""}. המלאי יעודכן בהתאם. לא ניתן לבטל פעולה זו.`
            : ""
        }
        confirmLabel="מחיקה"
        destructive
        loading={deleteSubmitting}
        onConfirm={() => void confirmDeleteMovement()}
      />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2">
            <CardTitle className="text-base">תנועות מלאי</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect dense
                value={movProduct}
                onChange={(e) => setMovProduct(e.target.value)}
              >
                <option value="">כל המוצרים</option>
                {productOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect dense
                value={movType}
                onChange={(e) => setMovType(e.target.value)}
              >
                <option value="">כל הסוגים</option>
                <option value="in">כניסה</option>
                <option value="out">יציאה</option>
                <option value="reserve">שמירה</option>
                <option value="release">שחרור</option>
                <option value="adjustment">התאמה</option>
              </NativeSelect>
              <NativeSelect dense
                value={movSource}
                onChange={(e) => setMovSource(e.target.value)}
              >
                <option value="">כל המקורות</option>
                <option value="order">הזמנה</option>
                <option value="manual_adjustment">התאמת מלאי</option>
                <option value="manual_product">יצירת מוצר</option>
              </NativeSelect>
              {movementsFiltered ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-9"
                  onClick={() => {
                    setMovProduct("");
                    setMovType("");
                    setMovSource("");
                  }}
                >
                  ניקוי סינון
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {movementRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין תנועות מלאי להצגה.</p>
          ) : filteredMovements.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין תנועות התואמות את הסינון.</p>
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
                          <th className="px-3 py-2 text-right font-medium">פעולות</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {paginatedMovements.map((row, index) => {
                          const id = getString(row, "id") ?? `movement-${index}`;
                          const movementProductId = getString(row, "product_id");
                          const isManual = getString(row, "source_type") === "manual_adjustment";
                          return (
                            <tr key={id} className="hover:bg-muted/30">
                              <td className="px-3 py-2">
                                {(movementProductId && productNameById.get(movementProductId)) ?? movementProductId ?? "-"}
                              </td>
                              <td className="px-3 py-2">{formatMovementType(getString(row, "movement_type"))}</td>
                              <td className="px-3 py-2">{getNumber(row, "quantity") ?? "-"}</td>
                              <td className="px-3 py-2">{formatSourceType(getString(row, "source_type"))}</td>
                              <td className="px-3 py-2">{formatDateTime(getString(row, "created_at"))}</td>
                              <td className="px-3 py-2">{renderMovementInfo(row)}</td>
                              <td className="px-3 py-2">
                                {isManual ? (
                                  <div className="-my-1.5 flex items-center gap-1.5">
                                    <EditButton onClick={() => openEditDialog(row)} label="עריכת תנועה" />
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="destructive"
                                      className="h-7 w-7 p-0"
                                      title="מחיקת תנועה"
                                      aria-label="מחיקת תנועה"
                                      onClick={() => setDeleteRow(row)}
                                    >
                                      <DeleteIcon className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                ) : null}
                              </td>
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
                      const isOut = (movementType ?? "").toLowerCase() === "out";
                      const isManual = getString(row, "source_type") === "manual_adjustment";
                      return (
                        <div key={id} className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-background p-3 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold leading-tight">
                                {(movementProductId && productNameById.get(movementProductId)) ?? movementProductId ?? "-"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatSourceType(getString(row, "source_type"))} • {formatDateTime(getString(row, "created_at"))}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-start gap-2">
                              <div className="text-left">
                                <div className="text-xs text-muted-foreground">{formatMovementType(movementType)}</div>
                                <div className={`text-sm font-semibold ${isOut ? "text-destructive" : "text-success-soft-foreground"}`}>
                                  {isOut ? "-" : "+"}
                                  {quantity ?? "-"}
                                </div>
                              </div>
                              {isManual ? (
                                <>
                                  <EditButton onClick={() => openEditDialog(row)} label="עריכת תנועה" />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    className="h-8 w-8 shrink-0 p-0"
                                    title="מחיקת תנועה"
                                    aria-label="מחיקת תנועה"
                                    onClick={() => setDeleteRow(row)}
                                  >
                                    <DeleteIcon className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{renderMovementInfo(row)}</div>
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
