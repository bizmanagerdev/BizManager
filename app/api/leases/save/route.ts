import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import {
  createLease,
  updateLease,
  type LeaseInput,
} from "@/app/(app)/properties/actions";

// A lease saved from the property page through the send queue, so it saves with no signal too (owner,
// 2026-10-24): new — with the id the app gave it, so sent twice it's still one lease — or changed. The page's
// own lease actions do the work; this is their door for a save kept on the device.

const LEASE_KEYS = [
  "customer_id",
  "start_date",
  "end_date",
  "monthly_rent_amount",
  "status",
  "notes",
  "deposit_type",
  "deposit_amount",
  "deposit_reference",
  "keys_handed_over",
  "rent_day_of_month",
  "rent_calendar",
  "rent_hebrew_day",
  "period_months",
  "area_sqm",
  "unit_label",
] as const satisfies readonly (keyof LeaseInput)[];

/** Its fields as the form sends them — text, "" for none. */
function leaseInput(value: unknown): LeaseInput {
  const raw = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  const input = {} as Record<(typeof LEASE_KEYS)[number], string>;
  for (const key of LEASE_KEYS) {
    const v = raw[key];
    input[key] = typeof v === "string" ? v : v == null ? "" : String(v);
  }
  return input;
}

export async function POST(req: Request) {
  const access = await requireRouteAccess({
    allowedRoles: ["admin", "office"],
  });
  if (!access.ok) return access.response;
  const { supabase, user } = access.value;

  return withIdempotency(req, supabase, user.id, "leases/save", async () => {
    const body = (await req.json().catch(() => ({}))) as {
      property_id?: unknown;
      lease_id?: unknown;
      id?: unknown;
      lease?: unknown;
    };
    const propertyId =
      typeof body.property_id === "string" ? body.property_id.trim() : "";
    if (!propertyId)
      return NextResponse.json({ error: "חסר מזהה נכס." }, { status: 400 });
    const input = leaseInput(body.lease);
    const leaseId =
      typeof body.lease_id === "string" ? body.lease_id.trim() : "";
    const result = leaseId
      ? await updateLease(propertyId, leaseId, input)
      : await createLease(
          propertyId,
          input,
          typeof body.id === "string" ? body.id : undefined,
        );
    if (!result.ok)
      return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ lease: { id: result.id } });
  });
}
