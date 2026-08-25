"use client";

import { cloneElement, useCallback, useMemo, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { ViewDialog } from "@/components/ui/view-dialog";
import { SpinnerIcon, WarehouseIcon } from "@/components/ui/icons";
import { toHebrewError } from "@/lib/error-messages";
import { loadPickingList } from "@/app/(app)/sales/actions";
import type { PickingListDelivery } from "@/app/(app)/sales/loadPickingList";

type AggregatedProduct = {
  key: string;
  name: string;
  sku: string | null;
  quantity: number;
  orderCount: number;
};

function aggregate(deliveries: PickingListDelivery[]): AggregatedProduct[] {
  const byKey = new Map<string, AggregatedProduct>();
  for (const delivery of deliveries) {
    for (const item of delivery.items) {
      const existing = byKey.get(item.key);
      if (existing) {
        existing.quantity += item.remaining;
        existing.orderCount += 1;
      } else {
        byKey.set(item.key, { key: item.key, name: item.name, sku: item.sku, quantity: item.remaining, orderCount: 1 });
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name, "he"));
}

/**
 * "רשימת ליקוט למחסן" — pick a city (or a few, or none at all for everything)
 * and see how much of each product still needs to come out of storage for the
 * open deliveries there. Self-contained: owns its own trigger, dialog, fetch
 * and filter state, so dropping it into a page is a one-line addition.
 *
 * `trigger` swaps in a caller-supplied element as the click target instead of
 * the default button — e.g. the dashboard card's icon-only header action.
 * It's cloned with an onClick that opens the dialog, so a plain host element
 * (a `<button>`, no handlers of its own) authored by a *server* component can
 * still open this client dialog without ever passing a function across the
 * boundary.
 */
export default function PickingListDialog({
  trigger,
}: {
  trigger?: ReactElement<{ onClick?: () => void }>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<PickingListDelivery[] | null>(null);
  const [selectedCities, setSelectedCities] = useState<Set<string> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await loadPickingList();
      setSource(rows);
    } catch (err) {
      setError(toHebrewError(err, "טעינת רשימת הליקוט נכשלה."));
    } finally {
      setLoading(false);
    }
  }, []);

  const openDialog = useCallback(() => {
    setOpen(true);
    setSelectedCities(null);
    if (!loading) void fetchData();
  }, [fetchData, loading]);

  const cityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const delivery of source ?? []) {
      counts.set(delivery.city, (counts.get(delivery.city) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b, "he"));
  }, [source]);

  const filteredDeliveries = useMemo(() => {
    if (!source) return [];
    if (!selectedCities) return source;
    return source.filter((delivery) => selectedCities.has(delivery.city));
  }, [source, selectedCities]);

  const products = useMemo(() => aggregate(filteredDeliveries), [filteredDeliveries]);

  const toggleCity = (city: string) => {
    setSelectedCities((prev) => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      if (next.has(city)) next.delete(city);
      else next.add(city);
      // Emptying the set (or ticking every city back on) reads better as "all"
      // than as a zero-result filter.
      if (next.size === 0 || next.size === cityCounts.length) return null;
      return next;
    });
  };

  return (
    <>
      {trigger ? (
        cloneElement(trigger, { onClick: openDialog })
      ) : (
        <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={openDialog}>
          <WarehouseIcon className="h-4 w-4" />
          <span>רשימת ליקוט</span>
        </Button>
      )}

      <ViewDialog
        open={open}
        onOpenChange={setOpen}
        title="רשימת ליקוט למחסן"
        description="כמה מכל מוצר לאסוף מהמחסן, לפי הערים שנבחרו"
        size="formXl"
        headerBelow={
          cityCounts.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedCities(null)}
                className={[
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  selectedCities === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
              >
                כל הערים
              </button>
              {cityCounts.map(([city, count]) => {
                const active = selectedCities !== null && selectedCities.has(city);
                return (
                  <button
                    key={city}
                    type="button"
                    onClick={() => toggleCity(city)}
                    className={[
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    {city} ({count})
                  </button>
                );
              })}
            </div>
          ) : undefined
        }
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <SpinnerIcon className="h-4 w-4 animate-spin" />
            <span>טוען…</span>
          </div>
        ) : error ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void fetchData()}>
              נסה שוב
            </Button>
          </div>
        ) : !source || source.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">אין כרגע משלוחים פתוחים.</p>
        ) : products.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            אין פריטים לליקוט עבור הערים שנבחרו.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {products.length} מוצרים · {filteredDeliveries.length} הזמנות פתוחות
              {selectedCities ? ` · ${selectedCities.size} ערים נבחרו` : ""}
            </p>
            <ul className="divide-y divide-border/70">
              {products.map((product) => (
                <li key={product.key} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{product.name}</div>
                    {product.sku ? (
                      <div className="text-xs text-muted-foreground">{product.sku}</div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-end">
                    <div className="text-base font-bold tabular-nums">{product.quantity}</div>
                    <div className="text-xs text-muted-foreground">
                      ב-{product.orderCount} הזמנות
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ViewDialog>
    </>
  );
}
