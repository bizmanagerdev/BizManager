"use client";

import { useEffect, useState } from "react";
import { DEFAULT_VAT_RATE } from "@/lib/settings/vat";
import { baseFromPriceEntry, projectPriceSplit, type ProjectPriceEntry } from "@/lib/projects/vat";
import { formatCurrency } from "@/lib/payroll";
import { SEGMENT, SEGMENTED_GROUP, TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import { cn } from "@/lib/utils";

// A project priced "base + VAT" stores the BASE, but the agreed figure is often
// the full sum the customer pays. This says which one was typed and shows the
// split it becomes, so nobody divides by 1.18 on a calculator.

let cachedRate: number | null = null;
let inflight: Promise<number> | null = null;

/** The business VAT rate, read once per page load; the default until it lands. */
export function useVatRate(frozenRate?: number | null): number {
  // A project that already froze its own rate keeps it — its target must not
  // move when the business rate changes.
  const frozen = typeof frozenRate === "number" && frozenRate >= 0 ? frozenRate : null;
  const [fetched, setFetched] = useState<number | null>(cachedRate);

  useEffect(() => {
    if (frozen !== null || cachedRate !== null) return;
    let active = true;
    inflight =
      inflight ??
      fetch("/api/settings/vat")
        .then((res) => (res.ok ? res.json() : null))
        .then((json: { vat_rate?: number } | null) => {
          const value = typeof json?.vat_rate === "number" ? json.vat_rate : DEFAULT_VAT_RATE;
          cachedRate = value;
          return value;
        })
        .catch(() => DEFAULT_VAT_RATE)
        .finally(() => {
          inflight = null;
        });
    void inflight.then((value) => {
      if (active) setFetched(value);
    });
    return () => {
      active = false;
    };
  }, [frozen]);

  return frozen ?? fetched ?? DEFAULT_VAT_RATE;
}

export function PriceVatEntry({
  amount,
  entry,
  onEntryChange,
  rate,
  disabled,
}: {
  /** The number as typed in the price field. */
  amount: string;
  entry: ProjectPriceEntry;
  onEntryChange: (entry: ProjectPriceEntry) => void;
  rate: number;
  disabled?: boolean;
}) {
  const typed = Number(amount);
  const split = projectPriceSplit(baseFromPriceEntry(typed, entry, rate), rate);
  const percent = Math.round(rate * 1000) / 10;

  return (
    <div className="space-y-1.5">
      {/* The app's one "this | that" control (owner, 2026-10-11: "all the
          toggles should be blue"): the chosen half is the blue fill. It was a white
          tab on a sky tray. Full width here, a little tighter than the
          default segment. */}
      <div className={cn(SEGMENTED_GROUP, "flex gap-1")}>
        {([
          { value: "base" as const, label: "הסכום לפני מע״מ" },
          { value: "gross" as const, label: "הסכום כולל מע״מ" },
        ]).map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={entry === option.value}
            onClick={() => onEntryChange(option.value)}
            className={cn(
              SEGMENT,
              "flex-1 px-3 py-1.5 disabled:opacity-50",
              entry === option.value ? TOGGLE_ON : TOGGLE_OFF
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {split.base > 0 ? (
        <div className="text-xs text-muted-foreground">
          בסיס {formatCurrency(split.base)} + מע״מ {percent}% {formatCurrency(split.vat)} = {formatCurrency(split.gross)}
        </div>
      ) : null}
    </div>
  );
}
