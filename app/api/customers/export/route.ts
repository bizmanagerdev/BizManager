import { toHebrewError } from "@/lib/error-messages";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCustomersFilters } from "@/app/(app)/customers/loadCustomers";
import { parseCustomersFilters, type CustomersFilters } from "@/app/(app)/customers/customersFilters";
import { chunkStrings } from "@/lib/financial/utils";
import { israelDateKey } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

const OVERVIEW_SELECT =
  "customer_id,customer_name,email,phone,orders_count,projects_count,total_sales,total_paid,open_balance,last_order_at,last_payment_at,address,active,notes,name_for_invoice,registration_number";

const PAGE_SIZE = 1000;

/**
 * Every customer_overview_view row matching the same filters /customers uses
 * (with_projects / with_orders / with_debt / active_only) — no page's worth,
 * unlike loadCustomersPage. Pages past Supabase's 1000-row cap itself.
 */
async function fetchAllFilteredCustomers(
  supabase: SupabaseClient,
  filters: CustomersFilters
): Promise<{ rows: Row[]; error: string | null }> {
  const all: Row[] = [];
  let from = 0;

  for (;;) {
    // The list's own order, ties broken by id: paging over a name several
    // customers share could otherwise repeat one and skip another.
    const query = applyCustomersFilters(supabase.from("customer_overview_view").select(OVERVIEW_SELECT), filters)
      .order("customer_name", { ascending: true })
      .order("customer_id", { ascending: true });

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) return { rows: all, error: toHebrewError(error.message) || error.message };

    const rows = (data ?? []) as Row[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return { rows: all, error: null };
}

/** Ids per WhatsApp lookup — short enough for one request's address. */
const WHATSAPP_ID_BATCH = 150;

function toNum(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function GET(req: NextRequest) {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const params = req.nextUrl.searchParams;
  const filters = parseCustomersFilters((param) => params.get(param));

  const { rows: overviewRows, error } = await fetchAllFilteredCustomers(supabase, filters);
  if (error) {
    return NextResponse.json({ error }, { status: 400 });
  }

  // The view doesn't carry whatsapp — a lookup against the base table for the
  // ids that survived the filter, in batches: all ~650 ids in one request made
  // an address too long to send, the failure was ignored and the column came
  // out empty (found 2026-10-11).
  const ids = overviewRows.map((row) => str(row.customer_id)).filter(Boolean);
  const whatsappById = new Map<string, string>();
  const batches = chunkStrings(ids, WHATSAPP_ID_BATCH);
  const lookups = await Promise.all(
    batches.map((batch) => supabase.from("customers").select("id,whatsapp").in("id", batch))
  );
  for (const { data: customerRows } of lookups) {
    for (const row of (customerRows ?? []) as Row[]) {
      const id = str(row.id);
      const whatsapp = str(row.whatsapp);
      if (id && whatsapp) whatsappById.set(id, whatsapp);
    }
  }

  const sheetRows = overviewRows.map((row) => {
    const id = str(row.customer_id);
    return {
      "שם": str(row.customer_name),
      "טלפון": str(row.phone),
      "וואטסאפ": whatsappById.get(id) ?? "",
      "אימייל": str(row.email),
      "כתובת": str(row.address),
      "שם לחשבונית": str(row.name_for_invoice),
      "מספר עוסק/ח.פ": str(row.registration_number),
      "פעיל": row.active === false ? "לא" : "כן",
      "הזמנות": toNum(row.orders_count),
      "פרויקטים": toNum(row.projects_count),
      "סה״כ מכירות": toNum(row.total_sales),
      "סה״כ שולם": toNum(row.total_paid),
      "יתרה פתוחה": toNum(row.open_balance),
      "הזמנה אחרונה": str(row.last_order_at).slice(0, 10),
      "תשלום אחרון": str(row.last_payment_at).slice(0, 10),
      "הערות": str(row.notes),
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  XLSX.utils.book_append_sheet(wb, ws, "לקוחות");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  // Israel's date: the UTC one named an export made after midnight here by
  // the day before.
  const stamp = israelDateKey();
  const filename = `לקוחות-${stamp}.xlsx`;

  return new NextResponse(buf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}
