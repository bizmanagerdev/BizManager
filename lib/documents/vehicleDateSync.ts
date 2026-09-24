"use client";

import { toast } from "sonner";
import { setVehicleExpiryDate } from "@/app/(app)/vehicles/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatShortDate } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";

// ────────────────────────────────────────────────────────────────────────────
// "The policy says 2027 — should the car say 2027 too?"
//
// A vehicle keeps its own insurance and licence dates, and a document uploaded
// against that vehicle carries the same fact. The two drifted apart silently:
// you would file a new policy and the car's record would still be showing last
// year's date, still counting down to an expiry that had already been renewed.
//
// This ASKS. It never writes on its own — the document might be a quote, or the
// wrong car's, or last year's rescanned, and a date on a vehicle is what the
// alerts and the fleet list are built on.
// ────────────────────────────────────────────────────────────────────────────

/** Which of a vehicle's dates a document category speaks for. */
const VEHICLE_DATE_BY_CATEGORY: Record<string, { kind: "insurance" | "license"; noun: string }> = {
  "ביטוח": { kind: "insurance", noun: "הביטוח" },
  "תעודה/רישיון": { kind: "license", noun: "הרישיון" },
};

export function categorySpeaksForVehicleDate(category: string | null | undefined): boolean {
  return Boolean(VEHICLE_DATE_BY_CATEGORY[(category ?? "").trim()]);
}

export async function offerVehicleDateSync(input: {
  category: string | null;
  vehicleTagId: string;
  /** Looked up from the tag when the caller does not have it (the upload
   *  wizard holds tag IDS, not their names). */
  vehicleLabel?: string;
  /** yyyy-mm-dd, as stored on the document. */
  date: string;
  onUpdated?: () => void;
}): Promise<void> {
  const mapping = VEHICLE_DATE_BY_CATEGORY[(input.category ?? "").trim()];
  if (!mapping || !input.vehicleTagId || !input.date) return;

  try {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("vehicles")
      .select("insurance_due_date,license_due_date,tag:tags(name)")
      .eq("tag_id", input.vehicleTagId)
      .maybeSingle();
    if (error || !data) return;

    const row = data as Record<string, unknown>;
    // A tag that is not a vehicle has no row here, so it falls out silently.
    const tag = (Array.isArray(row.tag) ? row.tag[0] : row.tag) as { name?: string } | undefined;
    const label = input.vehicleLabel?.trim() || tag?.name || "הרכב";
    const current = (mapping.kind === "insurance"
      ? row.insurance_due_date
      : row.license_due_date) as string | null;

    // Only ever forward. An older document must not pull a car's date back.
    if (current && current >= input.date) return;

    toast(
      `לעדכן גם את תוקף ${mapping.noun} ברכב ${label} ל־${formatShortDate(input.date)}?`,
      {
        action: {
          label: "עדכן",
          onClick: async () => {
            const result = await setVehicleExpiryDate(input.vehicleTagId, mapping.kind, input.date);
            if (result.ok) {
              toast.success("תוקף הרכב עודכן");
              input.onUpdated?.();
            } else {
              toast.error(toHebrewError(result.error, "עדכון הרכב נכשל."));
            }
          },
        },
        cancel: { label: "לא", onClick: () => {} },
        // Long enough to read and decide; this is an offer, not an alert.
        duration: 10_000,
      }
    );
  } catch {
    // The offer is a courtesy. Failing to make it is not worth a message.
  }
}
