import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadCustomerSearchIndexRows } from "@/app/(app)/customers/loadCustomers";
import { loadOrderSearchIndexRows } from "@/app/(app)/sales/loadOrders";
import { loadProjectSearchIndexRows } from "@/app/(app)/projects/loadProjects";

// The lightweight customer / order / project lists behind the app's instant
// in-memory type-ahead (hooks/use*SearchIndex.ts). These used to be server
// actions, and Next runs a page's server actions — and any router.refresh() —
// one at a time: the customer list the top bar loads on every page sat in that
// queue, so the refresh after a save could wait behind it. A plain GET runs
// alongside everything else. RLS checks every query against the caller's JWT,
// exactly as the actions did.
const LOADERS = {
  customers: loadCustomerSearchIndexRows,
  orders: loadOrderSearchIndexRows,
  projects: loadProjectSearchIndexRows,
} as const;

export type SearchIndexKind = keyof typeof LOADERS;

export async function GET(_req: Request, context: { params: Promise<{ kind: string }> }) {
  try {
    const { kind } = await context.params;
    if (!(kind in LOADERS)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;

    const rows = await LOADERS[kind as SearchIndexKind](access.value.supabase);
    return NextResponse.json({ rows });
  } catch (error: unknown) {
    return NextResponse.json({ error: toHebrewError(error, "טעינת רשימת החיפוש נכשלה.") }, { status: 500 });
  }
}
